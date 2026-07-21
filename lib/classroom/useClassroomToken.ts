import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export type ClassroomTokenPayload = {
  token: string;
  url: string;
  roomName: string;
  canPublish: boolean;
};

export function classroomTokenQueryKey(liveClassId: string) {
  return ["/api/live-classes", liveClassId, "classroom", "token"] as const;
}

export function useClassroomToken(liveClassId: string, enabled: boolean) {
  return useQuery<ClassroomTokenPayload>({
    queryKey: classroomTokenQueryKey(liveClassId),
    enabled: !!liveClassId && enabled,
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/live-classes/${liveClassId}/classroom/token`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Failed to get classroom token");
      }
      return res.json();
    },
    // Once the classroom is live, the LiveKit access token is valid for the
    // whole session (server issues long-lived tokens). Never refetch on
    // window focus / remount: React Query used to fire a token refetch on
    // focus which flipped the useLiveKitRoom effect and tore down the whole
    // Room, causing the "disconnected → connecting" cycles and
    // "createOffer with closed peer connection" errors in the console.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: 1,
  });
}

export function useClassroomConfig(liveClassId: string) {
  return useQuery<{ livekitConfigured: boolean; syncPath: string }>({
    queryKey: ["/api/live-classes", liveClassId, "classroom", "config"],
    enabled: !!liveClassId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/live-classes/${liveClassId}/classroom/config`, undefined);
      if (!res.ok) throw new Error("Failed to load classroom config");
      return res.json();
    },
    staleTime: 60_000,
  });
}
