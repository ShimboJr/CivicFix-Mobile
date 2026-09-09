/**
 * Authentication context — provides auth state and actions
 * to the entire application.
 *
 * Usage:
 *   const { user, isAuthenticated, isLoading, login, logout } = useAuth();
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { AuthError, type CivicFixUser, getMe, login as apiLogin } from '@/services/authService';
import { deleteToken, getToken, saveToken } from '@/services/tokenStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthContextValue {
  /** The authenticated user, or null when not logged in. */
  user: CivicFixUser | null;
  /** True while the initial token restoration check is running. */
  isLoading: boolean;
  /** Convenience flag — true when user is non-null. */
  isAuthenticated: boolean;
  /**
   * Log in with email and password.
   * Returns null on success, or a user-friendly error string on failure.
   */
  login: (email: string, password: string) => Promise<string | null>;
  /** Clear the session and remove the stored token. */
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CivicFixUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    async function restoreSession() {
      try {
        const storedToken = await getToken();
        if (storedToken) {
          const currentUser = await getMe(storedToken);
          if (currentUser) {
            setUser(currentUser);
          } else {
            // Token invalid or expired — clear it silently
            await deleteToken();
          }
        }
      } catch {
        // Storage read failure — continue as unauthenticated
      } finally {
        setIsLoading(false);
      }
    }

    restoreSession();
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const { token, user: loggedInUser } = await apiLogin(email, password);
        await saveToken(token);
        setUser(loggedInUser);
        return null;
      } catch (error) {
        if (error instanceof AuthError) {
          return error.message;
        }
        return 'An unexpected error occurred. Please try again.';
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await deleteToken();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: user !== null,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
