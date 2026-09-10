/**
 * Background location service for CivicFix SOS.
 *
 * ── Two execution paths ───────────────────────────────────────────────────────
 *
 * A. Development / production build (EAS Build or `expo run:android`)
 *    Uses `startLocationUpdatesAsync` + expo-task-manager.  The app's
 *    AndroidManifest gains RECEIVE_BOOT_COMPLETED from the expo-task-manager
 *    config plugin during prebuild, so Android's JobScheduler can persist the
 *    background job across reboots.  Location pings continue when the app is
 *    backgrounded, the screen is locked, or (to the extent Android allows) the
 *    app is killed.
 *
 * B. Expo Go (Expo Go's manifest does NOT include RECEIVE_BOOT_COMPLETED)
 *    `startLocationUpdatesAsync` crashes the app with:
 *      "Error: requested job be persisted without holding
 *       RECEIVE_BOOT_COMPLETED permission"
 *    because Expo Go's pre-built APK cannot be modified by config plugins.
 *
 *    Fallback: `Location.watchPositionAsync` — a foreground-only subscription
 *    that uses identical ping logic but does NOT go through TaskManager.
 *    It works correctly while the app is visible or recently used, but Android
 *    will suspend the JS thread when the app is fully backgrounded.
 *
 *    This is sufficient for testing the full API integration (login → start
 *    session → receive pings → end session) without needing a native build.
 *    For real background reliability, build a development client.
 *
 * ── TaskManager.defineTask (module-level) ────────────────────────────────────
 * Must be called at module scope — registering the handler is safe in both
 * environments; the crash only occurs when the system tries to DELIVER a
 * location event via JobScheduler, which is triggered by startLocationUpdatesAsync.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

import { API_BASE_URL, Endpoints } from '@/config/api';
import {
  StorageKeys,
  clearActiveSession,
  loadLastSeenMessageAt,
  savePendingMessages,
} from '@/services/sessionStore';

// ── Environment detection ─────────────────────────────────────────────────────

/**
 * True when running inside Expo Go.
 * `Constants.appOwnership === 'expo'` is the canonical check since SDK 46+.
 *
 * In Expo Go we MUST use watchPositionAsync instead of startLocationUpdatesAsync
 * to avoid the RECEIVE_BOOT_COMPLETED crash described above.
 */
const IS_EXPO_GO = Constants.appOwnership === 'expo';

// ── Task name ─────────────────────────────────────────────────────────────────

export const LOCATION_TASK_NAME = 'civicfix-sos-location';

// ── Expo Go foreground subscription handle ────────────────────────────────────

let _foregroundSubscription: Location.LocationSubscription | null = null;

// ── Shared ping logic (used by both paths) ────────────────────────────────────

/**
 * POST a single location reading to the backend.
 * Handles 410 Gone by clearing session state and stopping tracking.
 * Network failures are logged but non-fatal — the next event will retry.
 *
 * Piggybacked message delivery:
 *   Reads `lastSeenMessageAt` from SecureStore (written by the foreground screen
 *   after it displays a message), includes it in the ping body, then stores any
 *   `newMessages` from the response back into SecureStore under PENDING_MESSAGES.
 *   The foreground screen drains that key on a fast local interval — no extra
 *   network call is needed.  When no new messages arrive, nothing is written.
 *
 * Logging note: console.error is used for failures because Hermes silences
 * console.warn in non-debuggable release builds at the native log layer.
 * console.error is always routed through the native crash-reporter bridge
 * and remains visible in `adb logcat` regardless of build type.
 */
async function postPing(
  latitude:  number,
  longitude: number,
  accuracy:  number | null | undefined,
): Promise<void> {
  const [sessionId, token, lastSeenMessageAt] = await Promise.all([
    SecureStore.getItemAsync(StorageKeys.SESSION_ID),
    SecureStore.getItemAsync(StorageKeys.AUTH_TOKEN),
    loadLastSeenMessageAt(),          // null when no message has ever been shown
  ]);

  if (!sessionId || !token) {
    console.error(
      '[CivicFix SOS] postPing: no session/token in SecureStore — skipping.',
      `sessionId=${sessionId ? 'present' : 'MISSING'}`,
      `token=${token ? 'present' : 'MISSING'}`,
    );
    return;
  }

  const pingUrl = `${API_BASE_URL}${Endpoints.LIVE_LOCATION_PING(sessionId)}`;

  console.log(
    `[CivicFix SOS] Ping → session …${sessionId.slice(-6)}`,
    `lat=${latitude.toFixed(5)} lng=${longitude.toFixed(5)}`,
    `acc=${accuracy?.toFixed(0) ?? '?'}m`,
    lastSeenMessageAt ? `lastSeenMsg=${lastSeenMessageAt}` : 'firstPing',
    `url=${pingUrl}`,
  );

  try {
    const response = await fetch(
      pingUrl,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        // Include lastSeenMessageAt so the backend returns only messages
        // newer than what the screen has already displayed.  Sending null
        // on the first ping is intentional — the backend interprets a
        // missing / null value as "return everything" (backfill mode).
        body: JSON.stringify({
          latitude,
          longitude,
          accuracy,
          ...(lastSeenMessageAt != null && { lastSeenMessageAt }),
        }),
      },
    );

    if (response.status === 410) {
      console.log('[CivicFix SOS] 410 — session expired; halting tracking');
      await clearActiveSession();
      await stopLocationTracking();
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string };
      console.error(
        `[CivicFix SOS] Ping FAILED (HTTP ${response.status}):`,
        body.message ?? 'unknown error',
      );
      return;
    }

    // Parse the response body to extract any piggybacked messages.
    const responseBody = await response.json().catch(() => ({})) as {
      message?: string;
      newMessages?: unknown[];
    };

    // Write new messages to SecureStore so the foreground screen can drain
    // them without making its own network call.  Only write when there are
    // actually messages to avoid unnecessary SecureStore churn.
    if (responseBody.newMessages && responseBody.newMessages.length > 0) {
      await savePendingMessages(responseBody.newMessages);
      console.log(
        `[CivicFix SOS] Ping OK — ${responseBody.newMessages.length} new message(s) queued`,
      );
    } else {
      // Explicit success log — confirms the full round-trip worked.
      console.log(`[CivicFix SOS] Ping OK (${response.status}) — session …${sessionId.slice(-6)}`);
    }
  } catch (err) {
    // Network-level failure (no response received).
    console.error('[CivicFix SOS] Ping NETWORK ERROR:', (err as Error).message);
  }
}

// ── Background task definition (MUST be top-level) ───────────────────────────
//
// Safe to define in both environments — the crash only triggers when
// startLocationUpdatesAsync causes a location broadcast to be delivered
// through JobScheduler without RECEIVE_BOOT_COMPLETED.

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      console.error('[CivicFix SOS] Background task error:', error.message);
      return;
    }
    if (!data?.locations?.length) return;

    const latest = data.locations[data.locations.length - 1];
    await postPing(
      latest.coords.latitude,
      latest.coords.longitude,
      latest.coords.accuracy,
    );
  },
);

// ── Permission helpers ────────────────────────────────────────────────────────

export interface PermissionStatus {
  foreground: boolean;
  background: boolean;
}

export async function requestLocationPermissions(): Promise<PermissionStatus> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return { foreground: false, background: false };

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: bgStatus === 'granted' };
}

export async function getPermissionStatus(): Promise<PermissionStatus> {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  return {
    foreground: fg.status === 'granted',
    background: bg.status === 'granted',
  };
}

// ── Tracking control ──────────────────────────────────────────────────────────

/**
 * Start location tracking.
 *
 * Path A (dev/prod build): startLocationUpdatesAsync — background service with
 * persistent foreground-service notification.
 *
 * Path B (Expo Go): watchPositionAsync — foreground-only subscription using
 * identical ping logic.  Works while the app is in the foreground; pauses when
 * fully backgrounded.  No crash.
 *
 * ── Accuracy rationale ───────────────────────────────────────────────────────
 * accuracy: BestForNavigation (highest available, enum 6)
 *   Maps to Android PRIORITY_HIGH_ACCURACY on the FusedLocationProvider, which
 *   forces GPS + sensor fusion.  Balanced (enum 3) only requests PRIORITY_BALANCED
 *   (~100 m cell/WiFi positioning), explaining the ±300 m readings.
 *   The battery cost is an acceptable trade-off for a time-bounded SOS session.
 *
 * distanceInterval: 0  (was 20 m)
 *   A non-zero distanceInterval acts as a *minimum displacement filter*: the OS
 *   silently drops the update if the device hasn't moved that many metres from
 *   the last fix, even when the time interval has elapsed.  For a safety app,
 *   a stationary user must still produce regular pings — "they haven't moved"
 *   is meaningful information that must reach the admin map.  Setting this to 0
 *   disables the filter; time-based delivery (timeInterval) drives cadence alone.
 */
export async function startLocationTracking(): Promise<void> {
  if (IS_EXPO_GO) {
    // ── Expo Go: foreground-only fallback ────────────────────────────────────
    if (_foregroundSubscription) return; // already running

    console.log(
      '[CivicFix SOS] Expo Go detected — using foreground-only watchPositionAsync.\n' +
      '               Pings will pause when the app is backgrounded.\n' +
      '               Build a development client for full background support.',
    );

    _foregroundSubscription = await Location.watchPositionAsync(
      {
        // Highest accuracy — GPS + sensor fusion. See startLocationTracking JSDoc.
        accuracy:         Location.Accuracy.BestForNavigation,
        timeInterval:     15_000,
        // 0 = no displacement filter; stationary users still get time-based pings.
        distanceInterval: 0,
      },
      async (location) => {
        await postPing(
          location.coords.latitude,
          location.coords.longitude,
          location.coords.accuracy,
        );
      },
    );
    return;
  }

  // ── Dev / prod build: full background service ─────────────────────────────
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (alreadyRunning) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    // Highest accuracy — GPS + sensor fusion. See startLocationTracking JSDoc.
    accuracy:         Location.Accuracy.BestForNavigation,
    timeInterval:     15_000,
    // 0 = no displacement filter; stationary users still get time-based pings.
    distanceInterval: 0,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      // ── Notification content ────────────────────────────────────────────────
      // Deliberately generic — no app name, no SOS/emergency/safety language,
      // no brand color — so the notification reads as unremarkable to a casual
      // observer.  The notification itself is NOT hidden or suppressed; Android
      // requires a visible ongoing notification for any foreground service and
      // that requirement is honoured.
      //
      // ── Notification importance / heads-up banner ───────────────────────────
      // expo-location creates its foreground-service channel with Android's
      // IMPORTANCE_LOW (NotificationManager.IMPORTANCE_LOW), which means:
      //   • No sound or vibration when the notification appears.
      //   • No heads-up (pop-over) banner — it enters the shade silently.
      //   • Shown as an ongoing notification below higher-priority items.
      // This is the correct behaviour for a background-location service and
      // requires no additional configuration on our side.
      //
      // ── Play Store note (sideload-only currently, but worth recording) ──────
      // Google's policies prohibit making a foreground-service notification
      // indistinguishable from a genuine Android system notification
      // (e.g. copying OS iconography or wording verbatim) specifically to
      // prevent misleading users about battery/resource consumption.
      // "Generic and unalarming" is acceptable; "designed to be mistaken for
      // the OS itself" risks policy rejection.  Not a concern for sideloading.
      notificationTitle: 'Location services active',
      notificationBody:  'Using your location in the background.',
      // Neutral mid-range gray — no brand color, no alarm signal.
      notificationColor: '#9E9E9E',
    },
    // false = never pause updates when stationary (critical for safety use case).
    pausesUpdatesAutomatically: false,
  });
}

/**
 * Stop location tracking.  Safe to call even if not running.
 */
export async function stopLocationTracking(): Promise<void> {
  if (IS_EXPO_GO) {
    _foregroundSubscription?.remove();
    _foregroundSubscription = null;
    return;
  }

  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

/**
 * Returns true if a location tracking session is currently active.
 */
export async function isLocationTrackingActive(): Promise<boolean> {
  if (IS_EXPO_GO) {
    return _foregroundSubscription !== null;
  }
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
}
