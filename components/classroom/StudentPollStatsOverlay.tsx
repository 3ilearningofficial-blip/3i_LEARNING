import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { usePollBroadcastStats } from "@/lib/classroom/usePollBroadcastStats";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
  /**
   * Compact variant used for the in-video fullscreen overlay. The default
   * (`compact = false`) is used in the sidebar / under-video panel and gets
   * a bigger scrollable leaderboard.
   */
  compact?: boolean;
};

/**
 * Student-facing overlay that surfaces the admin's "Show stats to students"
 * broadcast. Renders side-by-side: percentage bars on the left, top-10
 * leaderboard on the right. Both columns are independently scrollable so a
 * long option list or full 10-name leaderboard never truncates on phone-web.
 */
export default function StudentPollStatsOverlay({
  liveClassId,
  enabled = true,
  compact = false,
}: Props) {
  const { data: stats } = usePollBroadcastStats(liveClassId, enabled);

  if (!stats) return null;

  const questionText = String(stats.question || "").trim();
  const kindLabel = stats.kind === "quiz" ? "Quiz results" : "Poll results";

  return (
    <View style={[styles.wrap, compact ? styles.wrapCompact : styles.wrapFull]}>
      <View style={styles.header}>
        <Text style={styles.kind}>{kindLabel}</Text>
        <Text style={styles.totalVotes}>{stats.totalVotes} votes</Text>
      </View>
      {questionText ? (
        <Text
          style={compact ? styles.questionCompact : styles.question}
          numberOfLines={compact ? 2 : 3}
        >
          {questionText}
        </Text>
      ) : null}
      <View style={styles.split}>
        <ScrollView
          style={styles.colLeft}
          contentContainerStyle={styles.leftContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {stats.results.map((r) => {
            const pct = Number(r.percent ?? 0);
            const isCorrect =
              stats.correctOptionId != null && r.id === stats.correctOptionId;
            return (
              <View key={r.id} style={styles.barRow}>
                <View style={styles.barLabelRow}>
                  <Text style={styles.barLabel} numberOfLines={1}>
                    {r.label}
                    {isCorrect ? "  ✓" : ""}
                  </Text>
                  <Text style={styles.barPct}>{pct}%</Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.max(0, Math.min(100, pct))}%`,
                        backgroundColor: isCorrect ? "#4ADE80" : Colors.light.primary,
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.colRight}>
          <Text style={styles.leaderboardTitle}>Top 10</Text>
          <ScrollView
            style={styles.leaderboardScroll}
            contentContainerStyle={styles.leaderboardContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {stats.leaderboard.length === 0 ? (
              <Text style={styles.leaderboardEmpty}>No votes yet</Text>
            ) : (
              stats.leaderboard.map((row) => (
                <View key={`${row.userId}-${row.votedAt}`} style={styles.lbRow}>
                  <Text style={styles.lbRank}>{row.rank}.</Text>
                  <Text style={styles.lbName} numberOfLines={1}>
                    {row.userName}
                  </Text>
                  {stats.correctOptionId != null ? (
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
  wrapFull: { flex: 1, borderRadius: 12, minHeight: 0 },
  wrapCompact: { borderRadius: 10, maxHeight: "70%" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kind: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  totalVotes: { color: "#94A3B8", fontSize: 11, fontWeight: "600" },
  question: { color: "#F8FAFC", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  questionCompact: { color: "#F8FAFC", fontSize: 12, fontWeight: "700", lineHeight: 16 },
  split: { flexDirection: "row", gap: 10, flex: 1, minHeight: 0 },
  colLeft: { flex: 1, minWidth: 0 },
  colRight: { flex: 1, minWidth: 0 },
  leftContent: { paddingVertical: 2 },
  barRow: { marginBottom: 8 },
  barLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  barLabel: { color: "#E2E8F0", fontSize: 12, fontWeight: "600", flex: 1 },
  barPct: { color: "#F8FAFC", fontSize: 12, fontWeight: "700" },
  barTrack: {
    height: 8,
    backgroundColor: "#1E293B",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 4 },
  leaderboardTitle: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  leaderboardScroll: { flex: 1, minHeight: 0 },
  leaderboardContent: { paddingBottom: 4 },
  leaderboardEmpty: { color: "#94A3B8", fontSize: 11 },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    gap: 6,
  },
  lbRank: { color: "#94A3B8", fontSize: 11, fontWeight: "700", width: 22 },
  lbName: { color: "#E2E8F0", fontSize: 12, flex: 1 },
  lbBadge: { fontSize: 12, fontWeight: "800", width: 16, textAlign: "center" },
  lbBadgeOk: { color: "#4ADE80" },
  lbBadgeNo: { color: "#64748B" },
});
