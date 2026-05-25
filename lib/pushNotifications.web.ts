/**
 * Web stub for pushNotifications.ts
 *
 * Metro bundler automatically picks up .web.ts files for web builds,
 * so expo-notifications is never imported on web — preventing the
 * "[expo-notifications] Listening to push token changes is not yet
 * fully supported on web" console warning.
 *
 * All functions are no-ops: web does not support Expo push tokens.
 */

export async function registerPushForCurrentUser(): Promise<string | null> {
  return null;
}

export async function unregisterPushForCurrentUser(): Promise<void> {
  // no-op on web
}
