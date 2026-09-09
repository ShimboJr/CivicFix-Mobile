/**
 * SOS Home Screen — Phase 3.
 *
 * Wires the "Start SOS" button to:
 *   1. Request location permissions (if not already granted).
 *   2. Get the current GPS fix.
 *   3. POST to /api/live-location/start → receives { sessionId, reportId, expiresAt }.
 *   4. Persist session data to SecureStore.
 *   5. Start the background location service (which will POST pings autonomously).
 *   6. Navigate to /active-session (full-screen, no tabs).
 *
 * Also restores UI state on mount: if the user backgrounds the app during an
 * active session and then re-opens it directly to the SOS tab (e.g. from the
 * app drawer), the screen checks for a live session and redirects to
 * /active-session automatically.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';

import { useAuth } from '@/context/AuthContext';
import {
  getPermissionStatus,
  isLocationTrackingActive,
  requestLocationPermissions,
  startLocationTracking,
  type PermissionStatus,
} from '@/services/backgroundLocation';
import { startSession } from '@/services/liveLocationService';
import {
  loadActiveSession,
  saveActiveSession,
} from '@/services/sessionStore';

// ── Duration options ──────────────────────────────────────────────────────────

const DURATIONS = [
  { label: '15 min', minutes: 15 },
  { label: '1 hr',   minutes: 60 },
  { label: '4 hr',   minutes: 240 },
] as const;

const DEFAULT_DURATION_INDEX = 1; // 1 hr

// ── Component ─────────────────────────────────────────────────────────────────

export default function SOSHomeScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [perms, setPerms]           = useState<PermissionStatus>({ foreground: false, background: false });
  const [selectedDuration, setSelected] = useState(DEFAULT_DURATION_INDEX);
  const [isLoading, setIsLoading]   = useState(false);
  const [loadingLabel, setLabel]    = useState('');

  // Pulse animation for idle state
  const idlePulse = useRef(new Animated.Value(1)).current;
  const idleLoop  = useRef<Animated.CompositeAnimation | null>(null);

  // ── Mount: check permissions + redirect if session already active ───────────
  useEffect(() => {
    async function init() {
      const [permStatus, session, tracking] = await Promise.all([
        getPermissionStatus(),
        loadActiveSession(),
        isLocationTrackingActive(),
      ]);
      setPerms(permStatus);

      // If there is already an active session (e.g. user navigated away from
      // active-session and came back to the SOS tab), redirect them back.
      if (session || tracking) {
        router.replace('/active-session' as any);
      }
    }
    init();
    startIdlePulse();
    return () => stopIdlePulse();
  }, []);

  // ── Idle pulse animation ────────────────────────────────────────────────────

  function startIdlePulse() {
    idleLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(idlePulse, { toValue: 1.06, duration: 1400, useNativeDriver: true }),
        Animated.timing(idlePulse, { toValue: 1,    duration: 1400, useNativeDriver: true }),
      ]),
    );
    idleLoop.current.start();
  }

  function stopIdlePulse() {
    idleLoop.current?.stop();
  }

  // ── SOS start flow ──────────────────────────────────────────────────────────

  async function handleStartSOS() {
    setIsLoading(true);
    try {
      // 1. Permissions
      setLabel('Checking permissions…');
      let currentPerms = perms;
      if (!currentPerms.foreground) {
        currentPerms = await requestLocationPermissions();
        setPerms(currentPerms);
        if (!currentPerms.foreground) {
          Alert.alert(
            'Location Permission Required',
            'CivicFix SOS needs "Allow while using app" (or "Allow all the time") location permission to start an SOS session.\n\nGo to Settings → Apps → CivicFix SOS → Permissions → Location.',
            [{ text: 'OK' }],
          );
          return;
        }
      }

      // Warn if background permission is missing (non-blocking)
      if (!currentPerms.background) {
        await new Promise<void>((resolve) =>
          Alert.alert(
            'Background Location Not Granted',
            'Without "Allow all the time" permission, location sharing may pause if you lock your screen or switch apps.\n\nFor a real emergency, go to Settings → Apps → CivicFix SOS → Permissions → Location → "Allow all the time".',
            [
              { text: 'Continue Anyway', onPress: () => resolve() },
              { text: 'Fix Permission',  onPress: () => resolve() },
            ],
          ),
        );
      }

      // 2. Get initial GPS fix
      setLabel('Getting your location…');
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // 3. Start the backend session
      setLabel('Starting SOS session…');
      const sessionData = await startSession({
        durationMinutes: DURATIONS[selectedDuration].minutes,
        latitude:        fix.coords.latitude,
        longitude:       fix.coords.longitude,
        accuracy:        fix.coords.accuracy,
      });

      // 4. Persist session to SecureStore (background task reads from here)
      await saveActiveSession({
        sessionId: sessionData.sessionId,
        reportId:  sessionData.reportId,
        expiresAt: sessionData.expiresAt,
      });

      // 5. Start background location service (creates foreground notification)
      setLabel('Starting location tracking…');
      await startLocationTracking();

      // 6. Navigate to active session screen
      router.replace('/active-session' as any);

    } catch (err) {
      Alert.alert(
        'Could Not Start SOS',
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
      );
    } finally {
      setIsLoading(false);
      setLabel('');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.userName} numberOfLines={1}>
            {user?.name ?? user?.email ?? 'CivicFix User'}
          </Text>
        </View>

        {/* SOS button */}
        <View style={styles.sosArea}>
          <Animated.View style={[styles.pulseRing, { transform: [{ scale: idlePulse }] }]} />
          <Pressable
            style={({ pressed }) => [
              styles.sosButton,
              pressed    && styles.sosButtonPressed,
              isLoading  && styles.sosButtonLoading,
            ]}
            onPress={handleStartSOS}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Start SOS emergency location sharing"
            accessibilityHint="Shares your location with CivicFix administrators and notifies them of an emergency">
            <Text style={styles.sosLabel}>{isLoading ? '…' : 'SOS'}</Text>
            {isLoading && loadingLabel ? (
              <Text style={styles.sosSubLabel}>{loadingLabel}</Text>
            ) : (
              <Text style={styles.sosSubLabel}>Tap to share location</Text>
            )}
          </Pressable>
        </View>

        {/* Duration selector */}
        <View style={styles.durationSection}>
          <Text style={styles.durationTitle}>Share for</Text>
          <View style={styles.durationRow}>
            {DURATIONS.map((d, i) => (
              <Pressable
                key={d.label}
                style={({ pressed }) => [
                  styles.chip,
                  i === selectedDuration && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => setSelected(i)}
                accessibilityRole="radio"
                accessibilityState={{ selected: i === selectedDuration }}
                accessibilityLabel={`Share for ${d.label}`}>
                <Text style={[styles.chipText, i === selectedDuration && styles.chipTextSelected]}>
                  {d.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Info card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>🔒 How SOS sharing works</Text>
          <Text style={styles.infoBody}>
            Pressing SOS immediately notifies CivicFix administrators and begins
            sharing your live location. Choose{' '}
            <Text style={{ fontWeight: '700' }}>"Allow all the time"</Text>{' '}
            when Android asks for location permission — this keeps sharing active
            even if you lock your screen or switch apps.{'\n\n'}
            A persistent notification appears while the session is active. Tap it
            any time to return to this app.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TEAL  = '#0D9488';
const SOS_SIZE = 180;
const PULSE_SIZE = SOS_SIZE + 52;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F0FDFA',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 24,
  },

  header: {
    paddingTop: 24,
    gap: 2,
  },
  greeting: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.4,
  },

  sosArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
  },
  pulseRing: {
    position: 'absolute',
    width: PULSE_SIZE,
    height: PULSE_SIZE,
    borderRadius: PULSE_SIZE / 2,
    backgroundColor: 'rgba(13, 148, 136, 0.12)',
  },
  sosButton: {
    width: SOS_SIZE,
    height: SOS_SIZE,
    borderRadius: SOS_SIZE / 2,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  sosButtonPressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  sosButtonLoading: { opacity: 0.72 },
  sosLabel: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 4,
  },
  sosSubLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.80)',
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 12,
  },

  durationSection: { gap: 10 },
  durationTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  durationRow: { flexDirection: 'row', gap: 10 },
  chip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  chipSelected:  { borderColor: TEAL },
  chipPressed:   { opacity: 0.7 },
  chipText:      { fontSize: 15, fontWeight: '600', color: '#374151' },
  chipTextSelected: { color: TEAL },

  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  infoTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  infoBody:  { fontSize: 13, lineHeight: 20, color: '#6B7280' },
});
