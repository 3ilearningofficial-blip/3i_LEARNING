import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { isAndroidWeb } from "@/lib/useAndroidWebGate";
import AndroidWebGate from "@/components/AndroidWebGate";
import { getApiUrl } from "@/lib/query-client";
import { authFetch } from "@/lib/query-client";

interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  percentage: string;
  time_taken_seconds: number;
  user_id: number;
}

interface AttemptHistoryEntry {
  id: number;
  score: number;
  total_marks: number;
  percentage: string;
  completed_at: number;
}

export default function TestResultScreen() {
  useScreenProtection(true);
  if (isAndroidWeb()) return <AndroidWebGate />;
  const {
    id, score, totalMarks, correct, incorrect, totalAttempts,
    percentage, weakTopics, attemptId, testType, timeTakenSeconds, totalQuestions,
  } = useLocalSearchParams<{
    id: string; score: string; totalMarks: string;
    correct: string; incorrect: string; totalAttempts: string;
    percentage: string; weakTopics: string; attemptId: string; testType: string;
    timeTakenSeconds: string; totalQuestions: string;
  }>();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<"result" | "leaderboard">("result");
  const [wsTab, setWsTab] = useState<"weak" | "strong">("weak");

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: leaderboard = [], isLoading: lbLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/tests", id, "leaderboard"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/tests/${id}/leaderboard`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "leaderboard",
  });

  const { data: analysis } = useQuery<any>({
    queryKey: ["/api/tests", id, "analysis", attemptId],
    queryFn: async () => {
      if (!attemptId || attemptId === "undefined") return null;
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/tests/${id}/analysis/${attemptId}`, baseUrl).toString());
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!attemptId && attemptId !== "undefined",
  });

  // 6.4 — fetch all attempts for this test
  const { data: attemptHistory = [] } = useQuery<AttemptHistoryEntry[]>({
    queryKey: ["/api/tests", id, "my-attempts"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/tests/${id}/my-attempts`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
  });

  const scoreNum = parseFloat(score || "0");
  const totalNum = parseFloat(totalMarks || "100");
  const pctNum = parseFloat(percentage || "0");
  const totalQNum = parseInt(totalQuestions || "0", 10);
  const timeTakenNum = parseInt(timeTakenSeconds || "0", 10);

  // Use analysis data if available (fills in missing values from old attempts)
  const youData = analysis?.you;
  const correctNum = youData?.correct != null ? youData.correct : parseInt(correct || "0", 10);
  const incorrectNum = youData?.incorrect != null ? youData.incorrect : parseInt(incorrect || "0", 10);
  const attemptsNum = youData != null
    ? (correctNum + incorrectNum)  // attempted = correct + wrong
    : parseInt(totalAttempts || "0", 10);
  const unattemptedNum = totalQNum > 0 ? Math.max(0, totalQNum - attemptsNum) : 0;
  const avgTimePerQ = attemptsNum > 0 ? Math.round(timeTakenNum / attemptsNum) : 0;
  const weakTopicList = weakTopics ? weakTopics.split(",").filter(Boolean) : [];

  const grade = pctNum >= 90 ? "A+" : pctNum >= 80 ? "A" : pctNum >= 70 ? "B" : pctNum >= 60 ? "C" : pctNum >= 40 ? "D" : "F";
  const gradeColor = pctNum >= 70 ? "#22C55E" : pctNum >= 40 ? "#F59E0B" : "#EF4444";

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#0A1628", "#1A2E50"]}
        style={[styles.header, { paddingTop: topPadding }]}
      >
        {/* Top row: back + title + verify + grade */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable style={styles.backBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.resultTitle}>Test Completed</Text>
            <Text style={styles.resultSubtitle}>Here's how you performed</Text>
          </View>
          {attemptId && attemptId !== "undefined" && (
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
              onPress={() => router.push({ pathname: "/test-verify/[id]", params: { id, attemptId, timeTakenSeconds: timeTakenSeconds || "0" } })}
            >
              <Ionicons name="checkmark-done" size={16} color="#fff" />
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Solutions</Text>
            </Pressable>
          )}
          <View style={[styles.gradeCircle, { borderColor: gradeColor }]}>
            <Text style={[styles.gradeText, { color: gradeColor }]}>{grade}</Text>
          </View>
        </View>

        {/* Icon-based stats grid */}
        <View style={styles.iconStatsGrid}>
          {[
            { icon: "trophy", bg: "#7C3AED", label: "Score", value: `${Math.max(0, scoreNum)}`, sub: `/${totalNum}` },
            { icon: "checkmark-circle", bg: "#22C55E", label: "Correct", value: String(correctNum), sub: "" },
            { icon: "document-text", bg: "#0891B2", label: "Attempted", value: String(attemptsNum), sub: `/${totalQNum || "?"}` },
            { icon: "close-circle", bg: "#EF4444", label: "Wrong", value: String(incorrectNum), sub: "" },
            { icon: "analytics", bg: "#F59E0B", label: "Percentage", value: `${Math.max(0, pctNum).toFixed(1)}`, sub: "%" },
            { icon: "remove-circle", bg: "#94A3B8", label: "Skipped", value: String(unattemptedNum), sub: "" },
            { icon: "time", bg: "#1A56DB", label: "Total Time", value: timeTakenNum >= 60 ? `${Math.floor(timeTakenNum / 60)}m ${timeTakenNum % 60}s` : `${timeTakenNum}s`, sub: "" },
            { icon: "speedometer", bg: "#DB2777", label: "Avg/Question", value: avgTimePerQ >= 60 ? `${Math.floor(avgTimePerQ / 60)}m` : `${avgTimePerQ}s`, sub: "" },
          ].map((item, i) => (
            <View key={i} style={styles.iconStatItem}>
              <View style={[styles.iconStatCircle, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon as any} size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.iconStatValue}>
                  {item.value}
                  {item.sub ? <Text style={styles.iconStatSub}>{item.sub}</Text> : null}
                </Text>
                <Text style={styles.iconStatLabel}>{item.label}</Text>
              </View>
            </View>
          ))}
        </View>
      </LinearGradient>

      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabItem, activeTab === "result" && styles.tabActive]}
          onPress={() => setActiveTab("result")}
        >
          <Text style={[styles.tabText, activeTab === "result" && styles.tabTextActive]}>Analysis</Text>
        </Pressable>
        <Pressable
          style={[styles.tabItem, activeTab === "leaderboard" && styles.tabActive]}
          onPress={() => setActiveTab("leaderboard")}
        >
          <Text style={[styles.tabText, activeTab === "leaderboard" && styles.tabTextActive]}>Leaderboard</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 100 }]}
      >
        {activeTab === "result" && (
          <>
            {/* 6.3 — Weak Topics only for mock tests */}
            {testType === "mock" && (
              <View style={styles.weakTopicsCard}>
                <View style={styles.weakTopicsHeader}>
                  <Ionicons name="warning" size={20} color="#F59E0B" />
                  <Text style={styles.weakTopicsTitle}>Weak Areas - Need More Practice</Text>
                </View>
                {weakTopicList.length === 0 ? (
                  <Text style={styles.noWeakTopics}>No weak topics — great job!</Text>
                ) : (
                  weakTopicList.map((topic) => (
                    <View key={topic} style={styles.weakTopicRow}>
                      <View style={styles.weakTopicDot} />
                      <Text style={styles.weakTopicText}>{topic}</Text>
                      <Pressable style={styles.practiceBtn} onPress={() => {}}>
                        <Text style={styles.practiceBtnText}>Practice</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* 6.4 — Attempt history when more than one attempt exists */}
            {attemptHistory.length > 1 && (
              <View style={styles.historyCard}>
                <Text style={styles.historyTitle}>Attempt History</Text>
                {attemptHistory.map((attempt, idx) => (
                  <View key={attempt.id} style={[styles.historyRow, idx < attemptHistory.length - 1 && styles.historyRowBorder]}>
                    <View style={styles.historyAttemptBadge}>
                      <Text style={styles.historyAttemptNum}>#{attemptHistory.length - idx}</Text>
                    </View>
                    <View style={styles.historyInfo}>
                      <Text style={styles.historyScore}>{attempt.score}/{attempt.total_marks}</Text>
                      <Text style={styles.historyDate}>{formatDate(attempt.completed_at)}</Text>
                    </View>
                    <Text style={styles.historyPct}>{parseFloat(attempt.percentage).toFixed(1)}%</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.motivationCard}>
              <Ionicons name="bulb" size={24} color="#F59E0B" />
              <Text style={styles.motivationText}>
                {pctNum >= 60
                  ? "Excellent work! Keep up the momentum. Regular practice will help you master these topics."
                  : "Don't be discouraged. Review the topics you found difficult and try again. Consistency is the key to success!"}
              </Text>
            </View>

            {/* Weakness & Strength */}
            {analysis?.topics && analysis.topics.length > 0 && (
              <View style={styles.analysisCard}>
                <Text style={styles.analysisTitle}>Your Weakness and Strengths</Text>
                <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.light.border, marginBottom: 12 }}>
                  {(["weak", "strong"] as const).map((t) => (
                    <Pressable key={t} onPress={() => setWsTab(t)}
                      style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: wsTab === t ? Colors.light.primary : "transparent" }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: wsTab === t ? Colors.light.primary : Colors.light.textMuted }}>
                        {t === "weak" ? "Weak Topics" : "Strong Topics"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {analysis.topics
                  .filter((t: any) => wsTab === "weak" ? t.isWeak : !t.isWeak)
                  .map((topic: any, i: number) => (
                    <View key={i} style={{ backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.light.border }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 8 }}>
                        {i + 1}. {topic.name}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_500Medium", width: 70 }}>Correct %</Text>
                        <View style={{ flex: 1, height: 6, backgroundColor: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
                          <View style={{ height: 6, backgroundColor: topic.isWeak ? "#EF4444" : "#22C55E", width: `${topic.correctPct}%` as any, borderRadius: 3 }} />
                        </View>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: topic.isWeak ? "#EF4444" : "#22C55E", width: 40, textAlign: "right" }}>{topic.correctPct}%</Text>
                      </View>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {topic.qNums.map((qn: number, qi: number) => (
                          <View key={qi} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: topic.isWeak ? "#EF4444" : "#22C55E", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>{qn}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                {analysis.topics.filter((t: any) => wsTab === "weak" ? t.isWeak : !t.isWeak).length === 0 && (
                  <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 16 }}>
                    {wsTab === "weak" ? "No weak topics — great job!" : "No strong topics yet."}
                  </Text>
                )}
              </View>
            )}

            {/* Compare with Topper */}
            {analysis?.topper && (
              <View style={styles.analysisCard}>
                <Text style={styles.analysisTitle}>Compare with Topper</Text>
                {/* Table */}
                <View style={{ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: Colors.light.border }}>
                  {/* Header */}
                  <View style={{ flexDirection: "row", backgroundColor: "#F9FAFB" }}>
                    <View style={{ width: 70, padding: 10 }} />
                    {["Score", "Accuracy", "Correct", "Wrong", "Time"].map((h) => (
                      <View key={h} style={{ flex: 1, padding: 10, alignItems: "center" }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted }}>{h}</Text>
                      </View>
                    ))}
                  </View>
                  {/* Rows */}
                  {[
                    { label: "You", data: analysis.you, bg: "#EFF6FF" },
                    { label: "Topper", data: analysis.topper, bg: "#F0FDF4" },
                    { label: "Avg", data: analysis.avg, bg: "#FAFAFA" },
                  ].map((row) => {
                    const t = row.data;
                    const timeS = t.timeTaken || 0;
                    const timeStr = timeS >= 60 ? `${Math.floor(timeS / 60)}m ${timeS % 60}s` : `${timeS}s`;
                    return (
                      <View key={row.label} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: Colors.light.border, backgroundColor: row.bg }}>
                        <View style={{ width: 70, padding: 10, justifyContent: "center" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{row.label}</Text>
                        </View>
                        <View style={{ flex: 1, padding: 10, alignItems: "center" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{parseFloat(t.score).toFixed(1)}</Text>
                          <Text style={{ fontSize: 10, color: Colors.light.textMuted }}>/{t.totalMarks || totalNum}</Text>
                        </View>
                        <View style={{ flex: 1, padding: 10, alignItems: "center" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{parseFloat(t.percentage).toFixed(1)}%</Text>
                        </View>
                        <View style={{ flex: 1, padding: 10, alignItems: "center" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#22C55E" }}>
                            {t.correct != null ? t.correct : "—"}
                          </Text>
                        </View>
                        <View style={{ flex: 1, padding: 10, alignItems: "center" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#EF4444" }}>
                            {t.incorrect != null ? t.incorrect : "—"}
                          </Text>
                        </View>
                        <View style={{ flex: 1, padding: 10, alignItems: "center" }}>
                          <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{timeStr}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={styles.actionButtons}>
              <Pressable style={styles.retryBtn} onPress={() => router.replace(`/test/${id}`)}>
                <Ionicons name="refresh" size={18} color={Colors.light.primary} />
                <Text style={styles.retryBtnText}>Retry Test</Text>
              </Pressable>
              <Pressable style={styles.homeBtn} onPress={() => router.replace("/(tabs)")}>
                <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.homeBtnGrad}>
                  <Ionicons name="home" size={18} color="#fff" />
                  <Text style={styles.homeBtnText}>Go Home</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </>
        )}

        {activeTab === "leaderboard" && (
          <View style={styles.leaderboardSection}>
            {lbLoading ? (
              <View style={styles.lbLoading}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
              </View>
            ) : leaderboard.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="trophy-outline" size={48} color={Colors.light.textMuted} />
                <Text style={styles.emptyTitle}>No leaderboard data yet</Text>
              </View>
            ) : (
              leaderboard.map((entry, idx) => (
                <View key={entry.user_id} style={[styles.lbEntry, idx < 3 && styles.lbTopEntry]}>
                  {/* Rank number */}
                  <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827", width: 22, textAlign: "center" }}>{idx + 1}</Text>
                  {/* Trophy/rank badge */}
                  <View style={[
                    styles.lbRankBadge,
                    idx === 0 && { backgroundColor: "#F59E0B" },
                    idx === 1 && { backgroundColor: "#9CA3AF" },
                    idx === 2 && { backgroundColor: "#CD7C2F" },
                  ]}>
                    {idx < 3 ? (
                      <Ionicons name="trophy" size={16} color="#fff" />
                    ) : (
                      <Text style={styles.lbRankText}>{entry.rank}</Text>
                    )}
                  </View>
                  {/* Profile avatar */}
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: Colors.light.border }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>
                      {entry.name?.charAt(0)?.toUpperCase() || "S"}
                    </Text>
                  </View>
                  <View style={styles.lbInfo}>
                    <Text style={styles.lbName}>{entry.name}</Text>
                    <Text style={styles.lbMeta}>{
                      entry.time_taken_seconds >= 60
                        ? `${Math.round(entry.time_taken_seconds / 60)}min taken`
                        : entry.time_taken_seconds > 0
                        ? `${entry.time_taken_seconds}s taken`
                        : "—"
                    }</Text>
                  </View>
                  <View style={styles.lbScore}>
                    <Text style={styles.lbScoreValue}>{entry.score}</Text>
                    <Text style={styles.lbPct}>{parseFloat(entry.percentage).toFixed(0)}%</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  resultHero: { alignItems: "center", gap: 6 },
  gradeCircle: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.2)" },
  gradeText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  resultTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  resultSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  // Icon stats grid
  iconStatsGrid: { backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 14, padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 0 },
  iconStatItem: { width: "50%", flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 8 },
  iconStatCircle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  iconStatValue: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  iconStatSub: { fontSize: 12, color: "rgba(255,255,255,0.55)", fontFamily: "Inter_400Regular" },
  iconStatLabel: { fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: "Inter_400Regular", marginTop: 1 },
  // Legacy (kept for leaderboard etc.)
  statsGrid: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6 },
  statCard: { flex: 1, alignItems: "center", gap: 1 },
  statDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.15)", marginHorizontal: 2 },
  statLabel: { fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular", textAlign: "center" },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  statSub: { fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular" },
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  tabItem: { flex: 1, paddingVertical: 14, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  tabTextActive: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },
  weakTopicsCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12, borderLeftWidth: 4, borderLeftColor: "#F59E0B" },
  weakTopicsHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  weakTopicsTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, flex: 1 },
  noWeakTopics: { fontSize: 14, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  weakTopicRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  weakTopicDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#F59E0B" },
  weakTopicText: { flex: 1, fontSize: 14, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  practiceBtn: { backgroundColor: Colors.light.secondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  practiceBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  historyCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 0 },
  historyTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 12 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  historyRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  historyAttemptBadge: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  historyAttemptNum: { fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  historyInfo: { flex: 1 },
  historyScore: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  historyDate: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  historyPct: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  motivationCard: { backgroundColor: "#FFF7ED", borderRadius: 16, padding: 16, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  analysisCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.light.border },
  analysisTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.light.text },
  motivationText: { flex: 1, fontSize: 14, color: Colors.light.text, fontFamily: "Inter_400Regular", lineHeight: 20 },
  actionButtons: { flexDirection: "row", gap: 12 },
  retryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 14, paddingVertical: 14, borderWidth: 2, borderColor: Colors.light.primary },
  retryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  homeBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  homeBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 6 },
  homeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  leaderboardSection: { gap: 8 },
  lbLoading: { paddingVertical: 40, alignItems: "center" },
  emptyState: { paddingVertical: 40, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 16, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  lbEntry: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14 },
  lbTopEntry: { borderWidth: 1.5, borderColor: Colors.light.accent },
  lbRankBadge: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  lbRankText: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary },
  lbInfo: { flex: 1 },
  lbName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  lbMeta: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  lbScore: { alignItems: "flex-end" },
  lbScoreValue: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  lbPct: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
});
