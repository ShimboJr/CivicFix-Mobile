/**
 * Authenticated app layout — tab navigator.
 *
 * This layout only renders for authenticated routes: /  and /explore.
 * The login route lives at the root level and is handled by the root layout.
 * Expo Router's route groups ( (app) ) keep these routes separate from login.
 */

import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme ?? 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>

      {/* SOS home tab */}
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>SOS</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {/* Account tab */}
      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

    </NativeTabs>
  );
}
