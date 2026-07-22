import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";

export type PollBroadcastStatsResult = {
  id: number;
  label: string;
  sort_order: number;
  count: number;
  percent: number;
};

export type PollBroadcastLeaderboardEntry = {
  rank: number;
  userId: number;
  userName: string;
  optionId: number;
  votedAt: number;
  isCorrect: boolean;
};

export type PollBroadcastStats = {
  pollId: number;
  kind: "poll" | "quiz";
  question: string | null;
  correctOptionId: number | null;
  totalVotes: number;
  results: PollBroadcastStatsResult[];
  leaderboard: PollBroadcastLeaderboardEntry[];
};

export function pollBroadcastStatsQueryKey(liveClassId: string) {
  return ["/api/live-classes", liveClassId, "polls", "broadcast-stats"] as const;
}

/**
 * Student-facing poll stats overlay driver. Returns `null` when no poll is
 * currently being broadcast to the class. Reacts to the `stats_show`
 * engagement SSE event via cache invalidation in `useLiveEngagementSse`.
 */
export function usePollBroadcastStats(liveClassId: string, enabled = true) {
  return useQuery<PollBroadcastStats | null>({
    queryKey: pollBroadcastStatsQueryKey(liveClassId),
    queryFn: async () => {
      const res = await authFetch(
        `${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}/polls/broadcast-stats`
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { stats: PollBroadcastStats | null };
      return json.stats ?? null;
    },
    enabled: !!liveClassId && enabled,
    // The SSE `stats_show` event is authoritative, but keep a slow polling
    // fallback so the overlay eventually converges even if the SSE stream
    // drops. 4s is well below Neon's 5-min sleep threshold and unnoticeable
    // to students.
    refetchInterval: enabled ? 4000 : false,
    staleTime: 0,
  });
}

export type PollLeaderboardResponse = {
  pollId: number;
  kind: "poll" | "quiz";
  correctOptionId: number | null;
  leaderboard: PollBroadcastLeaderboardEntry[];
};

export function pollLeaderboardQueryKey(liveClassId: string, pollId: number | null) {
  return ["/api/admin/live-classes", liveClassId, "polls", pollId, "leaderboard"] as const;
}

/** Admin: fetch the top-10 leaderboard for a single poll. */
export function usePollLeaderboard(
  liveClassId: string,
  pollId: number | null,
  enabled = true
) {
  return useQuery<PollLeaderboardResponse | null>({
    queryKey: pollLeaderboardQueryKey(liveClassId, pollId),
    queryFn: async () => {
      if (!pollId) return null;
      const res = await authFetch(
        `${getApiUrl()}/admin/live-classes/${encodeURIComponent(liveClassId)}/polls/${pollId}/leaderboard`
      );
      if (!res.ok) return null;
      return (await res.json()) as PollLeaderboardResponse;
    },
    enabled: !!liveClassId && !!pollId && enabled,
    staleTime: 0,
  });
}
