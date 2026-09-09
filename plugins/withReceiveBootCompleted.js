/**
 * withReceiveBootCompleted.js
 *
 * Expo config plugin that adds android.permission.RECEIVE_BOOT_COMPLETED to
 * the AndroidManifest.xml during expo prebuild / EAS Build.
 *
 * WHY THIS IS NEEDED
 * ──────────────────
 * expo-task-manager uses Android's JobScheduler to schedule background jobs.
 * When a location update arrives, LocationTaskConsumer calls
 * TaskManagerUtils.scheduleJob() which internally calls:
 *
 *   JobScheduler.schedule(JobInfo.Builder(...).setPersisted(true).build())
 *
 * Android enforces that any app calling setPersisted(true) must declare
 * RECEIVE_BOOT_COMPLETED in its manifest — otherwise the system throws:
 *
 *   IllegalArgumentException: Error: requested job be persisted without
 *   holding RECEIVE_BOOT_COMPLETED permission.
 *
 * expo-task-manager's library AndroidManifest.xml registers the
 * TaskBroadcastReceiver and TaskJobService (merged by Gradle ✓), but does NOT
 * include the permission declaration — that must come from the app manifest.
 *
 * expo-task-manager's own config plugin (withTaskManager) only modifies the
 * iOS plist (UIBackgroundModes: fetch) and adds nothing to Android.
 * expo-location's config plugin adds FOREGROUND_SERVICE and
 * ACCESS_BACKGROUND_LOCATION but also does not add RECEIVE_BOOT_COMPLETED.
 *
 * Result: without this plugin, every standalone Android APK produced by
 * EAS Build will crash on the first background location event.
 *
 * REFERENCE
 * ─────────
 * Android docs: https://developer.android.com/reference/android/app/job/JobInfo.Builder#setPersisted(boolean)
 * "This requires the RECEIVE_BOOT_COMPLETED permission."
 */

const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSION = 'android.permission.RECEIVE_BOOT_COMPLETED';

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
const withReceiveBootCompleted = (config) =>
  withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // Ensure the top-level uses-permission array exists
    if (!manifest.manifest['uses-permission']) {
      manifest.manifest['uses-permission'] = [];
    }

    const permissions = manifest.manifest['uses-permission'];

    // Idempotent: only add if not already present
    const alreadyPresent = permissions.some(
      (p) => p.$ && p.$['android:name'] === PERMISSION,
    );

    if (!alreadyPresent) {
      permissions.push({ $: { 'android:name': PERMISSION } });
    }

    return config;
  });

module.exports = withReceiveBootCompleted;
