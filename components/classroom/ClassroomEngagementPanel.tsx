import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { useActivePoll, activePollQueryKey } from "@/lib/classroom/useActivePoll";
import {
  usePollLeaderboard,
  pollBroadcastStatsQueryKey,
} from "@/lib/classroom/usePollBroadcastStats";
import Colors from "@/constants/colors";

const DURATION_PRESETS = [20, 30, 60, 120];
// Default option labels — teachers rarely want "Option 1 / Option 2".
// A/B/C/D matches the physical answer sheet convention and lets the teacher
// write the actual choices on the whiteboard while collecting votes.
const DEFAULT_OPTION_LABELS = ["A", "B", "C", "D"];

type PollOption = { id: number; label: string; sort_order: number; count?: number; percent?: number };

type SessionPoll = {
  id: number;
  kind: string;
  /** Nullable: teachers may prefer to write the question on the board. */
  question: string | null;
  total_votes: number;
  is_active: boolean;
  broadcast_stats?: number | null;
};

type Props = {
  liveClassId: string;
  enabled?: boolean;
};

export default function ClassroomEngagementPanel({ liveClassId, enabled = true }: Props) {
  const qc = useQueryClient();
  const [authBlocked, setAuthBlocked] = useState(false);
  const [pollKind, setPollKind] = useState<"poll" | "quiz">("poll");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(() => [...DEFAULT_OPTION_LABELS]);
  const [correctIdx, setCorrectIdx] = useState(0);
  const [duration, setDuration] = useState("30");
  const [viewPollId, setViewPollId] = useState<number | null>(null);
  const prevActivePollIdRef = useRef<number | null>(null);

  useEffect(() => {
    setAuthBlocked(false);
  }, [enabled, liveClassId]);

  const { data: sessionPolls } = useQuery({
    queryKey: ["/api/admin/live-classes", liveClassId, "polls", "session"],
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/admin/live-classes/${encodeURIComponent(liveClassId)}/polls/session`);
      if (res.status === 401) {
        setAuthBlocked(true);
        return [] as SessionPoll[];
      }
      if (!res.ok) return [] as SessionPoll[];
      const json = await res.json();
      return (json.polls || []) as SessionPoll[];
    },
    refetchInterval: 2000,
    enabled: !!liveClassId && enabled && !authBlocked,
  });

  const { data: activePoll } = useActivePoll(liveClassId, enabled && !authBlocked);

  const { data: pollResults, isLoading: resultsLoading } = useQuery<{
    poll?: { correct_option_id?: number | null; question?: string | null; kind?: string };
    results: PollOption[];
    totalVotes: number;
    correctOptionId: number | null;
  } | null>({
    queryKey: ["/api/admin/live-classes", liveClassId, "polls", viewPollId, "results"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/live-classes/${liveClassId}/polls/${viewPollId}/results`,
        undefined
      );
      if (!res.ok) throw new Error("Failed to load results");
      return res.json();
    },
    enabled: !!viewPollId && enabled && !authBlocked,
  });

  const createPoll = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/polls`, {
        kind: pollKind,
        question: question.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        durationSeconds: Number(duration) || 30,
        correctOptionIndex: pollKind === "quiz" ? correctIdx : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to start poll");
      }
      return res.json();
    },
    onSuccess: (data: { poll?: { id: number } }) => {
      setQuestion("");
      setOptions([...DEFAULT_OPTION_LABELS]);
      setCorrectIdx(0);
      qc.invalidateQueries({ queryKey: activePollQueryKey(liveClassId) });
      qc.invalidateQueries({ queryKey: ["/api/admin/live-classes", liveClassId, "polls", "session"] });
      if (data?.poll?.id) setViewPollId(data.poll.id);
    },
  });

  useEffect(() => {
    const currentId = activePoll?.id ?? null;
    const prevId = prevActivePollIdRef.current;
    if (prevId != null && currentId == null) {
      setViewPollId((v) => v ?? prevId);
      void qc.invalidateQueries({
        queryKey: ["/api/admin/live-classes", liveClassId, "polls", "session"],
      });
    }
    prevActivePollIdRef.current = currentId;
  }, [activePoll?.id, liveClassId, qc]);

  const endPoll = useMutation({
    mutationFn: async (pollId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/live-classes/${liveClassId}/polls/${pollId}/end`,
        {}
      );
      if (!res.ok) throw new Error("Failed to end poll");
    },
    onSuccess: (_, pollId) => {
      setViewPollId(pollId);
      qc.invalidateQueries({ queryKey: activePollQueryKey(liveClassId) });
      qc.invalidateQueries({ queryKey: ["/api/admin/live-classes", liveClassId, "polls", "session"] });
    },
  });

  // Toggle "Show stats to students". The backend clears any other broadcast
  // in the same class so only one is active at a time.
  const broadcastToggle = useMutation({
    mutationFn: async ({ pollId, show }: { pollId: number; show: boolean }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/live-classes/${liveClassId}/polls/${pollId}/broadcast-stats`,
        { show }
      );
      if (!res.ok) throw new Error("Failed to update broadcast");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/live-classes", liveClassId, "polls", "session"] });
      qc.invalidateQueries({ queryKey: pollBroadcastStatsQueryKey(liveClassId) });
    },
  });

  const endedPolls = (sessionPolls || []).filter((p) => !p.is_active);
  const viewingPoll = (sessionPolls || []).find((p) => p.id === viewPollId) || null;
  const isBroadcastingSelected = !!viewingPoll?.broadcast_stats;

  const { data: leaderboard } = usePollLeaderboard(
    liveClassId,
    viewPollId,
    !!viewPollId && enabled && !authBlocked
  );

  const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);
  const durationNum = Number(duration);
  // Question is now optional — teachers can write it on the board and just
  // publish the labelled options (A/B/C/D by default). Validate options +
  // duration only.
  const canCreatePoll =
    trimmedOptions.length >= 2 &&
    Number.isFinite(durationNum) &&
    durationNum >= 5 &&
    durationNum <= 600;

  const pollValidationHint =
    trimmedOptions.length < 2
      ? "Add at least 2 options"
      : !Number.isFinite(durationNum) || durationNum < 5 || durationNum > 600
        ? "Duration must be 5–600 seconds"
        : null;

  if (Platform.OS !== "web") {
    return <Text style={styles.note}>Polls and timers are available on web.</Text>;
  }

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.wrapContent}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Live engagement</Text>

      {activePoll ? (
        <View style={styles.activeBox}>
          <Text style={styles.activeTitle}>Poll running</Text>
          <Text style={styles.activeQ} numberOfLines={2}>
            {String(activePoll.question || "").trim() || "(Question on the board)"}
          </Text>
          <View style={styles.row}>
            <Pressable style={styles.secondaryBtn} onPress={() => void endPoll.mutate(activePoll.id)}>
              <Text style={styles.secondaryBtnText}>End poll</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => setViewPollId(activePoll.id)}>
              <Text style={styles.secondaryBtnText}>View results</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {viewPollId && pollResults ? (
        <View style={styles.resultsBox}>
          <View style={styles.resultsHeaderRow}>
            <Text style={styles.resultsTitle}>Poll results</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void broadcastToggle.mutate({
                  pollId: viewPollId,
                  show: !isBroadcastingSelected,
                })
              }
              style={[
                styles.broadcastBtn,
                isBroadcastingSelected && styles.broadcastBtnOn,
              ]}
              disabled={broadcastToggle.isPending}
            >
              <Text
                style={[
                  styles.broadcastBtnText,
                  isBroadcastingSelected && styles.broadcastBtnTextOn,
                ]}
              >
                {isBroadcastingSelected
                  ? "Hide from students"
                  : "Show stats to students"}
              </Text>
            </Pressable>
          </View>
          {resultsLoading ? (
            <ActivityIndicator color={Colors.light.primary} />
          ) : (
            <View style={styles.statsSplit}>
              <View style={styles.statsColLeft}>
                {(pollResults.results as PollOption[]).map((r) => {
                  const pct = Number(r.percent ?? 0);
                  const isCorrect =
                    pollResults.correctOptionId != null &&
                    r.id === pollResults.correctOptionId;
                  return (
                    <View key={r.id} style={styles.barRow}>
                      <View style={styles.barLabelRow}>
                        <Text style={styles.resultLabel} numberOfLines={1}>
                          {r.label}
                          {isCorrect ? "  ✓" : ""}
                        </Text>
                        <Text style={styles.resultPct}>{pct}%</Text>
                      </View>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              width: `${Math.max(0, Math.min(100, pct))}%`,
                              backgroundColor: isCorrect
                                ? "#16a34a"
                                : Colors.light.primary,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
                <Text style={styles.totalVotes}>
                  Total votes: {pollResults.totalVotes ?? 0}
                </Text>
              </View>
              <View style={styles.statsColRight}>
                <Text style={styles.leaderboardTitle}>Top 10</Text>
                <ScrollView
                  style={styles.leaderboardScroll}
                  contentContainerStyle={styles.leaderboardContent}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {(leaderboard?.leaderboard ?? []).length === 0 ? (
                    <Text style={styles.leaderboardEmpty}>No votes yet</Text>
                  ) : (
                    (leaderboard?.leaderboard ?? []).map((row) => (
                      <View key={`${row.userId}-${row.votedAt}`} style={styles.lbRow}>
                        <Text style={styles.lbRank}>{row.rank}.</Text>
                        <Text style={styles.lbName} numberOfLines={1}>
                          {row.userName}
                        </Text>
                        {pollResults.correctOptionId != null ? (
                          <Text
                            style={[
                              styles.lbBadge,
                              row.isCorrect ? styles.lbBadgeOk : styles.lbBadgeNo,
                            ]}
                          >
                            {row.isCorrect ? "✓" : "✕"}
                          </Text>
                        ) : null}
                      </View>
                    ))
                  )}
                </ScrollView>
              </View>
            </View>
          )}
        </View>
      ) : null}

      {endedPolls.length > 0 ? (
        <View style={styles.pastPollsBox}>
          <Text style={styles.pastPollsTitle}>Past polls (this class)</Text>
          {endedPolls.map((p) => (
            <Pressable
              key={p.id}
              style={[styles.pastPollRow, viewPollId === p.id && styles.pastPollRowActive]}
              onPress={() => setViewPollId(p.id)}
            >
              <Text style={styles.pastPollQ} numberOfLines={2}>
                {String(p.question || "").trim() || "(Question on the board)"}
              </Text>
              <Text style={styles.pastPollMeta}>
                {p.kind === "quiz" ? "Quiz" : "Poll"} · {p.total_votes} votes
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.subHeading}>New poll / quiz</Text>
      <View style={styles.kindRow}>
        <Pressable
          style={[styles.kindBtn, pollKind === "poll" && styles.kindBtnActive]}
          onPress={() => setPollKind("poll")}
        >
          <Text style={[styles.kindText, pollKind === "poll" && styles.kindTextActive]}>Poll</Text>
        </Pressable>
        <Pressable
          style={[styles.kindBtn, pollKind === "quiz" && styles.kindBtnActive]}
          onPress={() => setPollKind("quiz")}
        >
          <Text style={[styles.kindText, pollKind === "quiz" && styles.kindTextActive]}>Quiz</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        placeholder="Question (optional — leave blank to use the board)"
        value={question}
        onChangeText={setQuestion}
      />
      {options.map((opt, i) => (
        <View key={i} style={styles.optRow}>
          <TextInput
            style={[styles.input, styles.optInput]}
            placeholder={DEFAULT_OPTION_LABELS[i] ?? `Option ${i + 1}`}
            value={opt}
            onChangeText={(t) => {
              const next = [...options];
              next[i] = t;
              setOptions(next);
            }}
          />
          {pollKind === "quiz" ? (
            <Pressable onPress={() => setCorrectIdx(i)}>
              <Text style={correctIdx === i ? styles.correctOn : styles.correctOff}>
                {correctIdx === i ? "✓" : "○"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable
        style={styles.linkBtn}
        onPress={() => {
          const nextLabel =
            DEFAULT_OPTION_LABELS[options.length] ?? `Option ${options.length + 1}`;
          setOptions([...options, nextLabel]);
        }}
      >
        <Text style={styles.linkBtnText}>+ Add option</Text>
      </Pressable>
      <Text style={styles.labelSmall}>Duration (seconds)</Text>
      <View style={styles.presetRow}>
        {DURATION_PRESETS.map((s) => (
          <Pressable
            key={s}
            style={[styles.presetBtn, duration === String(s) && styles.presetBtnActive]}
            onPress={() => setDuration(String(s))}
          >
            <Text style={styles.presetText}>{s}s</Text>
          </Pressable>
        ))}
        <TextInput
          style={[styles.input, styles.durationInput]}
          value={duration}
          onChangeText={setDuration}
          keyboardType="number-pad"
        />
      </View>
      {pollValidationHint && !activePoll ? (
        <Text style={styles.validationHint}>{pollValidationHint}</Text>
      ) : null}
      <Pressable
        style={[styles.primaryBtn, (!canCreatePoll || !!activePoll) && styles.primaryBtnDisabled]}
        onPress={() => void createPoll.mutate()}
        disabled={createPoll.isPending || !!activePoll || !canCreatePoll}
      >
        <Text style={styles.primaryBtnText}>{createPoll.isPending ? "Starting…" : "Start poll"}</Text>
      </Pressable>
      {createPoll.error ? (
        <Text style={styles.errorText}>{createPoll.error.message}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0 },
  wrapContent: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12, flexGrow: 1 },
  heading: { fontSize: 12, fontWeight: "700", color: Colors.light.textMuted, marginBottom: 8, textTransform: "uppercase" },
  subHeading: { fontSize: 13, fontWeight: "700", color: Colors.light.text, marginBottom: 6 },
  spaced: { marginTop: 14 },
  note: { fontSize: 12, color: Colors.light.textMuted },
  kindRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kindBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: "center",
  },
  kindBtnActive: { borderColor: Colors.light.primary, backgroundColor: "#EFF6FF" },
  kindText: { fontSize: 12, fontWeight: "600", color: Colors.light.textMuted },
  kindTextActive: { color: Colors.light.primary },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 6,
    backgroundColor: "#fff",
  },
  optRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  optInput: { flex: 1 },
  correctOn: { fontSize: 18, color: "#16A34A", fontWeight: "700" },
  correctOff: { fontSize: 18, color: Colors.light.textMuted },
  labelSmall: { fontSize: 11, color: Colors.light.textMuted, marginBottom: 4 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" },
  presetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  presetBtnActive: { borderColor: Colors.light.primary, backgroundColor: "#EFF6FF" },
  presetText: { fontSize: 11, fontWeight: "600" },
  durationInput: { width: 56, marginBottom: 0, paddingVertical: 6, textAlign: "center" },
  primaryBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 4,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  validationHint: { fontSize: 11, color: Colors.light.textMuted, marginBottom: 6 },
  errorText: { fontSize: 12, color: "#DC2626", marginTop: 4, marginBottom: 8 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  secondaryBtnText: { fontSize: 12, fontWeight: "600", color: Colors.light.text },
  row: { flexDirection: "row", gap: 8 },
  linkBtn: { paddingVertical: 4, marginBottom: 6 },
  linkBtnText: { fontSize: 12, color: Colors.light.primary, fontWeight: "600" },
  activeBox: {
    backgroundColor: "#ECFDF5",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  activeTitle: { fontSize: 11, fontWeight: "700", color: "#047857", marginBottom: 4 },
  activeQ: { fontSize: 13, color: Colors.light.text, marginBottom: 8 },
  resultsBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  resultsTitle: { fontSize: 12, fontWeight: "700" },
  resultsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 8,
  },
  broadcastBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#fff",
  },
  broadcastBtnOn: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  broadcastBtnText: { fontSize: 11, fontWeight: "700", color: Colors.light.text },
  broadcastBtnTextOn: { color: "#fff" },
  resultRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  resultLabel: { flex: 1, fontSize: 12, color: Colors.light.text },
  resultPct: { fontSize: 12, fontWeight: "700", color: Colors.light.primary },
  totalVotes: { fontSize: 11, color: Colors.light.textMuted, marginTop: 6 },
  statsSplit: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  statsColLeft: { flex: 1, minWidth: 0 },
  statsColRight: { flex: 1, minWidth: 0 },
  barRow: { marginBottom: 8 },
  barLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  barTrack: {
    height: 8,
    backgroundColor: "#E2E8F0",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 4 },
  leaderboardTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.light.textMuted,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  leaderboardScroll: { maxHeight: 200 },
  leaderboardContent: { paddingBottom: 4 },
  leaderboardEmpty: { fontSize: 11, color: Colors.light.textMuted },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    gap: 6,
  },
  lbRank: { fontSize: 11, fontWeight: "700", color: Colors.light.textMuted, width: 20 },
  lbName: { flex: 1, fontSize: 12, color: Colors.light.text },
  lbBadge: { fontSize: 12, fontWeight: "700", width: 16, textAlign: "center" },
  lbBadgeOk: { color: "#16a34a" },
  lbBadgeNo: { color: "#94a3b8" },
  pastPollsBox: {
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  pastPollsTitle: { fontSize: 11, fontWeight: "700", color: Colors.light.textMuted, marginBottom: 8 },
  pastPollRow: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 4,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  pastPollRowActive: { borderColor: Colors.light.primary, backgroundColor: "#EFF6FF" },
  pastPollQ: { fontSize: 12, fontWeight: "600", color: Colors.light.text, marginBottom: 2 },
  pastPollMeta: { fontSize: 10, color: Colors.light.textMuted },
});
