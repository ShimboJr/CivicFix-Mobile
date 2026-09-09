/**
 * Secure token storage — thin wrapper around expo-secure-store.
 *
 * Authentication tokens are stored encrypted on the device.
 * Never log or expose the token value in any way.
 */

import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'civicfix_sos_auth_token';

/**
 * Persist an authentication token to secure storage.
 */
export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Retrieve the stored authentication token, or null if none exists.
 */
export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

/**
 * Delete the stored authentication token (called on logout or session expiry).
 */
export async function deleteToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
