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
 * Uses the axios instance (foreground-only) because ending a session is always
 * triggered by an explicit user action in the foreground.
 */
export async function endSession(sessionId: string): Promise<void> {
  // Best-effort — we don't want a network error to block the UI from clearing
  // session state and stopping the location service.
  try {
    await apiClient.post(Endpoints.LIVE_LOCATION_END(sessionId));
  } catch {
    // Swallow — the foreground service and local state are cleared regardless.
    // If the call failed due to a transient network error, the session will
    // expire on its own once expiresAt passes.
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
 * Throws on network / server error so the caller can surface the message.
 */
export async function saveSessionNote(
  sessionId: string,
  note: string,
): Promise<void> {
  await apiClient.patch(Endpoints.LIVE_LOCATION_NOTE(sessionId), { note });
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
 * Throws on network / server error so the caller can show an inline message.
 */
export async function confirmSafe(sessionId: string): Promise<void> {
  await apiClient.post(Endpoints.LIVE_LOCATION_CONFIRM_SAFE(sessionId));
}
