import { Platform } from "react-native";
import { getBaseUrl } from "@/lib/query-client";

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

  // Fetch a fresh token from the server via HTTP (which reliably sends the session cookie)
  // rather than reading from sessionStorage (unreliable across navigations/cross-tab).
  let token: string | null = null;
  try {
    const base = getClassroomSyncHttpBase();
    const headers: Record<string, string> = {};
    // Also send sessionStorage token as Bearer if available (belt-and-suspenders)
    if (typeof sessionStorage !== "undefined") {
      const t = sessionStorage.getItem("sessionToken")?.trim();
      if (t && t !== "null" && t !== "undefined") headers["Authorization"] = `Bearer ${t}`;
    }
    const res = await fetch(
      `${base}/api/live-classes/${encodeURIComponent(String(liveClassId))}/classroom/sync-token`,
      { credentials: "include", headers }
    );
    if (res.ok) {
      const data = await res.json() as { token?: string };
      token = data.token || null;
    }
  } catch {
    // Fallback: read from sessionStorage
    if (typeof sessionStorage !== "undefined") {
      const t = sessionStorage.getItem("sessionToken")?.trim();
      if (t && t !== "null" && t !== "undefined") token = t;
    }
  }

  // Do not use `sessionId` — reserved by @tldraw/sync useSync for its own query param.
  const params = new URLSearchParams();
  if (token) params.set("access_token", token);
  const qs = params.toString();
  return qs ? `${uri}?${qs}` : uri;
}
