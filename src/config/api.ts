/**
 * Centralised API configuration for CivicFix SOS.
 *
 * The base URL is read from app.json `extra` so it can be changed
 * per-environment without modifying source code.
 *
 * Production base URL: https://civicfix-backend.vercel.app/api
 *
 * === Real-device testing with Expo Go ===
 * In Expo Go, __DEV__ is always true, so `apiBaseUrlDev` is used.
 * For a REAL PHYSICAL DEVICE, "http://10.0.2.2:3000" is UNREACHABLE
 * because 10.0.2.2 is the Android EMULATOR'S alias for the host machine.
 *
 * Options:
 *   A) Point apiBaseUrlDev at Vercel (current setting — works everywhere).
 *   B) Local backend on emulator: "http://10.0.2.2:3000"
 *   C) Local backend on real device (same Wi-Fi): "http://192.168.x.x:3000"
 *      (replace with your PC's actual local IP address)
 *
 * === CORS note ===
 * React Native does NOT send an Origin header — it is not a browser.
 * Standard Express cors() middleware passes all non-origin requests through,
 * so the backend's CORS allowlist does NOT block the mobile app.
 */

import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra as {
  apiBaseUrl?: string;
  apiBaseUrlDev?: string;
} | undefined;

// Production URL — used in release builds (__DEV__ === false)
const prodUrl = extra?.apiBaseUrl ?? 'https://civicfix-backend.vercel.app/api';

// Development URL — used in Expo Go and dev builds (__DEV__ === true).
// Currently points at Vercel so real-device testing works out of the box.
// Swap this to a local IP if you are running the backend locally.
const devUrl = extra?.apiBaseUrlDev ?? 'https://civicfix-backend.vercel.app/api';

export const API_BASE_URL: string = __DEV__ ? devUrl : prodUrl;

/**
 * CivicFix API endpoint paths, relative to API_BASE_URL.
 *
 * NOTE: The base URL already ends in /api (e.g. .../api), so these
 * paths must NOT repeat /api — they start directly with the resource.
 */
export const Endpoints = {
  /** POST — login with email + password, returns { token, user }. */
  LOGIN: '/auth/login',
  /** GET  — validate stored token and return current user profile. */
  ME: '/auth/me',

  // ── Live-location (SOS sessions) ──────────────────────────────────────────
  /**
   * POST — start a live-location SOS session.
   * Body:  { durationMinutes, latitude, longitude, accuracy? }
   * Returns: { sessionId, reportId, expiresAt }
   */
  LIVE_LOCATION_START: '/live-location/start',

  /**
   * POST — send a location ping for an active session.
   * Body:  { latitude, longitude, accuracy? }
   * Returns: { message } — 410 Gone if the session has expired or ended.
   */
  LIVE_LOCATION_PING: (sessionId: string) => `/live-location/${sessionId}/ping`,

  /**
   * POST — end an active session (idempotent — safe to call if already ended).
   * No body required.
   * Returns: { message, sessionId }
   */
  LIVE_LOCATION_END: (sessionId: string) => `/live-location/${sessionId}/end`,

  /**
   * PATCH — save a free-text note on the live-location session's linked
   * EmergencyReport (the description field), so admins see it on EmergencyDetail.
   * Body:  { note: string }
   * Returns: { message }
   * Access: session owner only.
   */
  LIVE_LOCATION_NOTE: (sessionId: string) => `/live-location/${sessionId}/note`,

  /**
   * GET — fetch all messages for a session (oldest first).
   * Access: session owner OR admin.
   * Returns: { messages: SessionMessage[] }
   */
  LIVE_LOCATION_MESSAGES: (sessionId: string) => `/live-location/${sessionId}/messages`,

  /**
   * POST — resident taps "I'm Safe"; stamps reporterConfirmedSafeAt on the session.
   * Body:  none
   * Returns: { message, confirmedAt, sessionStatus }
   * ⚠️  NEVER alters session status or stops tracking — purely informational.
   */
  LIVE_LOCATION_CONFIRM_SAFE: (sessionId: string) => `/live-location/${sessionId}/confirm-safe`,
} as const;
