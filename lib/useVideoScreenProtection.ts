import { useEffect } from "react";
import { Platform } from "react-native";
import { reportCaptureAttempt } from "./report-admin-ops";

/**
 * Enhanced screen protection specifically for video playback.
 * Applies both expo-screen-capture (iOS) and FLAG_SECURE (Android) when playing local videos.
 * 
 * @param enabled - Whether to enable protection (should be true only during local video playback)
 */
export function useVideoScreenProtection(enabled: boolean = false, context: string = "video playback") {
  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;

    let cleanupFunctions: (() => void)[] = [];
    let screenshotSub: { remove: () => void } | null = null;

    // iOS: Use expo-screen-capture
    if (Platform.OS === "ios") {
      import("expo-screen-capture")
        .then((ScreenCapture) => {
          ScreenCapture.preventScreenCaptureAsync();
          cleanupFunctions.push(() => {
            ScreenCapture.allowScreenCaptureAsync();
          });
          if (typeof ScreenCapture.addScreenshotListener === "function") {
            screenshotSub = ScreenCapture.addScreenshotListener(() => {
              void reportCaptureAttempt({ kind: "screenshot", context });
            });
          }
        })
        .catch((err) => {
          console.warn("[VideoScreenProtection] Failed to load expo-screen-capture:", err);
        });
    }

    // Android: Use react-native-flag-secure
    if (Platform.OS === "android") {
      import("react-native-flag-secure")
        .then((FlagSecure) => {
          FlagSecure.default.activate();
          cleanupFunctions.push(() => {
            FlagSecure.default.deactivate();
          });
        })
        .catch((err) => {
          console.warn("[VideoScreenProtection] Failed to load react-native-flag-secure:", err);
        });
    }

    // Cleanup function
    return () => {
      screenshotSub?.remove();
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [enabled, context]);
}
