import { Platform } from "react-native";
import { getBaseUrl } from "@/lib/query-client";
import { getStoredAuthToken } from "@/lib/auth-storage";

/**
 * WebSocket sync must hit the Express API host. The marketing/app domain (3ilearning.in,
 * *.vercel.app) only rewrites /api — not /classroom-sync — so WS must use api.3ilearning.in.
 */
export function getClassroomSyncHttpBase(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    if (
      host === "3ilearning.in" ||
      host === "www.3ilearning.in" ||
      host.endsWith(".vercel.app")
    ) {
      return "https://api.3ilearning.in";
    }
  }

  const base = getBaseUrl().replace(/\/$/, "");
  if (base.endsWith("/api")) return base.slice(0, -4);
  return base;
}

export function buildClassroomSyncUri(liveClassId: string | number, preview = false): string {
  const base = getClassroomSyncHttpBase().replace(/^http/, "ws");
  const room = preview ? `lc-${liveClassId}-preview` : `lc-${liveClassId}`;
  return `${base}/classroom-sync/${room}`;
}

export async function buildClassroomSyncUriWithAuth(
  liveClassId: string | number,
  preview = false
): Promise<string> {
  const uri = buildClassroomSyncUri(liveClassId, preview);
  if (Platform.OS !== "web") return uri;
  const token = await getStoredAuthToken();
  // Do not use `sessionId` — reserved by @tldraw/sync useSync for its own query param.
  const params = new URLSearchParams();
  if (token) params.set("access_token", token);
  const qs = params.toString();
  return qs ? `${uri}?${qs}` : uri;
}
