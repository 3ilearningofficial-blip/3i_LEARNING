import { Platform } from "react-native";
import { router } from "expo-router";

/**
 * Drop DOM focus before a screen transition (web only).
 *
 * expo-router / react-native-screens keeps the outgoing screen mounted but hides
 * it with `display:none` + `aria-hidden="true"`. If the control the user just
 * clicked still holds focus inside that hidden screen, Chrome logs the
 * "Blocked aria-hidden … descendant retained focus" accessibility warning.
 * Blurring the active element first leaves nothing focusable behind.
 */
export function blurActiveElementWeb() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const el = document.activeElement as HTMLElement | null;
  if (el && typeof el.blur === "function") el.blur();
}

/** Prefer history back; if stack is empty, web returns home and native stays in auth. */
export function navigateBackFromAuth() {
  blurActiveElementWeb();
  if (router.canGoBack()) router.back();
  else router.replace(Platform.OS === "web" ? "/welcome" : "/(auth)/email-login");
}
