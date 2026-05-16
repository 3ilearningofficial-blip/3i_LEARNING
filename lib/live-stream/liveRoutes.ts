import type { StreamType } from "./types";
import { normalizeStreamType } from "./types";

export function getAdminChooseStreamRoute(liveClassId: string | number): string {
  return `/admin/live/${liveClassId}/choose-stream`;
}

export function getAdminSetupRoute(liveClassId: string | number, streamType: StreamType): string {
  return `/admin/live/${liveClassId}/setup?type=${streamType}`;
}

export function getAdminLiveSessionRoute(liveClass: {
  id: string | number;
  is_live?: boolean;
  stream_type?: string | null;
}): string {
  const type = normalizeStreamType(liveClass.stream_type);
  if (type === "classroom") return `/admin/classroom/${liveClass.id}`;
  return `/admin/broadcast/${liveClass.id}`;
}

export function getAdminStartLiveRoute(liveClassId: string | number): string {
  return getAdminChooseStreamRoute(liveClassId);
}
