import { Platform } from "react-native";

/**
 * Detects if the user is on Android mobile web browser.
 * Returns true if content should be blocked (redirect to app download).
 */
export function isAndroidWeb(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isMobile = window.innerWidth < 768;
  return isAndroid && isMobile;
}
