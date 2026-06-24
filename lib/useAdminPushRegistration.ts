import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  ensurePushRegisteredWithGesture,
  getWebPushConnectionStatus,
  registerPushForCurrentUser,
  type WebPushConnectionStatus,
} from "@/lib/pushNotifications";

export type AdminPushRegistration = {
  webPushStatus: WebPushConnectionStatus | null;
  enabling: boolean;
  showBanner: boolean;
  showConnected: boolean;
  refreshStatus: () => Promise<void>;
  enablePush: () => Promise<void>;
};

/**
 * Admin push setup: native registers on mount; web requires a user gesture (Enable button).
 */
export function useAdminPushRegistration(enabled: boolean): AdminPushRegistration {
  const [webPushStatus, setWebPushStatus] = useState<WebPushConnectionStatus | null>(null);
  const [enabling, setEnabling] = useState(false);
  const nativeRegisteredRef = useRef(false);

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
    enabled && Platform.OS === "web" && !!webPushStatus?.connected;

  return {
    webPushStatus,
    enabling,
    showBanner,
    showConnected,
    refreshStatus,
    enablePush,
  };
}
