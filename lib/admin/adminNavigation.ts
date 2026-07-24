import { Platform } from "react-native";
import type { Router } from "expo-router";

/**
 * Tab child routes staff/admins may open from the web app header (student-facing views).
 * Kept under the ADMIN_* name for existing call sites; staff uses the same allowlist.
 */
export const ADMIN_WEB_STUDENT_TAB_ROUTES = new Set([
  "daily-mission",
  "test-series",
  "support-chat-tab",
  "ai-tutor",
]);

/** Alias — teachers/managers may browse the same student tab children as admins. */
export const STAFF_WEB_STUDENT_TAB_ROUTES = ADMIN_WEB_STUDENT_TAB_ROUTES;

export function isAdminWebStudentTabRoute(tabChild: string | undefined): boolean {
  return ADMIN_WEB_STUDENT_TAB_ROUTES.has(String(tabChild || ""));
}

export function isStaffWebStudentTabRoute(tabChild: string | undefined): boolean {
  return isAdminWebStudentTabRoute(tabChild);
}

/**
 * App home for a user leaving the admin/staff panels.
 * On web, staff/admins use `/home` (not `/(tabs)/index`).
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
  const target = fallback === "/(tabs)" ? getAppHomeRoute() : fallback;
  router.replace(target as any);
}

/** Leave the admin/staff panel and return to the student-facing app home. */
export function adminBackToApp(router: Router) {
  backToApp(router);
}

/** Leave admin or Teacher Dashboard and return to the student-facing app home. */
export function backToApp(router: Router) {
  const target = getAppHomeRoute();
  // On web, expo-router's `replace` can intermittently fail to re-render when
  // leaving the admin panel. `push` matches WebAppHeader and always lands home.
  // Native keeps `replace` so the panel stack does not grow.
  if (Platform.OS === "web") {
    router.push(target as any);
  } else {
    router.replace(target as any);
  }
}
