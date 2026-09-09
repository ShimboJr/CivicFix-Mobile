/**
 * Root application layout.
 *
 * Responsibilities:
 * 1. Provides AuthContext to the entire app.
 * 2. Keeps the native SplashScreen visible while auth state is being resolved.
 * 3. Redirects unauthenticated users to /login.
 * 4. Redirects authenticated users away from /login to /(app)/.
 * 5. Only renders <Slot /> when the current route MATCHES the auth state,
 *    preventing partial mounts of NativeTabs when a redirect is about to occur.
 *
 * Route structure:
 *   /login          → src/app/login.tsx           (unauthenticated only)
 *   /(app)/         → src/app/(app)/_layout.tsx   (authenticated, NativeTabs)
 *   /(app)/index    → src/app/(app)/index.tsx     (SOS home tab)
 *   /(app)/explore  → src/app/(app)/explore.tsx   (Account tab)
 *   /active-session → src/app/active-session.tsx  (authenticated, full-screen over tabs)
 */

import { Slot, useRouter, useSegments } from 'expo-router';
import { ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';

// Side-effect import — registers the background location TaskManager task
// at module evaluation time, before any navigation tree mounts.
// TaskManager.defineTask() must run at app startup, not inside a component.
import '@/services/backgroundLocation';

import { AuthProvider, useAuth } from '@/context/AuthContext';

SplashScreen.preventAutoHideAsync();

// ---------------------------------------------------------------------------
// Auth guard — controls which route is visible
// ---------------------------------------------------------------------------

function AuthGuard() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  // Track whether we have already hidden the splash screen to avoid
  // calling hideAsync() more than once (it is not idempotent on all devices).
  const splashHiddenRef = useRef(false);

  useEffect(() => {
    // Auth state not resolved yet — keep splash visible, render nothing.
    if (isLoading) return;

    const inAppGroup      = segments[0] === '(app)';
    const onLoginScreen    = segments[0] === 'login';
    const onActiveSession  = (segments[0] as string) === 'active-session';
    // Any route that requires authentication:
    const isProtectedRoute = inAppGroup || onActiveSession;

    if (!isAuthenticated && isProtectedRoute) {
      // Not logged in but the router is pointing at a protected screen — redirect.
      router.replace('/login');
      return;
    }

    if (isAuthenticated && (onLoginScreen || segments[0] === undefined)) {
      // Logged in but on the login screen or at the root — redirect.
      router.replace('/(app)');
      return;
    }

    // Auth state matches the current route — it is safe to show the UI.
    if (!splashHiddenRef.current) {
      splashHiddenRef.current = true;
      SplashScreen.hideAsync().catch(() => {
        // Ignore — may already be hidden on some devices.
      });
    }
  }, [isAuthenticated, isLoading, segments, router]);

  // ── Render decision ──────────────────────────────────────────────────────
  //
  // IMPORTANT: <Slot /> must NOT be rendered in the following cases:
  //
  // 1. isLoading — auth state unknown; native splash screen keeps UI hidden.
  //
  // 2. Redirect pending — auth state is resolved but the route is wrong.
  //    Rendering <Slot /> here would cause Expo Router to begin mounting the
  //    incorrect screen (e.g. NativeTabs), which is then immediately unmounted
  //    by the redirect, producing React's "state update before mount" warning.
  //
  // We return null in both cases. The native splash screen or the previous
  // rendered frame keeps the display stable for the one render cycle this
  // takes before segments update.

  if (isLoading) return null;

  const inAppGroup     = segments[0] === '(app)';
  const onLoginScreen   = segments[0] === 'login';
  const onActiveSession = (segments[0] as string) === 'active-session';
  const isProtectedRoute = inAppGroup || onActiveSession;

  // Redirect pending: unauthenticated but router is pointing at a protected route.
  if (!isAuthenticated && isProtectedRoute) return null;

  // Redirect pending: authenticated but router is pointing at login or root.
  if (isAuthenticated && !onLoginScreen && !isProtectedRoute) return null;

  // Route matches auth state — render the active child screen.
  return <Slot />;
}

// ---------------------------------------------------------------------------
// Root layout — providers only; AuthGuard handles routing.
// ---------------------------------------------------------------------------

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthGuard />
      </ThemeProvider>
    </AuthProvider>
  );
}
