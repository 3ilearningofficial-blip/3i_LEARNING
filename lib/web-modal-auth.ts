import { Platform } from "react-native";
import type { StoredAuthUser } from "./auth-storage";

export const WEB_AUTH_SUCCESS_STORAGE_KEY = "__3i_web_auth_success";

export function notifyWebModalAuthSuccess(next: string, authUser: StoredAuthUser): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined" || window.parent === window) return false;

  const payload = { type: "3i-auth-success", next, user: authUser };
  const send = () => window.parent.postMessage(payload, window.location.origin);

  send();
  window.setTimeout(send, 120);
  window.setTimeout(send, 360);

  // Mobile browsers can occasionally miss iframe postMessage delivery. Students
  // already use durable web storage for the 7-day session, so a temporary
  // same-origin signal is safe. Admin tokens must not touch localStorage.
  if (authUser.role !== "admin") {
    try {
      window.localStorage.setItem(WEB_AUTH_SUCCESS_STORAGE_KEY, JSON.stringify({ ...payload, ts: Date.now() }));
    } catch {
      /* ignore */
    }
  }

  return true;
}
