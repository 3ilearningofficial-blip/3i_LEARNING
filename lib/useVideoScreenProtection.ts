import { useEffect } from "react";
import { Platform } from "react-native";

/**
 * Enhanced screen protection specifically for video playback.
 * Applies both expo-screen-capture (iOS) and FLAG_SECURE (Android) when playing local videos.
 * 
 * @param enabled - Whether to enable protection (should be true only during local video playback)
 */
export function useVideoScreenProtection(enabled: boolean = false) {
  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;

    let cleanupFunctions: Array<() => void> = [];

    // iOS: Use expo-screen-capture
    if (Platform.OS === "ios") {
      import("expo-screen-capture")
        .then((ScreenCapture) => {
          ScreenCapture.preventScreenCaptureAsync();
          cleanupFunctions.push(() => {
            ScreenCapture.allowScreenCaptureAsync();
          });
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
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [enabled]);
}
