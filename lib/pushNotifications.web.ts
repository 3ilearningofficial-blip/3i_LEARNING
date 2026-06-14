/**
 * Web implementation for pushNotifications.ts
 *
 * Metro bundler automatically picks up .web.ts files for web builds, so this
 * keeps expo-notifications out of the web bundle (which only ever warns) while
 * still subscribing the browser to Web Push (VAPID) and registering it with the
 * backend.
 */

import { apiRequest } from "./query-client";

let currentWebEndpoint: string | null = null;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function registerPushForCurrentUser(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  const keyRes = await apiRequest("GET", "/api/push/web-public-key").catch(() => null);
  if (!keyRes || !keyRes.ok) return null;
  const { publicKey } = await keyRes.json().catch(() => ({ publicKey: "" }));
  if (!publicKey) return null;

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const registration = await navigator.serviceWorker.register("/web-push-sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  currentWebEndpoint = subscription.endpoint;
  await apiRequest("POST", "/api/push/web/register", { subscription: subscription.toJSON() }).catch((e) => {
    console.warn("[WebPush] register API failed", e);
  });
  return subscription.endpoint;
}

export async function unregisterPushForCurrentUser(): Promise<void> {
  try {
    const registration =
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration("/web-push-sw.js")
        : null;
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    const endpoint = subscription?.endpoint || currentWebEndpoint;
    if (endpoint) await apiRequest("POST", "/api/push/web/unregister", { endpoint });
  } catch {
    // Ignore unregister failures during logout.
  }
  currentWebEndpoint = null;
}
