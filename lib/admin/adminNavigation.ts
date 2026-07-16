import { Platform } from "react-native";
import type { Router } from "expo-router";

/**
 * App home for a user leaving the admin/staff panels.
 * Admins are redirected away from `/(tabs)` on web (root layout bounces them
 * back to `/admin`), so web must use the student-facing `/home` route instead.
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

/** Leave the admin panel and return to the student-facing app home (history-independent). */
export function adminBackToApp(router: Router) {
  router.replace(getAppHomeRoute() as any);
}
