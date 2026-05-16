import { Platform } from "react-native";
import { getBaseUrl } from "@/lib/query-client";
import { getStoredAuthToken } from "@/lib/auth-storage";

export function buildClassroomSyncUri(liveClassId: string | number, preview = false): string {
  const base = getBaseUrl().replace(/^http/, "ws");
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
