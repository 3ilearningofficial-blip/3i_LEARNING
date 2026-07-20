import { Platform } from "react-native";
import type { Router } from "expo-router";

/** Tab child routes admins may open from the web app header (student-facing views). */
export const ADMIN_WEB_STUDENT_TAB_ROUTES = new Set([
  "daily-mission",
  "test-series",
  "support-chat-tab",
  "ai-tutor",
]);

export function isAdminWebStudentTabRoute(tabChild: string | undefined): boolean {
  return ADMIN_WEB_STUDENT_TAB_ROUTES.has(String(tabChild || ""));
}

/**
 * App home for a user leaving the admin/staff panels.
 * On web, admins use `/home` (not `/(tabs)/index`, which redirects to `/admin`).
 * Student tab screens linked from the web header remain reachable under `/(tabs)/…`.
 */
export function getAppHomeRoute(): "/home" | "/(tabs)" {
  return Platform.OS === "web" ? "/home" : "/(tabs)";
}

/** Reliable back navigation for admin flows (wizard uses router.replace and can empty history). */
export function adminGoBack(router: Router, fallback: "/admin" | "/(tabs)" | "/home" = "/admin") {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  // On web, `/(tabs)` is not reachable by admins — map it to the real app home.
  const target = fallback === "/(tabs)" ? getAppHomeRoute() : fallback;
  router.replace(target as any);
}

/** Leave the admin panel and return to the student-facing app home. */
export function adminBackToApp(router: Router) {
  const target = getAppHomeRoute();
  // On web, expo-router's `replace` can intermittently fail to re-render when
  // leaving the admin panel (the "back button does nothing sometimes" bug).
  // `push` matches the reliable WebAppHeader navigation and always lands on the
  // app home. Native keeps `replace` so the admin stack does not grow.
  if (Platform.OS === "web") {
    router.push(target as any);
  } else {
    router.replace(target as any);
  }
}
