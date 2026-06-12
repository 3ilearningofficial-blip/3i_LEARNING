import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SUBJECT_LABELS: Record<string, string> = { maths: "Maths", english: "English", science: "Science", gk: "G.K" };
const SECTIONS = ["Live", "Lecture", "Study Material", "Test", "PYQs", "Mock"] as const;

async function fetchCourse(id: string) {
  const res = await authFetch(new URL(`/api/courses/${id}`, getApiUrl()).toString());
  if (!res.ok) return null;
  return res.json();
}

export default function MultiCourseSubjectScreen() {
  const { id, subject } = useLocalSearchParams<{ id: string; subject: string }>();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Lecture");
  const subjectKey = String(subject || "").toLowerCase();
  const { data: course, isLoading } = useQuery({
    queryKey: ["/api/courses", String(id)],
    queryFn: () => fetchCourse(String(id)),
    enabled: !!id,
    staleTime: 0,
  });
  const { data: courseFolders = [] } = useQuery<any[]>({
    queryKey: ["/api/courses", String(id), "folders", subjectKey],
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/courses/${id}/folders`, getApiUrl()).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id,
    staleTime: 30_000,
  });
  const { data: liveClasses = [] } = useQuery<any[]>({
    queryKey: ["/api/live-classes", id, subjectKey],
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/live-classes?courseId=${id}`, getApiUrl()).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id,
    staleTime: 30_000,
  });

  const subjectContent = useMemo(() => {
    const matches = (row: any) => String(row?.subject_key || "").toLowerCase() === subjectKey;
    const lectures = Array.isArray(course?.lectures) ? course.lectures.filter(matches) : [];
    const materials = Array.isArray(course?.materials) ? course.materials.filter(matches) : [];
    const tests = Array.isArray(course?.tests) ? course.tests.filter(matches) : [];
    return {
      lectures,
      materials,
      tests: tests.filter((t: any) => !["pyq", "mock"].includes(String(t.test_type || "").toLowerCase())),
      pyqs: tests.filter((t: any) => String(t.test_type || "").toLowerCase() === "pyq"),
      mocks: tests.filter((t: any) => String(t.test_type || "").toLowerCase() === "mock"),
    };
  }, [course, subjectKey]);

  const locked = !course?.isEnrolled;
  const requireAccess = () => {
    if (!locked) return true;
    Alert.alert(course?.is_free ? "Enroll Required" : "Purchase Required", "Please enroll or buy this course to access this content.", [
      { text: "Cancel", style: "cancel" },
      { text: course?.is_free ? "Enroll Free" : "Buy Now", onPress: () => router.push(`/course/${id}` as any) },
    ]);
    return false;
  };

  const routeType = section === "Lecture" ? "lectures" : section === "Study Material" ? "materials" : "tests";
  const folderType = section === "Lecture" ? "lecture" : section === "Study Material" ? "material" : "test";
  const routeTestType = section === "PYQs" ? "pyq" : section === "Mock" ? "mock" : section === "Test" ? "regular" : "";
  const folderFullName = (folder: any) => String(folder?.full_name || folder?.name || "").trim();
  const rootFolders = (courseFolders || [])
    .filter((folder: any) => folder.type === folderType)
    .filter((folder: any) => String(folder.subject_key || "").toLowerCase() === subjectKey)
    .filter((folder: any) => !folder.parent_id);

  const allRows =
    section === "Live" ? liveClasses.filter((lc: any) => String(lc.subject_key || "").toLowerCase() === subjectKey) :
    section === "Lecture" ? subjectContent.lectures :
    section === "Study Material" ? subjectContent.materials :
    section === "PYQs" ? subjectContent.pyqs :
    section === "Mock" ? subjectContent.mocks :
    subjectContent.tests;
  const rows = allRows.filter((item: any) => {
    if (section === "Lecture" || section === "Study Material") return !item.section_title;
    return !item.folder_name;
  });

  const folderItemCount = (folder: any) => {
    const name = folderFullName(folder);
    if (section === "Lecture") {
      return subjectContent.lectures.filter((item: any) => {
        const sec = String(item.section_title || "");
        return sec === name || sec.startsWith(`${name} /`);
      }).length;
    }
    if (section === "Study Material") {
      return subjectContent.materials.filter((item: any) => {
        const sec = String(item.section_title || "");
        return sec === name || sec.startsWith(`${name} /`);
      }).length;
    }
    return allRows.filter((item: any) => {
      const sec = String(item.folder_name || "");
      return sec === name || sec.startsWith(`${name} /`);
    }).length;
  };

  const renderFolder = (folder: any) => {
    const name = folderFullName(folder);
    const count = folderItemCount(folder);
    return (
      <Pressable
        key={`folder-${folder.id || name}`}
        style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push({ pathname: "/course-folder/[id]/[type]/[name]", params: { id: String(id), type: routeType, name: encodeURIComponent(name), subjectKey, testType: routeTestType } } as any)}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="folder" size={22} color={Colors.light.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>{folder.name || name}</Text>
          <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{count} items</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>
    );
  };
  const visibleRootFolders = rootFolders.filter((folder: any) => folderItemCount(folder) > 0);

  const renderRow = (item: any) => {
    if (section === "Live") {
      const isLive = !!item.is_live;
      const time = item.scheduled_at ? new Date(Number(item.scheduled_at)).toLocaleString() : "Not scheduled";
      return (
        <Pressable
          key={`live-${item.id}`}
          style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }, locked && { opacity: 0.65 }]}
          onPress={() => {
            if (!requireAccess()) return;
            router.push(`/live-class/${item.id}` as any);
          }}
        >
          <View style={[styles.rowIcon, { backgroundColor: isLive ? "#FEE2E2" : "#EEF2FF" }]}>
            <Ionicons name={isLive ? "radio" : "calendar"} size={22} color={isLive ? "#DC2626" : Colors.light.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
            <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{isLive ? "Live now" : time}</Text>
          </View>
          <Ionicons name={locked ? "lock-closed" : "chevron-forward"} size={18} color={colors.textMuted} />
        </Pressable>
      );
    }
    const isLecture = section === "Lecture";
    const isMaterial = section === "Study Material";
    return (
      <Pressable
        key={`${section}-${item.id}`}
        style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }, locked && { opacity: 0.65 }]}
        onPress={() => {
          if (!requireAccess()) return;
          if (isLecture) router.push({ pathname: "/lecture/[id]", params: { id: String(item.id), courseId: String(id), videoUrl: item.video_url || "", title: item.title } } as any);
          else if (isMaterial) router.push(`/material/${item.id}` as any);
          else router.push(`/test/${item.id}` as any);
        }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name={isLecture ? "play-circle" : isMaterial ? "document-text" : "clipboard"} size={22} color={Colors.light.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
          <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
            {isLecture ? `${item.duration_minutes || 0} min` : isMaterial ? String(item.file_type || "PDF").toUpperCase() : `${item.total_questions || 0} questions`}
          </Text>
        </View>
        <Ionicons name={locked ? "lock-closed" : "chevron-forward"} size={18} color={colors.textMuted} />
      </Pressable>
    );
  };

  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={Colors.light.primary} /></View>;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable style={[styles.backBtn, { backgroundColor: colors.surfaceAlt }]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>{SUBJECT_LABELS[subjectKey] || subjectKey}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>{course?.title || "Course"}</Text>
        </View>
      </View>

      <View style={[styles.sectionSelector, { borderBottomColor: colors.border }]}>
        {SECTIONS.map((name) => (
          <Pressable key={name} style={[styles.tab, section === name && styles.tabActive]} onPress={() => setSection(name)}>
            <Text style={[styles.tabText, section === name && styles.tabTextActive]}>{name}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{section}</Text>
        {section !== "Live" ? visibleRootFolders.map(renderFolder) : null}
        {rows.length > 0 ? rows.map(renderRow) : visibleRootFolders.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="folder-open-outline" size={32} color={colors.textMuted} />
            <Text style={{ color: colors.textSecondary, fontFamily: "Inter_600SemiBold", marginTop: 8 }}>No content added yet.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  sectionSelector: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  tab: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: "#EEF2FF", minWidth: 74, alignItems: "center" },
  tabActive: { backgroundColor: Colors.light.primary },
  tabText: { color: Colors.light.primary, fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  tabTextActive: { color: "#fff" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold", marginBottom: 12 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 10 },
  rowIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 3 },
  emptyCard: { borderWidth: 1, borderRadius: 18, padding: 24, alignItems: "center" },
});
