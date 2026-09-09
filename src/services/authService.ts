/**
 * Authentication service — communicates with the CivicFix backend auth API.
 *
 * Uses the shared axios client (src/services/api.ts) which automatically
 * attaches the Authorization header and normalises errors.
 *
 * ── Actual backend response shapes (from authController.js) ──────────────────
 *
 * POST /auth/login  (success 200):
 *   { _id, name, email, role, token }     ← flat object, token at top level
 *
 * GET  /auth/me     (success 200):
 *   { _id, name, email, role, location, createdAt }
 *
 * Both use the same Express `authResponse()` helper — there is no nested
 * `user` wrapper object.
 *
 * These are the same endpoints used by the CivicFix web application.
 * No backend changes are required.
 */

import apiClient from '@/services/api';
import { Endpoints } from '@/config/api';

// ---------------------------------------------------------------------------
// Types — matched to the actual backend response shapes
// ---------------------------------------------------------------------------

export interface CivicFixUser {
  /** MongoDB document ID — backend uses _id, not id. */
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * The raw flat object the backend returns on successful login / register.
 * Token lives at the top level alongside the user fields.
 */
interface LoginApiResponse {
  _id: string;
  name: string;
  email: string;
  role: string;
  token: string;
}

export interface LoginResponse {
  token: string;
  user: CivicFixUser;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Authenticate a CivicFix user with email and password.
 *
 * POSTs to /auth/login — the same endpoint used by the CivicFix web app.
 * Normalises the flat backend response into { token, user } for the app.
 * Throws AuthError with a user-readable message on failure.
 */
export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  try {
    const response = await apiClient.post<LoginApiResponse>(Endpoints.LOGIN, {
      email,
      password,
    });

    const data = response.data;

    if (!data.token || !data._id) {
      throw new AuthError('Received an unexpected response from the server.');
    }

    // Normalise the flat backend shape into the { token, user } shape the
    // rest of the app expects, mapping _id → id.
    return {
      token: data.token,
      user: {
        id:    data._id,
        name:  data.name,
        email: data.email,
        role:  data.role,
      },
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      error instanceof Error ? error.message : 'An unexpected error occurred.',
    );
  }
}

/**
 * Validate a stored token by calling GET /auth/me.
 *
 * Returns the current CivicFixUser on success, or null if the token
 * is invalid, expired, or the network is unavailable.
 *
 * Backend returns: { _id, name, email, role, location, createdAt }
 * We normalise _id → id.
 *
 * Never throws — invalid tokens are treated as "not authenticated" so
 * the app can always reach a known state on startup.
 */
export async function getMe(token: string): Promise<CivicFixUser | null> {
  try {
    const response = await apiClient.get<{
      _id: string;
      name: string;
      email: string;
      role: string;
    }>(Endpoints.ME, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = response.data;

    if (!data._id) return null;

    return {
      id:    data._id,
      name:  data.name,
      email: data.email,
      role:  data.role,
    };
  } catch {
    // Network failure, 401, or parse error — treat as not authenticated
    return null;
  }
}
