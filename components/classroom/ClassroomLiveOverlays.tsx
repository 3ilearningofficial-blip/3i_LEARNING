import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  isAdmin?: boolean;
};

export default function ClassroomLiveOverlays({ liveClassId, isAdmin = false }: Props) {
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: activePoll } = useQuery({
    queryKey: ["/api/live-classes", liveClassId, "polls", "active"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/live-classes/${liveClassId}/polls/active`, undefined);
      if (!res.ok) return null;
      const json = await res.json();
      return json.poll as any;
    },
    refetchInterval: 800,
    enabled: !!liveClassId && Platform.OS === "web",
  });

  const vote = useMutation({
    mutationFn: async ({ pollId, optionId }: { pollId: number; optionId: number }) => {
      const res = await apiRequest("POST", `/api/live-classes/${liveClassId}/polls/${pollId}/vote`, {
        optionId,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Vote failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "polls", "active"] });
    },
  });

  if (Platform.OS !== "web") return null;

  const pollRemaining =
    activePoll && Number(activePoll.ends_at) > Date.now()
      ? Math.max(0, Math.ceil((Number(activePoll.ends_at) - Date.now()) / 1000))
      : 0;

  void tick;

  return (
    <View style={styles.stack} pointerEvents="box-none">
      {activePoll && pollRemaining > 0 && !isAdmin ? (
        <View style={styles.pollCard}>
          <Text style={styles.pollKind}>{activePoll.kind === "quiz" ? "Quiz" : "Poll"} · {pollRemaining}s</Text>
          <Text style={styles.pollQ}>{activePoll.question}</Text>
          {(activePoll.options || []).map((opt: { id: number; label: string }) => {
            const voted = Number(activePoll.myVoteOptionId) === Number(opt.id);
            return (
              <Pressable
                key={opt.id}
                style={[styles.pollOpt, voted && styles.pollOptVoted]}
                onPress={() => void vote.mutate({ pollId: activePoll.id, optionId: opt.id })}
                disabled={vote.isPending}
              >
                <Text style={styles.pollOptText}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: "absolute",
    top: 12,
    right: 12,
    left: 12,
    zIndex: 30,
    alignItems: "flex-end",
    gap: 8,
  },
  pollCard: {
    backgroundColor: "rgba(15,23,42,0.92)",
    borderRadius: 12,
    padding: 14,
    maxWidth: 360,
    width: "100%",
    borderWidth: 1,
    borderColor: "#334155",
  },
  pollKind: { color: "#94A3B8", fontSize: 11, fontWeight: "700", marginBottom: 6 },
  pollQ: { color: "#fff", fontSize: 14, fontWeight: "600", marginBottom: 10 },
  pollOpt: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#1E293B",
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  pollOptVoted: { borderColor: Colors.light.primary, backgroundColor: "#1E3A5F" },
  pollOptText: { color: "#E2E8F0", fontSize: 13 },
});
