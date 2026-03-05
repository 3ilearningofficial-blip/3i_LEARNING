import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, FlatList,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";

interface Test {
  id: number;
  title: string;
  description: string;
  duration_minutes: number;
  total_questions: number;
  total_marks: number;
  passing_marks: number;
  test_type: string;
}

interface TestAttempt {
  id: number;
  test_id: number;
  score: number;
  total_marks: number;
  percentage: string;
  title: string;
  test_type: string;
  completed_at: number;
}

const TEST_TYPES = ["All", "mock", "practice", "chapter", "weekly"];
const TEST_TYPE_LABELS: Record<string, string> = {
  All: "All Tests", mock: "Mock Tests", practice: "Practice", chapter: "Chapter Tests", weekly: "Weekly Tests",
};
const TEST_TYPE_COLORS: Record<string, string> = {
  mock: "#DC2626", practice: "#1A56DB", chapter: "#059669", weekly: "#7C3AED",
};

function TestCard({ test, onPress }: { test: Test; onPress: () => void }) {
  const color = TEST_TYPE_COLORS[test.test_type] || Colors.light.primary;
  const hours = Math.floor(test.duration_minutes / 60);
  const mins = test.duration_minutes % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins > 0 ? `${mins}m` : ""}` : `${mins}m`;

  return (
    <Pressable
      style={({ pressed }) => [styles.testCard, pressed && { opacity: 0.92, transform: [{ scale: 0.98 }] }]}
      onPress={onPress}
    >
      <View style={[styles.testTypeBar, { backgroundColor: color }]} />
      <View style={styles.testCardContent}>
        <View style={styles.testCardHeader}>
          <View style={[styles.testTypeBadge, { backgroundColor: `${color}18` }]}>
            <Text style={[styles.testTypeBadgeText, { color }]}>{TEST_TYPE_LABELS[test.test_type] || test.test_type}</Text>
          </View>
          <View style={styles.testDuration}>
            <Ionicons name="time-outline" size={13} color={Colors.light.textMuted} />
            <Text style={styles.testDurationText}>{durationStr}</Text>
          </View>
        </View>
        <Text style={styles.testTitle}>{test.title}</Text>
        {test.description ? <Text style={styles.testDesc} numberOfLines={2}>{test.description}</Text> : null}
        <View style={styles.testStats}>
          <View style={styles.testStat}>
            <Ionicons name="help-circle-outline" size={14} color={Colors.light.textSecondary} />
            <Text style={styles.testStatText}>{test.total_questions} Questions</Text>
          </View>
          <View style={styles.testStatDot} />
          <View style={styles.testStat}>
            <Ionicons name="trophy-outline" size={14} color={Colors.light.textSecondary} />
            <Text style={styles.testStatText}>{test.total_marks} Marks</Text>
          </View>
          <View style={styles.testStatDot} />
          <View style={styles.testStat}>
            <Ionicons name="checkmark-circle-outline" size={14} color={Colors.light.textSecondary} />
            <Text style={styles.testStatText}>Pass: {test.passing_marks}</Text>
          </View>
        </View>
        <Pressable
          style={[styles.startTestBtn, { backgroundColor: `${color}18`, borderColor: color }]}
          onPress={onPress}
        >
          <Text style={[styles.startTestBtnText, { color }]}>Start Test</Text>
          <Ionicons name="arrow-forward" size={14} color={color} />
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function TestSeriesScreen() {
  const insets = useSafeAreaInsets();
  const [selectedType, setSelectedType] = useState("All");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: tests = [], isLoading } = useQuery<Test[]>({
    queryKey: ["/api/tests", selectedType],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/tests", baseUrl);
      if (selectedType !== "All") url.searchParams.set("type", selectedType);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
  });

  const { data: myAttempts = [] } = useQuery<TestAttempt[]>({
    queryKey: ["/api/my-attempts"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/my-attempts", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const handleStartTest = (testId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/test/${testId}`);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <Text style={styles.headerTitle}>Test Series</Text>
        <Text style={styles.headerSub}>Practice, Improve, Excel</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          {TEST_TYPES.map((type) => (
            <Pressable
              key={type}
              style={[styles.filterChip, selectedType === type && styles.filterChipActive]}
              onPress={() => setSelectedType(type)}
            >
              <Text style={[styles.filterText, selectedType === type && styles.filterTextActive]}>
                {TEST_TYPE_LABELS[type] || type}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 80 }]}
      >
        {myAttempts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Attempts</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attemptsRow}>
              {myAttempts.slice(0, 5).map((attempt) => {
                const pct = parseFloat(attempt.percentage);
                const color = pct >= 70 ? "#22C55E" : pct >= 40 ? "#F59E0B" : "#EF4444";
                return (
                  <View key={attempt.id} style={styles.attemptCard}>
                    <View style={[styles.attemptCircle, { borderColor: color }]}>
                      <Text style={[styles.attemptPct, { color }]}>{Math.round(pct)}%</Text>
                    </View>
                    <Text style={styles.attemptTitle} numberOfLines={2}>{attempt.title}</Text>
                    <Text style={styles.attemptScore}>{attempt.score}/{attempt.total_marks}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {selectedType === "All" ? "All Tests" : TEST_TYPE_LABELS[selectedType]}
            <Text style={styles.testCount}> ({tests.length})</Text>
          </Text>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.light.primary} />
            </View>
          ) : tests.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={48} color={Colors.light.textMuted} />
              <Text style={styles.emptyTitle}>No tests available</Text>
              <Text style={styles.emptySubtitle}>Check back soon for new tests</Text>
            </View>
          ) : (
            tests.map((test) => (
              <TestCard key={test.id} test={test} onPress={() => handleStartTest(test.id)} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", marginBottom: 12 },
  filterContent: { gap: 8, paddingVertical: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  filterChipActive: { backgroundColor: "#fff", borderColor: "#fff" },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  filterTextActive: { color: Colors.light.primary },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, gap: 8 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  testCount: { fontFamily: "Inter_400Regular", color: Colors.light.textMuted, fontSize: 16 },
  testCard: {
    backgroundColor: "#fff", borderRadius: 16, overflow: "hidden",
    flexDirection: "row", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 3,
  },
  testTypeBar: { width: 4 },
  testCardContent: { flex: 1, padding: 14, gap: 8 },
  testCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  testTypeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  testTypeBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  testDuration: { flexDirection: "row", alignItems: "center", gap: 3 },
  testDurationText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  testTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, lineHeight: 21 },
  testDesc: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 18 },
  testStats: { flexDirection: "row", alignItems: "center", gap: 8 },
  testStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  testStatText: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  testStatDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: Colors.light.textMuted },
  startTestBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  startTestBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  attemptsRow: { gap: 12 },
  attemptCard: { width: 100, alignItems: "center", gap: 6 },
  attemptCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  attemptPct: { fontSize: 15, fontFamily: "Inter_700Bold" },
  attemptTitle: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary, textAlign: "center" },
  attemptScore: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted },
  loadingContainer: { paddingVertical: 40, alignItems: "center" },
  emptyState: { alignItems: "center", gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  emptySubtitle: { fontSize: 14, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
});
