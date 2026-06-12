import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { apiRequest } from "./query-client";

let currentToken: string | null = null;
let currentWebEndpoint: string | null = null;
let configured = false;

function configureHandler() {
  if (configured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  configured = true;
}

function getProjectId(): string | null {
  const fromExpoConfig = (Constants.expoConfig as any)?.extra?.eas?.projectId;
  const fromEasConfig = (Constants as any)?.easConfig?.projectId;
  return (fromExpoConfig || fromEasConfig || null) as string | null;
}

export async function registerPushForCurrentUser(): Promise<string | null> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const keyRes = await apiRequest("GET", "/push/web-public-key").catch(() => null);
    if (!keyRes || !keyRes.ok) return null;
    const { publicKey } = await keyRes.json().catch(() => ({ publicKey: "" }));
    if (!publicKey) return null;

    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.register("/web-push-sw.js");
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    currentWebEndpoint = subscription.endpoint;
    await apiRequest("POST", "/push/web/register", { subscription: subscription.toJSON() }).catch((e) => {
      console.warn("[WebPush] register API failed", e);
    });
    return subscription.endpoint;
  }
  configureHandler();
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1A56DB",
    });
  }

  const projectId = getProjectId();
  let tokenData: Notifications.ExpoPushToken | null = null;
  try {
    tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  } catch (e) {
    // Some runtime configs miss EAS projectId; retry once without explicit projectId.
    try {
      tokenData = await Notifications.getExpoPushTokenAsync();
    } catch (e2) {
      console.warn("[Push] getExpoPushTokenAsync failed", { projectId, e, e2 });
      return null;
    }
  }
  const token = String(tokenData?.data || "").trim();
  if (!token) return null;
  currentToken = token;
  try {
    await apiRequest("POST", "/push/register", {
      token,
      platform: Platform.OS,
    });
  } catch (e) {
    // Keep token in memory so logout can still unregister-all fallback.
    console.warn("[Push] register API failed", e);
  }
  return token;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function unregisterPushForCurrentUser(): Promise<void> {
  if (Platform.OS === "web") {
    try {
      const registration = typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration("/web-push-sw.js")
        : null;
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      const endpoint = subscription?.endpoint || currentWebEndpoint;
      if (endpoint) await apiRequest("POST", "/push/web/unregister", { endpoint });
    } catch {
      // Ignore unregister failures during logout.
    }
    currentWebEndpoint = null;
    return;
  }
  try {
    if (currentToken) {
      await apiRequest("POST", "/push/unregister", { token: currentToken });
    } else {
      await apiRequest("POST", "/push/unregister-all", {});
    }
  } catch {
    // Ignore unregister failures during logout.
  }
  currentToken = null;
}

