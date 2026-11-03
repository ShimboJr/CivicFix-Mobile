/**
 * API service for CivicFix live-location SOS sessions.
 *
 * All three operations (start / ping / end) hit the same backend routes used
 * by the CivicFix web app — no backend changes required.
 *
 * startSession  → POST /api/live-location/start
 * pingSession   → POST /api/live-location/:id/ping
 * endSession    → POST /api/live-location/:id/end
 *
 * pingSession uses `fetch` instead of the axios instance because it is also
 * called directly from the background location task, which runs in the same
 * Hermes JS context but reads auth credentials from SecureStore rather than
 * from the in-memory axios interceptor. Using fetch makes the ping path
 * uniform between foreground and background calls.
 */

import * as SecureStore from 'expo-secure-store';

import apiClient from '@/services/api';
import { API_BASE_URL, Endpoints } from '@/config/api';
import { StorageKeys } from '@/services/sessionStore';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StartSessionParams {
  durationMinutes: number;
  latitude:        number;
  longitude:       number;
  accuracy?:       number | null;
}

export interface StartSessionResponse {
  message:   string;
  sessionId: string;
  reportId:  string;
  expiresAt: string;  // ISO 8601
}

// ── startSession ───────────────────────────────────────────────────────────────

/**
 * Creates a new live-location SOS session on the backend.
 *
 * Also fires the urgent admin notification immediately on the backend side —
 * this is intentional; starting the session IS the SOS alert.
 */
export async function startSession(
  params: StartSessionParams,
): Promise<StartSessionResponse> {
  const response = await apiClient.post<StartSessionResponse>(
    Endpoints.LIVE_LOCATION_START,
    params,
  );
  return response.data;
}

// ── pingSession ────────────────────────────────────────────────────────────────

export interface PingParams {
  sessionId: string;
  latitude:  number;
  longitude: number;
  accuracy?: number | null;
}

export type PingResult =
  | { ok: true;  newMessages: SessionMessage[] }
  | { ok: false; expired: boolean; message: string };

/**
 * Posts a single location reading to an active session.
 *
 * Uses `fetch` directly (not the axios instance) so it is safe to call from
 * the background location task, which reads its JWT from SecureStore rather
 * than from the in-memory axios interceptor.
 *
 * Returns `{ ok: false, expired: true }` when the backend returns 410 Gone —
 * the caller should stop tracking and clear local session state.
 */
export async function pingSession(params: PingParams): Promise<PingResult> {
  const token = await SecureStore.getItemAsync(StorageKeys.AUTH_TOKEN);
  if (!token) return { ok: false, expired: false, message: 'No auth token' };

  const url = `${API_BASE_URL}${Endpoints.LIVE_LOCATION_PING(params.sessionId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude:  params.latitude,
        longitude: params.longitude,
        accuracy:  params.accuracy,
      }),
    });
  } catch (networkErr) {
    // Network failure — return non-fatal error; tracking continues
    return {
      ok:      false,
      expired: false,
      message: networkErr instanceof Error ? networkErr.message : 'Network error',
    };
  }

  if (response.ok) {
    const body = await response.json().catch(() => ({})) as {
      message?:     string;
      newMessages?: SessionMessage[];
    };
    return { ok: true, newMessages: body.newMessages ?? [] };
  }

  if (response.status === 410) {
    return { ok: false, expired: true, message: 'Session has expired or ended' };
  }

  const body = await response.json().catch(() => ({})) as { message?: string };
  return {
    ok:      false,
    expired: false,
    message: body.message ?? `Ping failed (${response.status})`,
  };
}

// ── endSession ─────────────────────────────────────────────────────────────────

/**
 * Terminates a session on the backend.
 *
 * Idempotent — the backend silently succeeds even if the session is already
 * ended or expired, so it is safe to call as a cleanup step on app start.
 *
 * Uses raw `fetch` (not the axios instance) for the same reason as pingSession,
 * saveSessionNote, and confirmSafe: the Vercel + Atlas M0 cold-start can exceed
 * the previous 15 s axios timeout, causing the request to be silently aborted.
 * That left the backend session stuck as "active" while the app had already
 * cleared local state — the admin continued to see the session as active even
 * though the resident had tapped Stop Sharing.
 *
 * Best-effort — network errors are swallowed so the caller's `finally` block
 * (which stops the location service and clears SecureStore) always runs.
 * If the call fails due to a transient network error, the session will expire
 * on its own once expiresAt passes.
 */
export async function endSession(sessionId: string): Promise<void> {
  const token = await SecureStore.getItemAsync(StorageKeys.AUTH_TOKEN);
  if (!token) return;  // No token → nothing to end on the backend

  const url = `${API_BASE_URL}${Endpoints.LIVE_LOCATION_END(sessionId)}`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    // Response status is not checked — idempotent; 200, 404, 410 are all fine.
    // A non-2xx from an already-ended session is an acceptable no-op.
  } catch {
    // Network-level failure — swallow so the caller's cleanup always runs.
    // The session will auto-expire at expiresAt on the backend.
  }
}

// ── saveSessionNote ────────────────────────────────────────────────────────────

/**
 * Saves a free-text note to the live-location session's linked EmergencyReport.
 *
 * Calls PATCH /api/live-location/:id/note — the same endpoint used by the web
 * app's LiveLocationActive.jsx "Save details" button.  The note is stored in
 * the EmergencyReport.description field, which is what admins read on
 * EmergencyDetail.jsx.
 *
 * Uses raw `fetch` (not the axios instance) for the same reason as pingSession:
 * the Vercel + Atlas M0 cold-start can take 15-25 s after an idle period.
 * The axios client had a 15 s timeout that fired before the server could
 * respond, making axios report the cancellation as a network error
 * ("Could not connect to the server") even though the backend was reachable.
 * Raw fetch has no built-in timeout and will wait for the response.
 *
 * Throws on network / server error so the caller can surface the message.
 */
export async function saveSessionNote(
  sessionId: string,
  note: string,
): Promise<void> {
  const token = await SecureStore.getItemAsync(StorageKeys.AUTH_TOKEN);
  if (!token) throw new Error('Not authenticated — please log in again.');

  const url = `${API_BASE_URL}${Endpoints.LIVE_LOCATION_NOTE(sessionId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ note }),
    });
  } catch {
    throw new Error('Could not connect to the server. Please check your internet connection.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Failed to save details (${response.status})`);
  }
}

// ── fetchSessionMessages ───────────────────────────────────────────────────────────────────────

export interface SessionMessage {
  _id:       string;
  text:      string;
  isPreset:  boolean;
  createdAt: string;  // ISO 8601
  sender: {
    name: string;
    role: string;
  };
}

/**
 * Fetches all messages for a live-location session, oldest first.
 *
 * Used for the one-shot backfill on mount (before the first location ping
 * has been delivered via the background task).  After that, messages arrive
 * via the ping response stored in SecureStore — no repeated network calls.
 *
 * ⚠️  Stealth contract:
 *   The caller MUST NOT trigger any OS notification, sound, or vibration when
 *   new messages arrive.  Messages must be silently displayed in-UI only if the
 *   resident is already looking at this screen.
 *
 * Returns an empty array on any network error so the session is not interrupted.
 */
export async function fetchSessionMessages(
  sessionId: string,
): Promise<SessionMessage[]> {
  try {
    const response = await apiClient.get<{ messages: SessionMessage[] }>(
      Endpoints.LIVE_LOCATION_MESSAGES(sessionId),
    );
    return response.data.messages ?? [];
  } catch {
    // Swallow — a transient network error must not interrupt the session.
    return [];
  }
}

// ── confirmSafe ───────────────────────────────────────────────────────────────────────

/**
 * Resident taps "I'm Safe" — stamps `reporterConfirmedSafeAt` on the session.
 *
 * ⚠️  SAFETY CONTRACT:
 *   This NEVER stops tracking, ends the session, or alters session.status.
 *   It is purely informational — it tells admins the resident acknowledges
 *   their messages.  Location sharing continues completely unaffected.
 *
 * Uses raw `fetch` (not the axios instance) for the same reason as pingSession
 * and saveSessionNote: the Vercel + Atlas M0 cold-start can take 15-25 s after
 * an idle period, longer than the previous axios 15 s timeout.
 *
 * Throws on network / server error so the caller can show an inline message.
 */
export async function confirmSafe(sessionId: string): Promise<void> {
  const token = await SecureStore.getItemAsync(StorageKeys.AUTH_TOKEN);
  if (!token) throw new Error('Not authenticated — please log in again.');

  const url = `${API_BASE_URL}${Endpoints.LIVE_LOCATION_CONFIRM_SAFE(sessionId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch {
    throw new Error('Could not connect to the server. Please check your internet connection.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Could not send confirmation (${response.status})`);
  }
}
