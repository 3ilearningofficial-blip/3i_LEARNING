import type { Router } from "expo-router";

/** Reliable back navigation for admin flows (wizard uses router.replace and can empty history). */
export function adminGoBack(router: Router, fallback: "/admin" | "/(tabs)" = "/admin") {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback as any);
  }
}
