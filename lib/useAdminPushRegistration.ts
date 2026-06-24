import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  ensurePushRegisteredWithGesture,
  getWebPushConnectionStatus,
  registerPushForCurrentUser,
  type WebPushConnectionStatus,
} from "@/lib/pushNotifications";

const DISMISS_KEY = "admin_push_connected_banner_dismissed";
const AUTO_HIDE_MS = 3000;

export type AdminPushRegistration = {
  webPushStatus: WebPushConnectionStatus | null;
  enabling: boolean;
  showBanner: boolean;
  showConnected: boolean;
  refreshStatus: () => Promise<void>;
  enablePush: () => Promise<void>;
  dismissConnectedBanner: () => void;
};

function readDismissed(): boolean {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(dismissed: boolean): void {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return;
  try {
    if (dismissed) localStorage.setItem(DISMISS_KEY, "1");
    else localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Admin push setup: native registers on mount; web requires a user gesture (Enable button).
 */
export function useAdminPushRegistration(enabled: boolean): AdminPushRegistration {
  const [webPushStatus, setWebPushStatus] = useState<WebPushConnectionStatus | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [connectedBannerDismissed, setConnectedBannerDismissed] = useState(() => readDismissed());
  const nativeRegisteredRef = useRef(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConnectedRef = useRef(false);

  const dismissConnectedBanner = useCallback(() => {
    setConnectedBannerDismissed(true);
    writeDismissed(true);
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!enabled) {
      setWebPushStatus(null);
      return;
    }
    if (Platform.OS !== "web") {
      setWebPushStatus(null);
      return;
    }
    const status = await getWebPushConnectionStatus();
    setWebPushStatus(status);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refreshStatus();
  }, [enabled, refreshStatus]);

  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    if (nativeRegisteredRef.current) return;
    nativeRegisteredRef.current = true;
    registerPushForCurrentUser().catch((err) => {
      console.warn("[AdminPush] native register failed:", err);
      nativeRegisteredRef.current = false;
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled || Platform.OS !== "web") return;
    const connected = !!webPushStatus?.connected;
    if (!connected && prevConnectedRef.current) {
      setConnectedBannerDismissed(false);
      writeDismissed(false);
    }
    prevConnectedRef.current = connected;
  }, [enabled, webPushStatus?.connected]);

  useEffect(() => {
    if (!enabled || Platform.OS !== "web") return;
    if (!webPushStatus?.connected || connectedBannerDismissed) {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
      return;
    }
    autoHideTimerRef.current = setTimeout(() => {
      dismissConnectedBanner();
      autoHideTimerRef.current = null;
    }, AUTO_HIDE_MS);
    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
    };
  }, [enabled, webPushStatus?.connected, connectedBannerDismissed, dismissConnectedBanner]);

  const enablePush = useCallback(async () => {
    if (!enabled) return;
    setEnabling(true);
    try {
      if (Platform.OS === "web") {
        await ensurePushRegisteredWithGesture();
        await refreshStatus();
      } else {
        await registerPushForCurrentUser();
      }
    } finally {
      setEnabling(false);
    }
  }, [enabled, refreshStatus]);

  const showBanner =
    enabled &&
    Platform.OS === "web" &&
    !!webPushStatus?.supported &&
    (webPushStatus.permission !== "granted" || !webPushStatus.connected);

  const showConnected =
    enabled && Platform.OS === "web" && !!webPushStatus?.connected && !connectedBannerDismissed;

  return {
    webPushStatus,
    enabling,
    showBanner,
    showConnected,
    refreshStatus,
    enablePush,
    dismissConnectedBanner,
  };
}
