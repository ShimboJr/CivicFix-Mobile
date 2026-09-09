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
 *   civicfix_active_session_id  — MongoDB ObjectId string of the live session
 *   civicfix_session_expires_at — ISO 8601 timestamp string (expiresAt)
 *   civicfix_active_report_id   — linked EmergencyReport id (for deep-link use)
 *
 * The auth JWT is stored separately by the AuthContext under its own key
 * ('civicfix_sos_auth_token') — imported here so the background task has a
 * single import to get everything it needs.
 */

import * as SecureStore from 'expo-secure-store';

export const StorageKeys = {
  AUTH_TOKEN:   'civicfix_sos_auth_token',   // set by AuthContext
  SESSION_ID:   'civicfix_active_session_id',
  EXPIRES_AT:   'civicfix_session_expires_at',
  REPORT_ID:    'civicfix_active_report_id',
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

// ── Clear ──────────────────────────────────────────────────────────────────────

export async function clearActiveSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(StorageKeys.SESSION_ID),
    SecureStore.deleteItemAsync(StorageKeys.EXPIRES_AT),
    SecureStore.deleteItemAsync(StorageKeys.REPORT_ID),
  ]);
}
