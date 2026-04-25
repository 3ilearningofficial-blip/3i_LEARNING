import { Platform } from "react-native";

/**
 * Detects if Android mobile web access should be gated.
 * By default this is disabled so Android phone web works like desktop web.
 * Set EXPO_PUBLIC_ENABLE_ANDROID_WEB_GATE=true when you want to re-enable app-only gating.
 */
export function isAndroidWeb(): boolean {
  if (Platform.OS !== "web") return false;
  if (process.env.EXPO_PUBLIC_ENABLE_ANDROID_WEB_GATE !== "true") return false;
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isMobile = window.innerWidth < 768;
  return isAndroid && isMobile;
}
