import { Platform } from "react-native";
import type { StoredAuthUser } from "./auth-storage";

export const WEB_AUTH_SUCCESS_STORAGE_KEY = "__3i_web_auth_success";

export function notifyWebModalAuthSuccess(next: string, authUser: StoredAuthUser): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined" || window.parent === window) return false;

  const nextPath = next === "/(tabs)" ? "/home" : next || "/home";
  const payload = { type: "3i-auth-success", next: nextPath, user: authUser };
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

  // Final safety net: if the parent welcome page misses the message/storage
  // signal or a router effect pushes it back to /welcome, move the top-level
  // page directly. Same-origin iframe access is expected here because the modal
  // source is created from window.location.origin.
  window.setTimeout(() => {
    try {
      if (window.parent.location.pathname === "/welcome") {
        window.parent.location.replace(nextPath);
      }
    } catch {
      /* ignore */
    }
  }, 900);

  return true;
}
