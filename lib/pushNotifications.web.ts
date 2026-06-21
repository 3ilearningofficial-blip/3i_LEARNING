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
let visibilityWatcherStarted = false;
let lastRegisterAttemptAt = 0;
const REGISTER_DEBOUNCE_MS = 5000;

export type WebPushConnectionStatus = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  connected: boolean;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function applicationServerKeyMatches(subscription: PushSubscription, publicKey: string): boolean {
  const existingKey = subscription.options?.applicationServerKey;
  if (!existingKey) return false;
  const expected = urlBase64ToUint8Array(publicKey);
  if (existingKey.byteLength !== expected.byteLength) return false;
  const a = new Uint8Array(existingKey);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== expected[i]) return false;
  }
  return true;
}

async function getOrCreateSubscription(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  let existing = await registration.pushManager.getSubscription();
  if (existing && !applicationServerKeyMatches(existing, publicKey)) {
    try {
      await existing.unsubscribe();
    } catch (err) {
      console.warn("[WebPush] unsubscribe stale subscription failed", err);
    }
    existing = null;
  }
  if (existing) return existing;

  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  } catch (err) {
    const stale = await registration.pushManager.getSubscription();
    if (stale) {
      await stale.unsubscribe().catch(() => {});
      return await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    throw err;
  }
}

export async function registerPushForCurrentUser(): Promise<string | null> {
  return subscribeWebPush(false);
}

/** Call from a user gesture (bell / Admin tap) so iOS PWA can show the permission prompt. */
export async function ensurePushRegisteredWithGesture(): Promise<string | null> {
  return subscribeWebPush(true);
}

async function subscribeWebPush(requestPermission: boolean): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  const keyRes = await apiRequest("GET", "/api/push/web-public-key").catch((err) => {
    console.warn("[WebPush] public key fetch failed", err);
    return null;
  });
  if (!keyRes || !keyRes.ok) return null;
  const { publicKey } = await keyRes.json().catch(() => ({ publicKey: "" }));
  if (!publicKey) {
    console.warn("[WebPush] VAPID public key missing in response");
    return null;
  }

  let permission = Notification.permission;
  if (permission === "default") {
    if (!requestPermission) return null;
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return null;

  const registration = await navigator.serviceWorker.register("/web-push-sw.js");
  const subscription = await getOrCreateSubscription(registration, publicKey);
  currentWebEndpoint = subscription.endpoint;

  try {
    await apiRequest("POST", "/api/push/web/register", { subscription: subscription.toJSON() });
  } catch (err) {
    console.error("[WebPush] register API failed", err);
    return null;
  }
  return subscription.endpoint;
}

function onVisibilityChange(): void {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - lastRegisterAttemptAt < REGISTER_DEBOUNCE_MS) return;
  lastRegisterAttemptAt = now;
  registerPushForCurrentUser().catch((err) => {
    console.warn("[WebPush] visibility re-register failed", err);
  });
}

export function startWebPushVisibilityWatcher(): void {
  if (typeof document === "undefined" || visibilityWatcherStarted) return;
  visibilityWatcherStarted = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
}

export function stopWebPushVisibilityWatcher(): void {
  if (typeof document === "undefined" || !visibilityWatcherStarted) return;
  visibilityWatcherStarted = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

export async function getWebPushConnectionStatus(): Promise<WebPushConnectionStatus> {
  if (typeof window === "undefined") {
    return { supported: false, permission: "unsupported", connected: false };
  }
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { supported: false, permission: "unsupported", connected: false };
  }
  const permission = Notification.permission;
  if (permission !== "granted") {
    return { supported: true, permission, connected: false };
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/web-push-sw.js");
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    const connected = !!(subscription?.endpoint || currentWebEndpoint);
    return { supported: true, permission, connected };
  } catch {
    return { supported: true, permission, connected: !!currentWebEndpoint };
  }
}

export async function unregisterPushForCurrentUser(): Promise<void> {
  stopWebPushVisibilityWatcher();
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
