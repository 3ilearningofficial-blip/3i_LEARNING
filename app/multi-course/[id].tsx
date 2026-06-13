import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SUBJECTS = [
  { key: "maths", label: "Maths", icon: "calculator", color: "#EF4444", bg: "#FEF2F2" },
  { key: "english", label: "English", icon: "book", color: "#2563EB", bg: "#EFF6FF" },
  { key: "science", label: "Science", icon: "flask", color: "#16A34A", bg: "#F0FDF4" },
  { key: "gk", label: "G.K", icon: "earth", color: "#0891B2", bg: "#ECFEFF" },
] as const;

function countBySubject(rows: any[] | undefined, subjectKey: string, predicate?: (row: any) => boolean): number {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => String(row?.subject_key || "").toLowerCase() === subjectKey && (!predicate || predicate(row))).length;
}

async function fetchJson(path: string) {
  const res = await authFetch(new URL(path, getApiUrl()).toString());
  if (!res.ok) return null;
  return res.json();
}

export default function MultiCourseLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const subjectBoxWidth = width >= 768 ? "23.5%" : "48%";
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
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable style={[styles.backBtn, { backgroundColor: "#EEF2FF" }]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={Colors.light.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{course?.title || "Course Layout"}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Choose a subject to continue</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Subjects</Text>
        <View style={styles.grid}>
          {SUBJECTS.map((subject) => {
            const lectures = countBySubject(course?.lectures, subject.key);
            const materials = countBySubject(course?.materials, subject.key);
            const tests = countBySubject(course?.tests, subject.key, (t) => !["pyq", "mock"].includes(String(t.test_type || "").toLowerCase()));
            const live = Array.isArray(liveClasses) ? liveClasses.filter((lc: any) => String(lc.subject_key || "").toLowerCase() === subject.key).length : 0;
            const totalItems = live + lectures + materials + tests;
            return (
            <Pressable
              key={subject.key}
              style={[styles.subjectBox, { width: subjectBoxWidth as any, backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(`/multi-course-subject/${id}/${subject.key}` as any)}
            >
              <View style={[styles.subjectIconBox, { backgroundColor: subject.bg }]}>
                <Ionicons name={subject.icon as keyof typeof Ionicons.glyphMap} size={29} color={subject.color} />
              </View>
              <Text style={[styles.subjectBoxTitle, { color: colors.text }]} numberOfLines={1}>{subject.label}</Text>
              <Text style={[styles.subjectBoxMeta, { color: colors.textSecondary }]}>{totalItems} items</Text>
            </Pressable>
            );
          })}
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
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1 },
  backBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_700Bold", marginTop: 2 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  subjectBox: {
    minHeight: 104,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 8,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  subjectIconBox: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  subjectBoxTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  subjectBoxMeta: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 3, textAlign: "center" },
  liveCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 10 },
  liveIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  liveTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  liveMeta: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 16 },
});
