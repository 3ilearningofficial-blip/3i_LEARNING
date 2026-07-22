import { Platform } from "react-native";
import { authFetch, getBaseUrl } from "@/lib/query-client";

/**
 * Must stay below backend `CLASSROOM_SYNC_TOKEN_TTL_MS` (8h). Rebuilds the WS
 * path token so reconnects after long classes still authenticate.
 */
export const CLASSROOM_SYNC_URI_REFRESH_MS = 45 * 60 * 1000;

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

  // Fetch a signed sync token via HTTP (cookie + Bearer). authFetch unwraps
  // { success, data: { token } } so we always read the inner payload.
  const base = getClassroomSyncHttpBase();
  const res = await authFetch(
    `${base}/api/live-classes/${encodeURIComponent(String(liveClassId))}/classroom/sync-token`
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Board sync not authenticated — refresh the page and sign in again.");
    }
    throw new Error("Could not get board sync token. Check your connection and retry.");
  }
  const data = (await res.json()) as { token?: string };
  const token = data?.token?.trim();
  if (!token) {
    throw new Error("Board sync token missing from server response.");
  }

  // tldraw's useSync rebuilds the socket URL and DROPS query params, and a browser
  // cannot set an Authorization header on a WebSocket — so the signed token must
  // ride in the URL PATH, which tldraw preserves.
  return `${uri}/${encodeURIComponent(token)}`;
}
