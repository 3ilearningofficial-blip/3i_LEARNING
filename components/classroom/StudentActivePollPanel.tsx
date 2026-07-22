import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import {
  useActivePoll,
  activePollQueryKey,
  type ActivePoll,
} from "@/lib/classroom/useActivePoll";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
  /**
   * Compact variant used for the in-video overlay (fullscreen). The full
   * variant is used in the chat sidebar / under-video panel and provides
   * a bigger, scrollable option list.
   */
  compact?: boolean;
  /** Optional callback fired when the poll transitions from active→ended. */
  onPollEnded?: () => void;
};

function usePollRemaining(activePoll: ActivePoll | null | undefined) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!activePoll) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [activePoll?.id]);
  return useMemo(() => {
    void tick;
    if (!activePoll?.ends_at) return 0;
    return Math.max(0, Math.ceil((Number(activePoll.ends_at) - Date.now()) / 1000));
  }, [activePoll?.ends_at, tick]);
}

export default function StudentActivePollPanel({
  liveClassId,
  enabled = true,
  compact = false,
  onPollEnded,
}: Props) {
  const qc = useQueryClient();
  const { data: activePoll } = useActivePoll(liveClassId, enabled);
  const [lastActiveId, setLastActiveId] = useState<number | null>(null);

  useEffect(() => {
    const id = activePoll?.id ?? null;
    if (id != null) setLastActiveId(id);
    if (lastActiveId != null && id == null) onPollEnded?.();
  }, [activePoll?.id, lastActiveId, onPollEnded]);

  const remaining = usePollRemaining(activePoll);

  const vote = useMutation({
    mutationFn: async ({ pollId, optionId }: { pollId: number; optionId: number }) => {
      const res = await apiRequest(
        "POST",
        `/api/live-classes/${liveClassId}/polls/${pollId}/vote`,
        { optionId }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || "Vote failed");
      }
    },
    onSuccess: (_data, vars) => {
      // Optimistically mark the selected option so students see the tick
      // immediately even before the 800 ms active-poll refetch lands.
      qc.setQueryData<ActivePoll | null>(activePollQueryKey(liveClassId), (prev) =>
        prev && prev.id === vars.pollId ? { ...prev, myVoteOptionId: vars.optionId } : prev
      );
      qc.invalidateQueries({ queryKey: activePollQueryKey(liveClassId) });
    },
  });

  if (!activePoll || remaining <= 0) return null;

  const questionText = String(activePoll.question || "").trim() || "See the question on the board";
  const options = Array.isArray(activePoll.options) ? activePoll.options : [];
  const myVote = Number(activePoll.myVoteOptionId ?? 0);
  const kindLabel = activePoll.kind === "quiz" ? "Quiz" : "Poll";

  return (
    <View style={[styles.wrap, compact ? styles.wrapCompact : styles.wrapFull]}>
      <View style={styles.header}>
        <Text style={styles.kind}>
          {kindLabel} · {remaining}s
        </Text>
        {vote.isPending ? <ActivityIndicator size="small" color="#93C5FD" /> : null}
      </View>
      <Text style={compact ? styles.questionCompact : styles.question} numberOfLines={compact ? 2 : 4}>
        {questionText}
      </Text>
      <ScrollView
        style={compact ? styles.optionsScrollCompact : styles.optionsScroll}
        contentContainerStyle={styles.optionsContent}
        showsVerticalScrollIndicator={!compact}
      >
        {options.map((opt) => {
          const voted = myVote === Number(opt.id);
          return (
            <Pressable
              key={opt.id}
              style={[styles.optBtn, voted && styles.optBtnVoted]}
              onPress={() => void vote.mutate({ pollId: activePoll.id, optionId: opt.id })}
              disabled={vote.isPending}
            >
              <Text style={[styles.optLabel, voted && styles.optLabelVoted]}>{opt.label}</Text>
              {voted ? <Text style={styles.optCheck}>✓</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {vote.error ? <Text style={styles.errorText}>{vote.error.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "rgba(15,23,42,0.96)",
    borderWidth: 1,
    borderColor: "#334155",
    padding: 14,
    gap: 8,
  },
  wrapFull: {
    flex: 1,
    borderRadius: 12,
    minHeight: 0,
  },
  wrapCompact: {
    borderRadius: 10,
    maxHeight: "70%",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kind: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  question: { color: "#F8FAFC", fontSize: 15, fontWeight: "700", lineHeight: 22 },
  questionCompact: { color: "#F8FAFC", fontSize: 13, fontWeight: "700", lineHeight: 18 },
  optionsScroll: { flex: 1, minHeight: 0 },
  optionsScrollCompact: { maxHeight: 160 },
  optionsContent: { gap: 8, paddingVertical: 6 },
  optBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  optBtnVoted: { borderColor: Colors.light.primary, backgroundColor: "#1E3A5F" },
  optLabel: { color: "#E2E8F0", fontSize: 14, fontWeight: "600", flex: 1 },
  optLabelVoted: { color: "#BFDBFE" },
  optCheck: { color: "#4ADE80", fontSize: 18, fontWeight: "800" },
  errorText: { color: "#FCA5A5", fontSize: 12 },
});
