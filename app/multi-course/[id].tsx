import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SUBJECTS = [
  { key: "maths", label: "Maths", icon: "calculator", colors: ["#4F46E5", "#7C3AED"] },
  { key: "english", label: "English", icon: "book", colors: ["#0891B2", "#06B6D4"] },
  { key: "science", label: "Science", icon: "flask", colors: ["#059669", "#22C55E"] },
  { key: "gk", label: "G.K", icon: "earth", colors: ["#D97706", "#F59E0B"] },
] as const;

async function fetchJson(path: string) {
  const res = await authFetch(new URL(path, getApiUrl()).toString());
  if (!res.ok) return null;
  return res.json();
}

export default function MultiCourseLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { data: course, isLoading } = useQuery({
    queryKey: ["/api/courses", String(id)],
    queryFn: () => fetchJson(`/api/courses/${id}`),
    enabled: !!id,
  });
  const { data: liveClasses = [] } = useQuery({
    queryKey: ["/api/live-classes", id, "multi"],
    queryFn: async () => (await fetchJson(`/api/live-classes?courseId=${id}`)) || [],
    enabled: !!id,
    staleTime: 30_000,
  });

  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={Colors.light.primary} /></View>;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={["#0F172A", "#1E293B"]} style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{course?.title || "Course Layout"}</Text>
          <Text style={styles.subtitle}>Choose a subject to continue</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Subjects</Text>
        <View style={styles.grid}>
          {SUBJECTS.map((subject) => (
            <Pressable key={subject.key} style={styles.subjectCard} onPress={() => router.push(`/multi-course-subject/${id}/${subject.key}` as any)}>
              <LinearGradient colors={subject.colors as any} style={styles.subjectGradient}>
                <Ionicons name={subject.icon as keyof typeof Ionicons.glyphMap} size={32} color="#fff" />
                <Text style={styles.subjectTitle}>{subject.label}</Text>
                <Ionicons name="arrow-forward-circle" size={22} color="rgba(255,255,255,0.9)" />
              </LinearGradient>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Live / Scheduled Classes</Text>
        {Array.isArray(liveClasses) && liveClasses.length > 0 ? liveClasses.slice(0, 8).map((lc: any) => (
          <Pressable key={lc.id} style={[styles.liveCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push(`/live-class/${lc.id}` as any)}>
            <View style={styles.liveIcon}><Ionicons name={lc.is_live ? "radio" : "calendar"} size={18} color="#DC2626" /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.liveTitle, { color: colors.text }]} numberOfLines={1}>{lc.title}</Text>
              <Text style={[styles.liveMeta, { color: colors.textSecondary }]}>
                {lc.subject_key ? `${String(lc.subject_key).toUpperCase()} · ` : ""}{lc.is_live ? "Live now" : new Date(Number(lc.scheduled_at || Date.now())).toLocaleString()}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        )) : (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }}>No live or scheduled classes yet.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 18 },
  backBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 21, fontFamily: "Inter_800ExtraBold" },
  subtitle: { color: "rgba(255,255,255,0.72)", fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  subjectCard: { width: "48%", minHeight: 132, borderRadius: 20, overflow: "hidden" },
  subjectGradient: { flex: 1, padding: 16, justifyContent: "space-between" },
  subjectTitle: { color: "#fff", fontSize: 20, fontFamily: "Inter_800ExtraBold" },
  liveCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 10 },
  liveIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  liveTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  liveMeta: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 16 },
});
