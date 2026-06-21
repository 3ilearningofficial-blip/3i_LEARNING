import { Platform } from "react-native";
import { apiRequest } from "./query-client";

let appInstallReported = false;

function isStandalonePwa(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
  } catch {
    return false;
  }
}

/** Fire-and-forget: notify admins once per app session when student installs or opens PWA/native app. */
export async function reportAppInstallOnce(): Promise<void> {
  if (appInstallReported) return;
  appInstallReported = true;

  const platform =
    Platform.OS === "web"
      ? "web"
      : Platform.OS === "ios"
        ? "ios"
        : Platform.OS === "android"
          ? "android"
          : String(Platform.OS);

  const isPwa = Platform.OS === "web" && isStandalonePwa();

  await apiRequest("POST", "/api/analytics/app-install", { platform, isPwa }).catch(() => {});
}

export function setupPwaInstallListener(): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => {};
  const handler = () => {
    void reportAppInstallOnce();
  };
  window.addEventListener("appinstalled", handler);
  return () => window.removeEventListener("appinstalled", handler);
}

/** Fire-and-forget: notify admins of screenshot/recording attempt during protected content. */
export async function reportCaptureAttempt(opts: {
  kind: "screenshot" | "recording";
  context?: string;
}): Promise<void> {
  await apiRequest("POST", "/api/security/capture-attempt", {
    kind: opts.kind,
    context: opts.context || "protected content",
  }).catch(() => {});
}
