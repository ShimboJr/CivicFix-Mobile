/**
 * Account screen — Phase 1.
 *
 * Shows user account information and provides the logout action.
 * Will eventually link to the CivicFix web app for non-SOS features.
 */

import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AccountScreen() {
  const { user, logout } = useAuth();
  const theme = useTheme();

  function handleLogout() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of CivicFix SOS?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: logout,
        },
      ],
    );
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '?';

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
      edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: BottomTabInset + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}>

        {/* ── Page header ──────────────────────────────────────────── */}
        <View style={styles.pageHeader}>
          <Text style={[styles.pageTitle, { color: theme.text }]}>Account</Text>
        </View>

        {/* ── Avatar + name card ───────────────────────────────────── */}
        <View style={[styles.profileCard, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: theme.text }]}>
              {user?.name ?? 'CivicFix User'}
            </Text>
            <Text style={[styles.profileEmail, { color: theme.textSecondary }]}>
              {user?.email ?? '—'}
            </Text>
          </View>
        </View>

        {/* ── Info rows ─────────────────────────────────────────────── */}
        <View style={[styles.infoSection, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>
              User ID
            </Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>
              {user?.id ?? '—'}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>
              App version
            </Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>1.0.0</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>
              Session
            </Text>
            <Text style={[styles.infoValueGreen]}>Active</Text>
          </View>
        </View>

        {/* ── Sign out button ───────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [
            styles.logoutButton,
            { backgroundColor: theme.backgroundElement },
            pressed && styles.logoutButtonPressed,
          ]}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Sign out">
          <Text style={styles.logoutButtonText}>Sign Out</Text>
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },

  // Header
  pageHeader: {
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },

  // Profile card
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileInfo: {
    flex: 1,
    gap: 3,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '600',
  },
  profileEmail: {
    fontSize: 14,
  },

  // Info section
  infoSection: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  infoLabel: {
    fontSize: 15,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  infoValueGreen: {
    fontSize: 15,
    fontWeight: '600',
    color: '#22C55E',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },

  // Sign out
  logoutButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutButtonPressed: {
    opacity: 0.7,
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E53E3E',
  },
});
