/**
 * Active Session Screen — Phase 3.
 *
 * Full-screen screen (no tab bar) displayed while a CivicFix SOS session
 * is actively sharing location.  Navigated to from /sos-home after a session
 * is created; navigated away from when the session is stopped or expires.
 *
 * ── Sections ─────────────────────────────────────────────────────────────────
 *
 * 1. Live status banner — "Sharing • XX:XX:XX remaining"
 * 2. Animated pulse ring around a "LIVE" indicator
 * 3. "Stop Sharing" button — ends the backend session, stops the location
 *    service, clears SecureStore, navigates home.  Genuinely stops everything;
 *    there is no hidden continuation.
 * 4. "Add more time" — ends current session + starts new one with extra time.
 *    Tracking continues uninterrupted; the foreground service notification stays.
 * 5. Reliability note — honest, brief, not alarming.
 *
 * ── State management ──────────────────────────────────────────────────────────
 *
 * Session state is read from SecureStore on mount rather than from route params.
 * This makes the screen resilient to:
 *   - App being backgrounded and relaunched
 *   - Navigation stack being rebuilt
 *   - The user opening the app directly from the foreground-service notification
 *
 * ── Extend mechanics ─────────────────────────────────────────────────────────
 *
 * The backend has no "extend" endpoint — expiresAt is immutable once set.
 * Extending works by ending the current session and starting a new one with
 * the additional duration.  The background location service runs continuously
 * through this transition; only the session ID changes in SecureStore.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import Constants from 'expo-constants';

// True when running inside Expo Go (no RECEIVE_BOOT_COMPLETED permission).
// Background tracking falls back to foreground-only watchPositionAsync in this env.
const IS_EXPO_GO = Constants.appOwnership === 'expo';

import {
  isLocationTrackingActive,
  startLocationTracking,
  stopLocationTracking,
} from '@/services/backgroundLocation';
import {
  confirmSafe,
  endSession,
  fetchSessionMessages,
  pingSession,
  saveSessionNote,
  startSession,
  type SessionMessage,
} from '@/services/liveLocationService';
import {
  clearActiveSession,
  loadActiveSession,
  saveActiveSession,
  type ActiveSessionData,
} from '@/services/sessionStore';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEAL  = '#0D9488';
const RED   = '#B91C1C';

const EXTEND_OPTIONS = [
  { label: '+15 min', minutes: 15 },
  { label: '+30 min', minutes: 30 },
  { label: '+1 hr',   minutes: 60 },
  { label: '+4 hr',   minutes: 240 },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function secondsUntil(isoDate: string): number {
  return Math.max(0, Math.round((new Date(isoDate).getTime() - Date.now()) / 1000));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ActiveSessionScreen() {
  const router = useRouter();

  const [session, setSession]       = useState<ActiveSessionData | null>(null);
  const [remaining, setRemaining]   = useState(0);
  const [elapsed, setElapsed]       = useState(0);
  const [pingCount, setPingCount]   = useState(0);
  const [isStopping, setIsStopping] = useState(false);
  const [isExtending, setExtending] = useState(false);

  // Details panel
  const [showDetails, setShowDetails]   = useState(false);
  const [detailsText, setDetailsText]   = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteSaved, setNoteSaved]       = useState(false);
  const [noteError, setNoteError]       = useState('');

  // ── Messages panel (poll-only — NO OS notification, sound, or vibration) ──
  // ⚠️  STEALTH CONTRACT: these state values drive silent in-UI rendering only.
  //   Nothing here may ever call Vibration, Audio, Notifications, or any other
  //   OS-level alert mechanism.  The resident sees new messages ONLY while
  //   already looking at this screen.
  const [messages, setMessages]               = useState<SessionMessage[]>([]);
  const [newestMsgId, setNewestMsgId]         = useState<string | null>(null);

  // ── "I'm Safe" confirmation ─────────────────────────────────────────────
  // ⚠️  SAFETY CONTRACT: confirming safe must NEVER stop tracking, end the
  //   session, or alter session.status in any way — purely informational.
  const [safeConfirmed, setSafeConfirmed]     = useState(false);
  const [isConfirmingSafe, setConfirmingSafe] = useState(false);
  const [safeError, setSafeError]             = useState('');

  // Pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // Timers
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Separate message-poll interval — must NEVER use any OS notification API.
  const msgPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks message _ids already displayed to detect new arrivals without
  // re-rendering the entire list or touching any OS alert layer.
  const seenMsgIdsRef = useRef<Set<string>>(new Set());
  const elapsedRef    = useRef(0);
  const sessionStart  = useRef(Date.now());

  // ── Mount ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const stored = await loadActiveSession();
      if (!stored) {
        // No active session — navigate back to SOS home
        router.replace('/(app)');
        return;
      }
      setSession(stored);
      setRemaining(secondsUntil(stored.expiresAt));
      startPulse();
      startTimers(stored.expiresAt);
      startMsgPoll(stored.sessionId);
    }
    init();

    return () => {
      stopPulse();
      clearTimers();
      clearMsgPoll();
    };
  }, []);

  // ── Animation ───────────────────────────────────────────────────────────────

  const startPulse = useCallback(() => {
    pulseAnim.setValue(1);
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.22,
          duration: 1000,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.in(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  // ── Countdown / elapsed timers ──────────────────────────────────────────────

  function startTimers(expiresAt: string) {
    sessionStart.current = Date.now();
    countdownRef.current = setInterval(() => {
      const rem = secondsUntil(expiresAt);
      setRemaining(rem);
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);

      if (rem <= 0) {
        // Expired — clean up locally (background task already handled backend)
        handleExpired();
      }
    }, 1000);
  }

  function clearTimers() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }

  // ── Message polling ──────────────────────────────────────────────────────
  //
  // ⚠️  STEALTH CONTRACT — read before modifying any function in this block:
  //
  //   pollMessages MUST NOT call Vibration, Notifications, Audio, or any OS API.
  //   New messages are silently rendered in-UI; the resident discovers them only
  //   by looking at this screen.  Any OS-level alert would defeat the feature's
  //   entire purpose and could endanger someone hiding their phone from a threat.

  async function pollMessages(sessionId: string): Promise<void> {
    const incoming = await fetchSessionMessages(sessionId);
    if (incoming.length === 0) return;

    const isFirstPoll = seenMsgIdsRef.current.size === 0;
    const newMsgs     = incoming.filter((m) => !seenMsgIdsRef.current.has(m._id));

    if (isFirstPoll || newMsgs.length > 0) {
      // Mark all current messages as seen
      incoming.forEach((m) => seenMsgIdsRef.current.add(m._id));
      setMessages(incoming);

      // Brief highlight for newly-arrived messages only (no sound/vibration)
      if (!isFirstPoll && newMsgs.length > 0) {
        const latestNew = newMsgs[newMsgs.length - 1];
        setNewestMsgId(latestNew._id);
        setTimeout(() => setNewestMsgId(null), 8_000);
      }
    }
  }

  function startMsgPoll(sessionId: string): void {
    clearMsgPoll();
    // Fire immediately, then every 13 seconds
    void pollMessages(sessionId);
    msgPollRef.current = setInterval(() => void pollMessages(sessionId), 13_000);
  }

  function clearMsgPoll(): void {
    if (msgPollRef.current) {
      clearInterval(msgPollRef.current);
      msgPollRef.current = null;
    }
  }

  // ── Session expired ─────────────────────────────────────────────────────────

  async function handleExpired() {
    clearTimers();
    clearMsgPoll();
    stopPulse();
    await Promise.all([
      stopLocationTracking(),
      clearActiveSession(),
    ]);
    Alert.alert(
      'Session Expired',
      'Your SOS location sharing session has ended. Your full location trail is saved and visible to CivicFix administrators.',
      [{ text: 'OK', onPress: () => router.replace('/(app)') }],
    );
  }

  // ── Stop sharing ─────────────────────────────────────────────────────────────

  function confirmStop() {
    Alert.alert(
      'End SOS Session?',
      'This will immediately stop sharing your location and dismiss the notification. Your location trail up to now is preserved.',
      [
        { text: 'Keep Sharing', style: 'cancel' },
        { text: 'End Session',  style: 'destructive', onPress: handleStop },
      ],
    );
  }

  async function handleStop() {
    setIsStopping(true);
    clearTimers();
    clearMsgPoll();
    stopPulse();
    try {
      if (session) {
        await endSession(session.sessionId); // best-effort — swallows errors
      }
    } finally {
      await Promise.all([
        stopLocationTracking(),
        clearActiveSession(),
      ]);
      router.replace('/(app)');
    }
  }

  // ── "I'm Safe" confirmation ────────────────────────────────────────────────
  //
  // ⚠️  SAFETY CONTRACT: This function MUST NOT stop tracking, end the session,
  //   or alter session state in any way.  It stamps a single timestamp on the
  //   backend to inform admins — nothing more.  Location sharing continues
  //   completely unaffected.
  //
  //   Do NOT add any of the following here:
  //     - stopLocationTracking()  - clearTimers() / clearMsgPoll()
  //     - stopPulse()             - clearActiveSession()
  //     - router.replace(...)     - setIsStopping(true)

  async function handleConfirmSafe() {
    if (!session) return;
    setConfirmingSafe(true);
    setSafeError('');
    try {
      await confirmSafe(session.sessionId);
      setSafeConfirmed(true);
      // Intentionally nothing else — session, timers, and tracking untouched.
    } catch (err) {
      setSafeError(
        err instanceof Error
          ? err.message
          : 'Could not send confirmation. Please try again.',
      );
    } finally {
      setConfirmingSafe(false);
    }
  }

  // ── Save details note ─────────────────────────────────────────────────────────

  async function handleSaveDetails() {
    if (!session || !detailsText.trim()) return;
    setIsSavingNote(true);
    setNoteError('');
    try {
      await saveSessionNote(session.sessionId, detailsText.trim());
      setNoteSaved(true);
      // Reset "Saved" badge after 3 s — same behaviour as the web version
      setTimeout(() => setNoteSaved(false), 3000);
    } catch (err) {
      setNoteError(
        err instanceof Error ? err.message : 'Failed to save details. Please try again.',
      );
    } finally {
      setIsSavingNote(false);
    }
  }

  // ── Extend session ────────────────────────────────────────────────────────────

  function showExtendOptions() {
    Alert.alert(
      'Add More Time',
      'Extend your session by ending the current one and starting a new one.\n\nLocation tracking will continue without interruption.',
      [
        ...EXTEND_OPTIONS.map((opt) => ({
          text: opt.label,
          onPress: () => handleExtend(opt.minutes),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }

  async function handleExtend(extraMinutes: number) {
    if (!session) return;
    setExtending(true);
    try {
      // 1. Get a fresh location fix for the new session's initial point
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // 2. End the current backend session
      await endSession(session.sessionId);

      // 3. Start a new backend session with the added time
      const newSessionData = await startSession({
        durationMinutes: extraMinutes,
        latitude:        fix.coords.latitude,
        longitude:       fix.coords.longitude,
        accuracy:        fix.coords.accuracy,
      });

      // 4. Update SecureStore (background task picks up new sessionId on next ping)
      const newStored: ActiveSessionData = {
        sessionId: newSessionData.sessionId,
        reportId:  newSessionData.reportId,
        expiresAt: newSessionData.expiresAt,
      };
      await saveActiveSession(newStored);

      // 5. Ensure tracking is still running (may have stopped due to 410)
      const tracking = await isLocationTrackingActive();
      if (!tracking) await startLocationTracking();

      // 6. Update local state, restart timers, and restart message poll
      clearTimers();
      clearMsgPoll();
      // Reset message state so stale messages from the old session don't linger
      seenMsgIdsRef.current = new Set();
      setMessages([]);
      setNewestMsgId(null);
      setSafeConfirmed(false);
      setSafeError('');
      setSession(newStored);
      elapsedRef.current = 0;
      setElapsed(0);
      setRemaining(secondsUntil(newSessionData.expiresAt));
      setPingCount(0);
      startTimers(newSessionData.expiresAt);
      startMsgPoll(newStored.sessionId);

    } catch (err) {
      Alert.alert(
        'Could Not Extend',
        err instanceof Error ? err.message : 'An error occurred. Please try again.',
      );
    } finally {
      setExtending(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const remainingLabel = formatDuration(remaining);
  const elapsedLabel   = formatDuration(elapsed);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* ── Status banner ─────────────────────────────────────────── */}
        <View style={styles.banner}>
          <View style={styles.liveDot} />
          <Text style={styles.bannerText}>SHARING LIVE LOCATION</Text>
        </View>

        {/* ── Expo Go warning ───────────────────────────────────────── */}
        {IS_EXPO_GO && (
          <View style={styles.expoGoCard}>
            <Text style={styles.expoGoTitle}>⚠️ Expo Go — Foreground Only</Text>
            <Text style={styles.expoGoBody}>
              {'In Expo Go, pings pause when you switch away from the app. This is\n' +
               'sufficient to test the full API flow right now.\n\n' +
               'For full background support, create a dev build:\n' +
               '  npx eas build --profile development --platform android'}
            </Text>
          </View>
        )}

        {/* ── Pulse indicator ───────────────────────────────────────── */}
        <View style={styles.pulseArea}>
          <Animated.View
            style={[styles.pulseRing, { transform: [{ scale: pulseAnim }] }]}
          />
          <View style={styles.liveCircle}>
            <Text style={styles.liveLabel}>LIVE</Text>
            <Text style={styles.liveSubLabel}>{remainingLabel}</Text>
            <Text style={styles.liveCaption}>remaining</Text>
          </View>
        </View>

        {/* ── Stats row ────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{elapsedLabel}</Text>
            <Text style={styles.statLabel}>Elapsed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{remainingLabel}</Text>
            <Text style={styles.statLabel}>Remaining</Text>
          </View>
        </View>

        {/* ── Stop button ───────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [
            styles.stopButton,
            pressed     && styles.stopButtonPressed,
            isStopping  && styles.stopButtonLoading,
          ]}
          onPress={confirmStop}
          disabled={isStopping || isExtending}
          accessibilityRole="button"
          accessibilityLabel="Stop sharing my location">
          <Text style={styles.stopButtonLabel}>
            {isStopping ? 'Stopping…' : '■  Stop Sharing'}
          </Text>
        </Pressable>

        {/* ── Extend button ─────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.extendButton, pressed && styles.extendButtonPressed]}
          onPress={showExtendOptions}
          disabled={isStopping || isExtending}
          accessibilityRole="button"
          accessibilityLabel="Add more time to the session">
          <Text style={styles.extendLabel}>
            {isExtending ? 'Renewing session…' : '+ Add more time'}
          </Text>
        </Pressable>

        {/* ── Add details ───────────────────────────────────────────── */}
        <View style={styles.detailsCard}>
          {/* Collapsible toggle — matching web's expand/collapse pattern */}
          <Pressable
            style={styles.detailsToggle}
            onPress={() => setShowDetails((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showDetails ? 'Hide details panel' : 'Add details about what is happening'}
            accessibilityState={{ expanded: showDetails }}>
            <Text style={styles.detailsToggleLabel}>
              {showDetails ? '▲  Hide' : '✏️  Add details'} — describe what's happening
            </Text>
          </Pressable>

          {showDetails && (
            <View style={styles.detailsBody}>
              <TextInput
                style={styles.detailsInput}
                value={detailsText}
                onChangeText={setDetailsText}
                placeholder="e.g. Being followed by a man in a red car on Main St. I'm heading towards the library."
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                accessibilityLabel="Describe what is happening"
              />

              <Pressable
                style={({ pressed }) => [
                  styles.saveButton,
                  (!detailsText.trim() || isSavingNote) && styles.saveButtonDisabled,
                  pressed && detailsText.trim() && !isSavingNote && styles.saveButtonPressed,
                ]}
                onPress={handleSaveDetails}
                disabled={!detailsText.trim() || isSavingNote}
                accessibilityRole="button"
                accessibilityLabel="Save details">
                <Text style={styles.saveButtonLabel}>
                  {isSavingNote ? 'Saving…' : noteSaved ? '✓ Saved' : 'Save details'}
                </Text>
              </Pressable>

              {noteError !== '' && (
                <Text style={styles.noteErrorText}>{noteError}</Text>
              )}
            </View>
          )}
        </View>

        {/* ── Admin messages (silent poll — no OS notification ever) ─── */}
        {/*                                                                 */}
        {/* ⚠️  STEALTH: This panel is intentionally silent.  Messages    */}
        {/*    appear in-UI only.  Nothing here may call Vibration, Audio, */}
        {/*    Notifications, or any other OS alert mechanism.             */}
        <View style={styles.msgCard}>
          <Text style={styles.msgCardTitle}>💬 Messages from the monitoring team</Text>

          {messages.length === 0 ? (
            <Text style={styles.msgEmptyText}>
              No messages yet. If the monitoring team sends you a message it will
              appear here quietly — no notification or sound will be triggered.
            </Text>
          ) : (
            <View style={styles.msgList}>
              {messages.map((msg) => (
                <View
                  key={msg._id}
                  style={[
                    styles.msgBubble,
                    newestMsgId === msg._id && styles.msgBubbleNew,
                  ]}>
                  <Text style={styles.msgText}>{msg.text}</Text>
                  <Text style={styles.msgMeta}>
                    {msg.sender?.name ?? 'Monitoring team'}
                    {' · '}
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour:   '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── "I'm Safe" button ──────────────────────────────────── */}
          {/* ⚠️  This must NEVER stop tracking or change the session. */}
          {/*    It only informs admins; sharing continues as-is.      */}
          {safeConfirmed ? (
            <View style={styles.safeConfirmedBanner}>
              <Text style={styles.safeConfirmedText}>
                ✓ Admins have been notified. Sharing continues.
              </Text>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.safeButton,
                pressed          && styles.safeButtonPressed,
                isConfirmingSafe && styles.safeButtonLoading,
              ]}
              onPress={handleConfirmSafe}
              disabled={isConfirmingSafe || isStopping}
              accessibilityRole="button"
              accessibilityLabel="I'm Safe — notify the monitoring team">
              <Text style={styles.safeButtonLabel}>
                {isConfirmingSafe ? 'Sending…' : "✓  I'm Safe"}
              </Text>
            </Pressable>
          )}

          {safeError !== '' && (
            <Text style={styles.safeErrorText}>{safeError}</Text>
          )}
        </View>

        {/* ── Reliability note ─────────────────────────────────────── */}
        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>📡 About background reliability</Text>
          <Text style={styles.noteBody}>
            {IS_EXPO_GO
              ? 'You are running in Expo Go. Location sharing works while this screen ' +
                'is active but pauses when you switch apps or lock the screen — ' +
                'the same limitation as the web version. Build a development client ' +
                'to enable the full foreground-service background tracking.'
              : 'This build uses Android\'s foreground-service mechanism, which is ' +
                'significantly more reliable than the browser-based web version. ' +
                'Most devices continue sharing even when the screen is locked or ' +
                'another app is open.\n\nSome manufacturers (Samsung, Xiaomi, Huawei) ' +
                'aggressively manage battery. If sharing reliability matters on your ' +
                'device, disable battery optimisation for CivicFix SOS in Settings.'}
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const LIVE_SIZE  = 160;
const PULSE_SIZE = LIVE_SIZE + 60;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F0FDFA',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#6B7280',
  },

  // Banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: TEAL,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1.5,
  },

  // Pulse
  pulseArea: {
    alignItems: 'center',
    justifyContent: 'center',
    height: PULSE_SIZE + 40,
  },
  pulseRing: {
    position: 'absolute',
    width: PULSE_SIZE,
    height: PULSE_SIZE,
    borderRadius: PULSE_SIZE / 2,
    backgroundColor: 'rgba(13, 148, 136, 0.15)',
  },
  liveCircle: {
    width: LIVE_SIZE,
    height: LIVE_SIZE,
    borderRadius: LIVE_SIZE / 2,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 14,
  },
  liveLabel: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 3,
  },
  liveSubLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.95)',
    letterSpacing: 1,
  },
  liveCaption: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.70)',
    letterSpacing: 0.5,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9CA3AF',
    marginTop: 2,
  },

  // Stop button
  stopButton: {
    backgroundColor: RED,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: RED,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  stopButtonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  stopButtonLoading: { opacity: 0.65 },
  stopButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  // Extend button
  extendButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: TEAL,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  extendButtonPressed: { opacity: 0.7 },
  extendLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: TEAL,
  },

  // Reliability note
  noteCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#D97706',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  noteTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400E',
  },
  noteBody: {
    fontSize: 13,
    lineHeight: 20,
    color: '#78716C',
  },

  // Details card
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  detailsToggle: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  detailsToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: TEAL,
  },
  detailsBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  detailsInput: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: '#111827',
    minHeight: 96,
    lineHeight: 20,
  },
  saveButton: {
    backgroundColor: TEAL,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonPressed: {
    opacity: 0.80,
    transform: [{ scale: 0.98 }],
  },
  saveButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  noteErrorText: {
    fontSize: 13,
    color: '#B91C1C',
    marginTop: 2,
  },

  // Expo Go warning
  expoGoCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  expoGoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  expoGoBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#78350F',
    fontFamily: 'monospace',
  },

  // ── Messages panel ──────────────────────────────────────────────────────
  msgCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderLeftWidth: 3,
    borderLeftColor: TEAL,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  msgCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#065F46',
  },
  msgEmptyText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  msgList: {
    gap: 8,
  },
  msgBubble: {
    backgroundColor: '#F0FDFA',
    borderRadius: 10,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  // Brief teal-tinted highlight for newly-arrived messages
  msgBubbleNew: {
    backgroundColor: '#CCFBF1',
    borderColor: TEAL,
  },
  msgText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#111827',
  },
  msgMeta: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },

  // ── "I'm Safe" button ──────────────────────────────────────────────────
  safeButton: {
    backgroundColor: '#064E3B',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    shadowColor: '#064E3B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 10,
    elevation: 6,
  },
  safeButtonPressed: {
    opacity: 0.80,
    transform: [{ scale: 0.98 }],
  },
  safeButtonLoading: {
    opacity: 0.60,
  },
  safeButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  safeConfirmedBanner: {
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  safeConfirmedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#065F46',
    textAlign: 'center',
  },
  safeErrorText: {
    fontSize: 12,
    color: '#B91C1C',
    marginTop: 2,
  },
});
