/**
 * Axios API client for CivicFix SOS.
 *
 * This is the single axios instance used for all HTTP requests.
 * It automatically:
 *   - Points at the correct base URL (dev or prod) from app.json extra
 *   - Attaches `Authorization: Bearer {token}` when a JWT is stored
 *   - Returns clear error messages without exposing raw stack traces
 *
 * Usage:
 *   import apiClient from '@/services/api';
 *   const res = await apiClient.get('/auth/me');
 */

import axios, { type AxiosError } from 'axios';

import { API_BASE_URL } from '@/config/api';
import { getToken } from '@/services/tokenStore';

// ---------------------------------------------------------------------------
// Create the shared axios instance
// ---------------------------------------------------------------------------

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ---------------------------------------------------------------------------
// Request interceptor — attach JWT token when available
// ---------------------------------------------------------------------------

apiClient.interceptors.request.use(
  async (config) => {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ---------------------------------------------------------------------------
// Response interceptor — normalise error messages
// ---------------------------------------------------------------------------

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string; error?: string }>) => {
    if (!error.response) {
      // Network error — no response received
      return Promise.reject(
        new Error('Could not connect to the server. Please check your internet connection.'),
      );
    }

    const status = error.response.status;
    const body = error.response.data;

    // Extract a user-readable message from the response body if present
    const serverMessage =
      typeof body?.message === 'string' && body.message.length > 0
        ? body.message
        : typeof body?.error === 'string' && body.error.length > 0
          ? body.error
          : null;

    if (status === 401 || status === 403) {
      return Promise.reject(
        new Error(serverMessage ?? 'Incorrect email or password. Please try again.'),
      );
    }

    return Promise.reject(new Error(serverMessage ?? `Request failed (${status})`));
  },
);

export default apiClient;
