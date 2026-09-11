/**
 * Login screen — entry point for unauthenticated users.
 *
 * Visual identity matches CivicFix's teal/amber palette.
 * Authenticated users are redirected away by the root layout.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import BrandMark from '@/components/BrandMark';

// ---------------------------------------------------------------------------
// CivicFix brand palette — teal primary, amber accent
// ---------------------------------------------------------------------------
const Brand = {
  // Teal — primary action colour
  teal: '#0D9488',
  tealDark: '#0F766E',
  tealLight: '#CCFBF1',
  tealXLight: '#F0FDFA',

  // Amber — secondary / highlight
  amber: '#D97706',
  amberLight: '#FEF3C7',

  // Neutrals
  textDark: '#0F172A',
  textMid: '#475569',
  textLight: '#94A3B8',
  surface: '#FFFFFF',
  border: '#CBD5E1',
  borderFocus: '#0D9488',

  // Feedback
  error: '#DC2626',
  errorBg: '#FEF2F2',
};

export default function LoginScreen() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setErrorMessage('Please enter your email address and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const error = await login(email.trim().toLowerCase(), password);

    setIsLoading(false);

    if (error) {
      setErrorMessage(error);
    }
    // On success, AuthContext sets user → root layout redirects to tabs
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* ── Hero ──────────────────────────────────────────────── */}
          <View style={styles.hero}>
            {/* Real logo icon — same SVG as web favicon, no accent dot */}
            <BrandMark size={72} />

            {/*
              Two-tone wordmark matching web's .cf-auth-logo markup:
                <span class="logo-text">Civic<span>Fix</span></span>
              «Civic» in textDark, «Fix» in amber, « SOS» smaller + textDark.
            */}
            <View style={styles.wordmarkRow}>
              <Text style={styles.wordmarkCivic}>Civic</Text>
              <Text style={styles.wordmarkFix}>Fix</Text>
              <Text style={styles.wordmarkSos}> SOS</Text>
            </View>

            <Text style={styles.tagline}>
              Emergency location sharing{'\n'}for your safety
            </Text>
          </View>

          {/* ── Form card ─────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in to your account</Text>
            <Text style={styles.cardSubtitle}>
              Use your existing CivicFix credentials
            </Text>

            {/* Error banner */}
            {errorMessage ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorIcon}>⚠</Text>
                <Text style={styles.errorBannerText}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Email field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email address</Text>
              <TextInput
                style={[
                  styles.input,
                  emailFocused && styles.inputFocused,
                  !!errorMessage && styles.inputError,
                ]}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholder="you@example.com"
                placeholderTextColor={Brand.textLight}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                returnKeyType="next"
                editable={!isLoading}
                accessibilityLabel="Email address"
              />
            </View>

            {/* Password field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={[
                  styles.input,
                  passwordFocused && styles.inputFocused,
                  !!errorMessage && styles.inputError,
                ]}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                placeholder="Your password"
                placeholderTextColor={Brand.textLight}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!isLoading}
                accessibilityLabel="Password"
              />
            </View>

            {/* Sign in button */}
            <Pressable
              style={({ pressed }) => [
                styles.loginButton,
                pressed && !isLoading && styles.loginButtonPressed,
                isLoading && styles.loginButtonLoading,
              ]}
              onPress={handleLogin}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ busy: isLoading }}>
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.loginButtonText}>Sign In</Text>
              )}
            </Pressable>
          </View>

          {/* ── Amber notice strip ────────────────────────────────── */}
          <View style={styles.noticeStrip}>
            <Text style={styles.noticeStripIcon}>🔒</Text>
            <Text style={styles.noticeStripText}>
              Your location is only shared when an SOS session is active.
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Brand.tealXLight,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },

  // ── Hero
  hero: {
    alignItems: 'center',
    paddingTop: 52,
    paddingBottom: 28,
    gap: 10,
  },

  // ── Wordmark
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
  },
  // «Civic» — same dark body colour as web's .logo-text (var(--cf-text) → textDark)
  wordmarkCivic: {
    fontSize: 30,
    fontWeight: '800',
    color: Brand.textDark,
    letterSpacing: -0.5,
  },
  // «Fix» — amber accent, matching web's .logo-text span (var(--cf-accent))
  // Reuses Brand.amber already defined above — no new hex value.
  wordmarkFix: {
    fontSize: 30,
    fontWeight: '800',
    color: Brand.amber,
    letterSpacing: -0.5,
  },
  // « SOS» — visually secondary: same dark colour as «Civic», smaller size
  wordmarkSos: {
    fontSize: 18,
    fontWeight: '700',
    color: Brand.textDark,
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 15,
    color: Brand.textMid,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Card
  card: {
    backgroundColor: Brand.surface,
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 6,
    gap: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Brand.textDark,
  },
  cardSubtitle: {
    fontSize: 13,
    color: Brand.textLight,
    marginTop: -8,
  },

  // Error banner
  errorBanner: {
    backgroundColor: Brand.errorBg,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: Brand.error,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  errorIcon: {
    fontSize: 14,
    color: Brand.error,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 14,
    color: Brand.error,
    lineHeight: 20,
  },

  // Fields
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Brand.textDark,
  },
  input: {
    height: 50,
    borderWidth: 1.5,
    borderColor: Brand.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: Brand.textDark,
    backgroundColor: '#F8FAFC',
  },
  inputFocused: {
    borderColor: Brand.borderFocus,
    backgroundColor: Brand.surface,
    shadowColor: Brand.teal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  inputError: {
    borderColor: Brand.error,
  },

  // Button — teal with amber undertone on press
  loginButton: {
    height: 52,
    backgroundColor: Brand.teal,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: Brand.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 6,
  },
  loginButtonPressed: {
    backgroundColor: Brand.tealDark,
    transform: [{ scale: 0.98 }],
  },
  loginButtonLoading: {
    opacity: 0.75,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  // ── Amber notice strip
  noticeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Brand.amberLight,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  noticeStripIcon: {
    fontSize: 16,
  },
  noticeStripText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
});
