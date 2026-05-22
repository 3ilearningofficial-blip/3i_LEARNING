import React, { useState } from "react";
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
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

const DURATION_PRESETS = [20, 30, 60, 120];

type PollOption = { id: number; label: string; sort_order: number; count?: number; percent?: number };

type Props = {
  liveClassId: string;
};

export default function ClassroomEngagementPanel({ liveClassId }: Props) {
  const qc = useQueryClient();
  const [pollKind, setPollKind] = useState<"poll" | "quiz">("poll");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [correctIdx, setCorrectIdx] = useState(0);
  const [duration, setDuration] = useState("30");
  const [viewPollId, setViewPollId] = useState<number | null>(null);

  const { data: activePoll } = useQuery({
    queryKey: ["/api/live-classes", liveClassId, "polls", "active"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/live-classes/${liveClassId}/polls/active`, undefined);
      if (!res.ok) return null;
      const json = await res.json();
      return json.poll as any;
    },
    refetchInterval: 800,
    enabled: !!liveClassId,
  });

  const { data: pollResults, isLoading: resultsLoading } = useQuery({
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
    enabled: !!viewPollId,
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
    onSuccess: () => {
      setQuestion("");
      setOptions(["", ""]);
      qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "polls", "active"] });
    },
  });

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
      qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "polls", "active"] });
    },
  });

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
            {activePoll.question}
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
          <Text style={styles.resultsTitle}>Poll results</Text>
          {resultsLoading ? (
            <ActivityIndicator color={Colors.light.primary} />
          ) : (
            (pollResults.results as PollOption[]).map((r) => (
              <View key={r.id} style={styles.resultRow}>
                <Text style={styles.resultLabel} numberOfLines={1}>
                  {r.label}
                </Text>
                <Text style={styles.resultPct}>{r.percent ?? 0}%</Text>
              </View>
            ))
          )}
          <Text style={styles.totalVotes}>Total votes: {pollResults.totalVotes ?? 0}</Text>
          <Pressable style={styles.linkBtn} onPress={() => setViewPollId(null)}>
            <Text style={styles.linkBtnText}>Close results</Text>
          </Pressable>
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
        placeholder="Question"
        value={question}
        onChangeText={setQuestion}
      />
      {options.map((opt, i) => (
        <View key={i} style={styles.optRow}>
          <TextInput
            style={[styles.input, styles.optInput]}
            placeholder={`Option ${i + 1}`}
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
        onPress={() => setOptions([...options, ""])}
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
      <Pressable
        style={styles.primaryBtn}
        onPress={() => void createPoll.mutate()}
        disabled={createPoll.isPending || !!activePoll}
      >
        <Text style={styles.primaryBtnText}>{createPoll.isPending ? "Starting…" : "Start poll"}</Text>
      </Pressable>
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
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
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
  resultsTitle: { fontSize: 12, fontWeight: "700", marginBottom: 8 },
  resultRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  resultLabel: { flex: 1, fontSize: 12, color: Colors.light.text },
  resultPct: { fontSize: 12, fontWeight: "700", color: Colors.light.primary },
  totalVotes: { fontSize: 11, color: Colors.light.textMuted, marginTop: 6 },
});
