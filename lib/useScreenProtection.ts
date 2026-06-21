import { useEffect } from "react";
import { Platform } from "react-native";
import { reportCaptureAttempt } from "./report-admin-ops";

/**
 * Prevents screenshots and screen recording.
 * - Native (iOS/Android): Uses expo-screen-capture to block screenshots & recording
 * - Web: Adds CSS to black out content during print/screen capture attempts,
 *   disables right-click, and blocks common screenshot shortcuts
 */
export function useScreenProtection(enabled: boolean = true, context?: string) {
  useEffect(() => {
    if (!enabled) return;

    if (Platform.OS !== "web") {
      // Native: use expo-screen-capture
      let cleanup: (() => void) | undefined;
      let screenshotSub: { remove: () => void } | null = null;
      import("expo-screen-capture").then((ScreenCapture) => {
        ScreenCapture.preventScreenCaptureAsync();
        cleanup = () => {
          ScreenCapture.allowScreenCaptureAsync();
        };
        if (typeof ScreenCapture.addScreenshotListener === "function") {
          screenshotSub = ScreenCapture.addScreenshotListener(() => {
            void reportCaptureAttempt({ kind: "screenshot", context });
          });
        }
      }).catch(() => {});
      return () => {
        screenshotSub?.remove();
        cleanup?.();
      };
    }

    const ctx = context || "protected content";

    // Web: add protections
    // 1. CSS to black out on print / screen capture
    const style = document.createElement("style");
    style.id = "screen-protect-css";
    style.textContent = `
      @media print { body { display: none !important; } }
      body { -webkit-user-select: none; user-select: none; }
    `;
    document.head.appendChild(style);

    // 2. Block right-click
    const blockContext = (e: MouseEvent) => { e.preventDefault(); };
    document.addEventListener("contextmenu", blockContext);

    // 3. Block common screenshot shortcuts (PrintScreen, Ctrl+Shift+S, etc.)
    const blockKeys = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        document.body.style.filter = "blur(30px)";
        setTimeout(() => { document.body.style.filter = ""; }, 1500);
        void reportCaptureAttempt({ kind: "screenshot", context: ctx });
      }
      // Ctrl+Shift+S (screenshot tools)
      if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        void reportCaptureAttempt({ kind: "screenshot", context: ctx });
      }
      // Ctrl+P (print)
      if (e.ctrlKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", blockKeys);

    // 4. Detect visibility change (tab switch during screen capture)
    const onVisibilityChange = () => {
      if (document.hidden) {
        document.body.style.filter = "blur(30px)";
      } else {
        document.body.style.filter = "";
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      const el = document.getElementById("screen-protect-css");
      if (el) el.remove();
      document.removeEventListener("contextmenu", blockContext);
      document.removeEventListener("keydown", blockKeys);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.body.style.filter = "";
    };
  }, [enabled, context]);
}
