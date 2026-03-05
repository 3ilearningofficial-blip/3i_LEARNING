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
import { getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";

interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  percentage: string;
  time_taken_seconds: number;
  user_id: number;
}

export default function TestResultScreen() {
  const { id, score, totalMarks, percentage, passed, weakTopics, attemptId } = useLocalSearchParams<{
    id: string; score: string; totalMarks: string; percentage: string;
    passed: string; weakTopics: string; attemptId: string;
  }>();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<"result" | "leaderboard">("result");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: leaderboard = [], isLoading: lbLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/tests", id, "leaderboard"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/tests/${id}/leaderboard`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
    enabled: activeTab === "leaderboard",
  });

  const scoreNum = parseFloat(score || "0");
  const totalNum = parseFloat(totalMarks || "100");
  const pctNum = parseFloat(percentage || "0");
  const isPassed = passed === "true";
  const weakTopicList = weakTopics ? weakTopics.split(",").filter(Boolean) : [];

  const grade = pctNum >= 90 ? "A+" : pctNum >= 80 ? "A" : pctNum >= 70 ? "B" : pctNum >= 60 ? "C" : pctNum >= 40 ? "D" : "F";
  const gradeColor = pctNum >= 70 ? "#22C55E" : pctNum >= 40 ? "#F59E0B" : "#EF4444";

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={isPassed ? ["#065F46", "#059669"] : ["#7F1D1D", "#DC2626"]}
        style={[styles.header, { paddingTop: topPadding + 8 }]}
      >
        <Pressable style={styles.backBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.replace("/(tabs)/test-series"); }}>
          <Ionicons name="home" size={20} color="#fff" />
        </Pressable>

        <View style={styles.resultHero}>
          <View style={[styles.gradeCircle, { borderColor: gradeColor }]}>
            <Text style={[styles.gradeText, { color: gradeColor }]}>{grade}</Text>
          </View>
          <Text style={styles.resultStatus}>{isPassed ? "Congratulations!" : "Keep Practicing!"}</Text>
          <Text style={styles.resultSubtitle}>{isPassed ? "You passed the test!" : "You'll do better next time"}</Text>
        </View>

        <View style={styles.scoreRow}>
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>Score</Text>
            <Text style={styles.scoreValue}>{Math.max(0, scoreNum)}</Text>
            <Text style={styles.scoreTotal}>/{totalNum}</Text>
          </View>
          <View style={styles.scoreCardDivider} />
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>Percentage</Text>
            <Text style={styles.scoreValue}>{Math.max(0, pctNum).toFixed(1)}</Text>
            <Text style={styles.scoreTotal}>%</Text>
          </View>
          <View style={styles.scoreCardDivider} />
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>Status</Text>
            <Text style={[styles.scoreValue, { color: isPassed ? "#86EFAC" : "#FCA5A5", fontSize: 16 }]}>
              {isPassed ? "PASS" : "FAIL"}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.tabBar}>
        <Pressable style={[styles.tabItem, activeTab === "result" && styles.tabActive]} onPress={() => setActiveTab("result")}>
          <Text style={[styles.tabText, activeTab === "result" && styles.tabTextActive]}>Analysis</Text>
        </Pressable>
        <Pressable style={[styles.tabItem, activeTab === "leaderboard" && styles.tabActive]} onPress={() => setActiveTab("leaderboard")}>
          <Text style={[styles.tabText, activeTab === "leaderboard" && styles.tabTextActive]}>Leaderboard</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 100 }]}>
        {activeTab === "result" && (
          <>
            <View style={styles.analysisGrid}>
              <View style={styles.analysisCard}>
                <LinearGradient colors={["#DCFCE7", "#BBF7D0"]} style={styles.analysisCardGrad}>
                  <Ionicons name="checkmark-circle" size={24} color="#15803D" />
                  <Text style={styles.analysisValue}>{Math.max(0, Math.round(scoreNum / (totalNum / 100 * (100 / totalNum))))}%</Text>
                  <Text style={styles.analysisLabel}>Accuracy</Text>
                </LinearGradient>
              </View>
              <View style={styles.analysisCard}>
                <LinearGradient colors={["#DBEAFE", "#BFDBFE"]} style={styles.analysisCardGrad}>
                  <Ionicons name="trophy" size={24} color="#1D4ED8" />
                  <Text style={styles.analysisValue}>{grade}</Text>
                  <Text style={styles.analysisLabel}>Grade</Text>
                </LinearGradient>
              </View>
            </View>

            {weakTopicList.length > 0 && (
              <View style={styles.weakTopicsCard}>
                <View style={styles.weakTopicsHeader}>
                  <Ionicons name="warning" size={20} color="#F59E0B" />
                  <Text style={styles.weakTopicsTitle}>Weak Areas - Need More Practice</Text>
                </View>
                {weakTopicList.map((topic) => (
                  <View key={topic} style={styles.weakTopicRow}>
                    <View style={styles.weakTopicDot} />
                    <Text style={styles.weakTopicText}>{topic}</Text>
                    <Pressable style={styles.practiceBtn} onPress={() => {}}>
                      <Text style={styles.practiceBtnText}>Practice</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.motivationCard}>
              <Ionicons name="bulb" size={24} color="#F59E0B" />
              <Text style={styles.motivationText}>
                {isPassed
                  ? "Excellent work! Keep up the momentum. Regular practice will help you master these topics."
                  : "Don't be discouraged. Review the topics you found difficult and try again. Consistency is the key to success!"}
              </Text>
            </View>

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
                  <View style={[styles.lbRankBadge, idx === 0 && { backgroundColor: "#F59E0B" }, idx === 1 && { backgroundColor: "#9CA3AF" }, idx === 2 && { backgroundColor: "#CD7C2F" }]}>
                    {idx < 3 ? (
                      <Ionicons name="trophy" size={16} color="#fff" />
                    ) : (
                      <Text style={styles.lbRankText}>{entry.rank}</Text>
                    )}
                  </View>
                  <View style={styles.lbInfo}>
                    <Text style={styles.lbName}>{entry.name}</Text>
                    <Text style={styles.lbMeta}>{Math.round(entry.time_taken_seconds / 60)}min taken</Text>
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
  header: { paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  resultHero: { alignItems: "center", gap: 8 },
  gradeCircle: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.2)" },
  gradeText: { fontSize: 28, fontFamily: "Inter_700Bold" },
  resultStatus: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  resultSubtitle: { fontSize: 14, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" },
  scoreRow: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 16, padding: 16 },
  scoreCard: { flex: 1, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 2 },
  scoreCardDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.2)", marginHorizontal: 4 },
  scoreLabel: { fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", width: "100%", textAlign: "center" },
  scoreValue: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  scoreTotal: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", marginTop: 6 },
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  tabItem: { flex: 1, paddingVertical: 14, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  tabTextActive: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },
  analysisGrid: { flexDirection: "row", gap: 12 },
  analysisCard: { flex: 1, borderRadius: 16, overflow: "hidden" },
  analysisCardGrad: { padding: 16, alignItems: "center", gap: 6 },
  analysisValue: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.light.text },
  analysisLabel: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_500Medium" },
  weakTopicsCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12, borderLeftWidth: 4, borderLeftColor: "#F59E0B" },
  weakTopicsHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  weakTopicsTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, flex: 1 },
  weakTopicRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  weakTopicDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#F59E0B" },
  weakTopicText: { flex: 1, fontSize: 14, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  practiceBtn: { backgroundColor: Colors.light.secondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  practiceBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  motivationCard: { backgroundColor: "#FFF7ED", borderRadius: 16, padding: 16, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  motivationText: { flex: 1, fontSize: 14, color: Colors.light.text, fontFamily: "Inter_400Regular", lineHeight: 20 },
  actionButtons: { flexDirection: "row", gap: 12 },
  retryBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: 14, paddingVertical: 14, borderWidth: 2, borderColor: Colors.light.primary,
  },
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
