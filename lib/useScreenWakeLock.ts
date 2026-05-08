import { useEffect } from "react";
import { Platform } from "react-native";

/**
 * Keeps the device screen awake while the calling screen is mounted and
 * `enabled` is true. Use during live classes / video playback so the phone or
 * laptop doesn't sleep mid-stream.
 *
 * - Web: uses the Wake Lock API (`navigator.wakeLock.request("screen")`).
 *   Browsers (Chrome/Edge/Safari) auto-release the lock when the tab is hidden,
 *   so we re-acquire on `visibilitychange` after the tab becomes visible again.
 *   Older browsers without the API silently no-op.
 * - Native (iOS/Android): uses `expo-keep-awake` with a unique tag per mount so
 *   multiple awake-keepers don't cancel each other out.
 */
export function useScreenWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    if (Platform.OS === "web") {
      if (typeof document === "undefined" || typeof navigator === "undefined") return;

      let lock: { release?: () => Promise<void> } | null = null;
      let cancelled = false;

      const acquire = async () => {
        try {
          const nav = navigator as Navigator & {
            wakeLock?: { request: (type: "screen") => Promise<{ release?: () => Promise<void> }> };
          };
          if (!nav.wakeLock?.request) return;
          const next = await nav.wakeLock.request("screen");
          if (cancelled) {
            try { await next.release?.(); } catch { /* ignore */ }
            return;
          }
          lock = next;
        } catch {
          /* user gesture missing, OS denied, etc. — ignore */
        }
      };

      const onVisibility = () => {
        if (!document.hidden) void acquire();
      };

      void acquire();
      document.addEventListener("visibilitychange", onVisibility);

      return () => {
        cancelled = true;
        document.removeEventListener("visibilitychange", onVisibility);
        try { void lock?.release?.(); } catch { /* ignore */ }
        lock = null;
      };
    }

    let cancelled = false;
    const tag = `screen-wake-${Math.random().toString(36).slice(2)}`;
    void import("expo-keep-awake")
      .then((m) => {
        if (cancelled) return;
        return m.activateKeepAwakeAsync(tag);
      })
      .catch(() => { /* ignore */ });

    return () => {
      cancelled = true;
      void import("expo-keep-awake")
        .then((m) => m.deactivateKeepAwake(tag))
        .catch(() => { /* ignore */ });
    };
  }, [enabled]);
}
