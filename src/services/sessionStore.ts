/**
 * Thin SecureStore wrappers for persisting active SOS session state.
 *
 * Why SecureStore and not AsyncStorage?
 *   - The session ID, when combined with a valid JWT, is sufficient to send
 *     location pings on behalf of the user.  Keeping it in the encrypted
 *     keystore is the correct threat model for a safety-critical app.
 *   - The background location task reads these values directly from SecureStore
 *     because it runs in the same JS/Hermes context (kept alive by the Android
 *     foreground service) and therefore has access to all native modules.
 *
 * Storage keys:
 *   civicfix_active_session_id      — MongoDB ObjectId string of the live session
 *   civicfix_session_expires_at     — ISO 8601 timestamp string (expiresAt)
 *   civicfix_active_report_id       — linked EmergencyReport id (for deep-link use)
 *   civicfix_last_seen_msg_at       — ISO 8601 timestamp of the most-recently
 *                                     displayed admin message (written by the screen;
 *                                     read by postPing to include as lastSeenMessageAt
 *                                     so the backend only returns NEW messages)
 *   civicfix_pending_messages       — JSON array of SessionMessage objects written
 *                                     by postPing after a successful ping; read and
 *                                     cleared by the foreground screen.  This is the
 *                                     bridge that lets a single network call (the ping)
 *                                     deliver messages without a separate API poll.
 *
 * The auth JWT is stored separately by the AuthContext under its own key
 * ('civicfix_sos_auth_token') — imported here so the background task has a
 * single import to get everything it needs.
 */

import * as SecureStore from 'expo-secure-store';

export const StorageKeys = {
  AUTH_TOKEN:        'civicfix_sos_auth_token',   // set by AuthContext
  SESSION_ID:        'civicfix_active_session_id',
  EXPIRES_AT:        'civicfix_session_expires_at',
  REPORT_ID:         'civicfix_active_report_id',
  // Message-delivery bridge (background task ↔ foreground screen)
  LAST_SEEN_MSG_AT:  'civicfix_last_seen_msg_at',
  PENDING_MESSAGES:  'civicfix_pending_messages',
} as const;

// ── Write ──────────────────────────────────────────────────────────────────────

export interface ActiveSessionData {
  sessionId: string;
  expiresAt: string;  // ISO 8601
  reportId:  string;
}

export async function saveActiveSession(data: ActiveSessionData): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(StorageKeys.SESSION_ID, data.sessionId),
    SecureStore.setItemAsync(StorageKeys.EXPIRES_AT, data.expiresAt),
    SecureStore.setItemAsync(StorageKeys.REPORT_ID,  data.reportId),
  ]);
}

// ── Read ───────────────────────────────────────────────────────────────────────

export async function loadActiveSession(): Promise<ActiveSessionData | null> {
  const [sessionId, expiresAt, reportId] = await Promise.all([
    SecureStore.getItemAsync(StorageKeys.SESSION_ID),
    SecureStore.getItemAsync(StorageKeys.EXPIRES_AT),
    SecureStore.getItemAsync(StorageKeys.REPORT_ID),
  ]);

  if (!sessionId || !expiresAt || !reportId) return null;

  // If the session has already passed its expiry wall-clock time, treat it as
  // gone even before asking the backend — avoids a guaranteed 410 on mount.
  if (new Date(expiresAt) <= new Date()) {
    await clearActiveSession();
    return null;
  }

  return { sessionId, expiresAt, reportId };
}

// ── Message-delivery bridge ───────────────────────────────────────────────────
// Written by the foreground screen; read by postPing (background task).

/**
 * Persist the ISO timestamp of the most recently displayed admin message.
 * postPing reads this on each ping so the backend only returns newer messages.
 */
export async function saveLastSeenMessageAt(isoTimestamp: string): Promise<void> {
  await SecureStore.setItemAsync(StorageKeys.LAST_SEEN_MSG_AT, isoTimestamp);
}

/**
 * Read the last-seen message timestamp.  Returns null if never set.
 */
export async function loadLastSeenMessageAt(): Promise<string | null> {
  return SecureStore.getItemAsync(StorageKeys.LAST_SEEN_MSG_AT);
}

/**
 * Written by postPing after a successful ping that returned new messages.
 * The foreground screen reads this key on a fast local interval — no network.
 *
 * @param messages - Array of SessionMessage objects received from the ping.
 */
export async function savePendingMessages(messages: unknown[]): Promise<void> {
  await SecureStore.setItemAsync(
    StorageKeys.PENDING_MESSAGES,
    JSON.stringify(messages),
  );
}

/**
 * Read and immediately clear the pending-messages queue.
 * Returns an empty array when nothing is pending.
 */
export async function drainPendingMessages<T = unknown>(): Promise<T[]> {
  const raw = await SecureStore.getItemAsync(StorageKeys.PENDING_MESSAGES);
  if (!raw) return [];
  // Clear immediately so a second concurrent drain sees nothing.
  await SecureStore.deleteItemAsync(StorageKeys.PENDING_MESSAGES);
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

// ── Clear ──────────────────────────────────────────────────────────────────────

export async function clearActiveSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(StorageKeys.SESSION_ID),
    SecureStore.deleteItemAsync(StorageKeys.EXPIRES_AT),
    SecureStore.deleteItemAsync(StorageKeys.REPORT_ID),
    // Also clear message-bridge keys so stale data from this session
    // never leaks into a future session if the app is relaunched.
    SecureStore.deleteItemAsync(StorageKeys.LAST_SEEN_MSG_AT),
    SecureStore.deleteItemAsync(StorageKeys.PENDING_MESSAGES),
  ]);
}
