import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MULTI_SUBJECTS, SubjectIcon, getSubjectMeta, type MultiSubject } from "@/constants/multiSubjects";

function countBySubject(rows: any[] | undefined, subjectKey: string): number {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => String(row?.subject_key || "").toLowerCase() === subjectKey).length;
}

function buildSubjectList(course: any, liveClasses: any[]): MultiSubject[] {
  const canonicalKeys = new Set(MULTI_SUBJECTS.map((s) => s.key));
  const legacyKeys = new Set<string>();
  const rows = [
    ...(Array.isArray(course?.lectures) ? course.lectures : []),
    ...(Array.isArray(course?.tests) ? course.tests : []),
    ...(Array.isArray(course?.materials) ? course.materials : []),
    ...(Array.isArray(liveClasses) ? liveClasses : []),
  ];
  for (const row of rows) {
    const k = String(row?.subject_key || "").toLowerCase();
    if (k && !canonicalKeys.has(k)) legacyKeys.add(k);
  }
  return [...MULTI_SUBJECTS, ...Array.from(legacyKeys).map(getSubjectMeta)];
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
  const isWebGrid = width >= 768;
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

  const subjects = useMemo(() => buildSubjectList(course, liveClasses), [course, liveClasses]);

  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={Colors.light.primary} /></View>;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={styles.headerTextCol}>
          <Text style={styles.title} numberOfLines={1}>{course?.title || "Course Layout"}</Text>
          <Text style={styles.subtitle}>Choose a subject to continue</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Subjects</Text>
        <View style={[styles.grid, isWebGrid ? styles.gridWeb : styles.gridMobile]}>
          {subjects.map((subject) => {
            const lectures = countBySubject(course?.lectures, subject.key);
            const tests = countBySubject(course?.tests, subject.key);
            const countText = `${lectures} Lecture${lectures === 1 ? "" : "s"} · ${tests} Test${tests === 1 ? "" : "s"}`;
            return (
              <Pressable
                key={subject.key}
                style={[
                  isWebGrid ? styles.subjectBoxWeb : styles.subjectRowMobile,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
                onPress={() => router.push(`/multi-course-subject/${id}/${subject.key}` as any)}
              >
                <View style={[isWebGrid ? styles.subjectIconBox : styles.subjectIconBoxMobile, { backgroundColor: subject.bg }]}>
                  <SubjectIcon subject={subject} size={isWebGrid ? 29 : 26} />
                </View>
                <View style={isWebGrid ? styles.subjectTextColWeb : styles.subjectTextColMobile}>
                  <Text style={[styles.subjectBoxTitle, isWebGrid ? null : styles.subjectBoxTitleMobile, { color: colors.text }]} numberOfLines={2}>{subject.label}</Text>
                  <Text style={[styles.subjectBoxMeta, isWebGrid ? null : styles.subjectBoxMetaMobile, { color: colors.textSecondary }]} numberOfLines={2}>{countText}</Text>
                </View>
                {!isWebGrid && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Live / Scheduled Classes</Text>
        {Array.isArray(liveClasses) && liveClasses.length > 0 ? liveClasses.slice(0, 8).map((lc: any) => {
          const isLive = !!lc.is_live;
          const isCompleted = !!lc.is_completed;
          const badgeColors: [string, string] = isLive ? ["#DC2626", "#EF4444"] : isCompleted ? ["#1A56DB", "#3B82F6"] : ["#6B7280", "#9CA3AF"];
          return (
            <Pressable key={lc.id} style={({ pressed }) => [styles.liveClassItem, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.85 }]} onPress={() => router.push(`/live-class/${lc.id}` as any)}>
              <LinearGradient colors={badgeColors} style={styles.liveStatusBadge}>
                {isLive ? (
                  <><View style={styles.liveDot} /><Text style={styles.liveStatusText}>LIVE</Text></>
                ) : isCompleted ? (
                  <Ionicons name="play" size={14} color="#fff" />
                ) : (
                  <Ionicons name="time" size={14} color="#fff" />
                )}
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={[styles.liveClassTitle, { color: colors.text }]} numberOfLines={1}>{lc.title}</Text>
                <Text style={[styles.liveClassTime, { color: colors.textSecondary }]}>
                  {lc.subject_key ? `${getSubjectMeta(lc.subject_key).label} · ` : ""}{isLive ? "Happening now" : new Date(Number(lc.scheduled_at || Date.now())).toLocaleString()}
                </Text>
              </View>
              <Ionicons name={isLive || isCompleted ? "play-circle" : "calendar"} size={22} color={isLive ? "#DC2626" : isCompleted ? Colors.light.primary : colors.textMuted} />
            </Pressable>
          );
        }) : (
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
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  headerTextCol: { flex: 1, gap: 4, paddingTop: 2 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 28 },
  subtitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.85)" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginBottom: 12 },
  grid: { gap: 10 },
  gridWeb: { flexDirection: "row", flexWrap: "wrap" },
  gridMobile: { flexDirection: "column" },
  subjectBoxWeb: {
    width: "19%",
    minWidth: 120,
    flexGrow: 1,
    minHeight: 118,
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
  subjectRowMobile: {
    width: "100%",
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  subjectIconBox: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  subjectIconBoxMobile: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  subjectTextColWeb: { alignItems: "center" },
  subjectTextColMobile: { flex: 1, minWidth: 0 },
  subjectBoxTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  subjectBoxTitleMobile: { textAlign: "left" },
  subjectBoxMeta: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 3, textAlign: "center" },
  subjectBoxMetaMobile: { textAlign: "left" },
  liveClassItem: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 10 },
  liveStatusBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveStatusText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", color: "#fff" },
  liveClassTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  liveClassTime: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  emptyCard: { borderWidth: 1, borderRadius: 14, padding: 18, alignItems: "center" },
});
