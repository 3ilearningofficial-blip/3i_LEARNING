import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";

export type ActivePollOption = {
  id: number;
  label: string;
  sort_order: number;
};

export type ActivePoll = {
  id: number;
  live_class_id: number | string;
  kind: "poll" | "quiz";
  /** Nullable: teachers can write the question on the board. */
  question: string | null;
  options: ActivePollOption[];
  started_at: number;
  ends_at: number;
  ended_at: number | null;
  myVoteOptionId: number | null;
  correct_option_id?: number | null;
};

export function activePollQueryKey(liveClassId: string) {
  return ["/api/live-classes", liveClassId, "polls", "active"] as const;
}

/**
 * Shared active-poll subscription. One query per live class means the admin
 * sidebar, the fullscreen overlay, and the student poll panel all read the
 * same cache entry and get invalidated in a single place (SSE listener,
 * vote mutation, poll end).
 *
 * `enabled` gates the poll interval so we don't spam 401s when the class
 * isn't live.
 */
export function useActivePoll(liveClassId: string, enabled = true) {
  const [authBlocked, setAuthBlocked] = useState(false);
  useEffect(() => {
    setAuthBlocked(false);
  }, [enabled, liveClassId]);

  return useQuery<ActivePoll | null>({
    queryKey: activePollQueryKey(liveClassId),
    queryFn: async () => {
      const res = await authFetch(
        `${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}/polls/active`
      );
      if (res.status === 401) {
        setAuthBlocked(true);
        return null;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { poll: ActivePoll | null };
      return json.poll ?? null;
    },
    refetchInterval: enabled && !authBlocked ? 800 : false,
    enabled: !!liveClassId && enabled && !authBlocked,
  });
}
