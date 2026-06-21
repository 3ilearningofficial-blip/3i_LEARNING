import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl, apiRequest } from "@/lib/query-client";
import { myAttemptsSummaryQueryKey } from "@/lib/query-keys";
import { DownloadButton } from "@/components/DownloadButton";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCoursePurchase } from "@/lib/use-course-purchase";
import { SUBJECT_LABELS, getSubjectMeta } from "@/constants/multiSubjects";
// Live -> Lectures -> Tests -> PYQs -> Mock -> Missions -> Materials.
const SECTIONS = ["Live", "Lecture", "Test", "PYQs", "Mock", "Missions", "Study Material"] as const;

// Per-section accent colors mirror the normal course screen (lectures blue, materials red,
// tests green, pyq amber, mock red, live red).
const SECTION_COLORS: Record<(typeof SECTIONS)[number], string> = {
  Live: "#DC2626",
  Lecture: "#1A56DB",
  "Study Material": "#DC2626",
  Test: "#059669",
  PYQs: "#F59E0B",
  Mock: "#DC2626",
  Missions: "#0F766E",
};

const EMPTY_SECTION_COPY: Record<
  (typeof SECTIONS)[number],
  { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }
> = {
  Live: {
    icon: "videocam-outline",
    title: "No upcoming or live sessions",
    subtitle: "Recordings from ended classes are under Lectures → Live Class Recordings",
  },
  Lecture: { icon: "videocam-outline", title: "No lectures added yet" },
  Test: { icon: "document-text-outline", title: "No tests added yet" },
  PYQs: { icon: "school-outline", title: "No PYQs added yet" },
  Mock: { icon: "clipboard-outline", title: "No mock tests added yet" },
  Missions: { icon: "flag-outline", title: "No daily missions for this course yet" },
  "Study Material": { icon: "folder-outline", title: "No study material added yet" },
};

async function fetchCourse(id: string) {
  const res = await authFetch(new URL(`/api/courses/${id}`, getApiUrl()).toString());
  if (!res.ok) return null;
  return res.json();
}

export default function MultiCourseSubjectScreen() {
  const { id, subject } = useLocalSearchParams<{ id: string; subject: string }>();
  const { colors } = useAppTheme();
  const { user, isAdmin } = useAuth();
  const insets = useSafeAreaInsets();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Lecture");
  const subjectKey = String(subject || "").toLowerCase();
  const sectionColor = SECTION_COLORS[section];
  const { data: course, isLoading, refetch } = useQuery({
    queryKey: ["/api/courses", String(id), String(user?.id ?? "guest")],
    queryFn: () => fetchCourse(String(id)),
    enabled: !!id,
    staleTime: 0,
  });
  const courseIdNum = Number(id);
  const isFreeCourse = !!(course && (course.is_free || parseFloat(String(course.price || "0")) <= 0));
  const { purchase, paymentModal } = useCoursePurchase({
    courseId: courseIdNum,
    courseTitle: course?.title,
    isFree: isFreeCourse,
    price: course?.price,
  });

  useEffect(() => {
    if (!user?.id || !Number.isFinite(courseIdNum) || courseIdNum <= 0) return;
    apiRequest("POST", "/api/payments/sync-enrollment", { courseId: courseIdNum })
      .then(() => refetch())
      .catch(() => {});
  }, [user?.id, courseIdNum, refetch]);

  useFocusEffect(
    React.useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const { data: courseMissions = [] } = useQuery<any[]>({
    queryKey: ["/api/daily-missions", "course", String(id)],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/daily-missions?type=all", getApiUrl()).toString());
      if (!res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.filter((m: any) => Number(m.course_id) === courseIdNum);
    },
    enabled: !!id && !!user?.id,
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
  const { data: attemptSummary = {} } = useQuery<Record<number, any>>({
    queryKey: user?.id ? myAttemptsSummaryQueryKey(user.id) : ["/api/my-attempts/summary", "guest"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/my-attempts/summary", getApiUrl()).toString());
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const liveRowsForTab = useMemo(() => {
    return (liveClasses || []).filter((lc: any) => {
      if (String(lc.subject_key || "").toLowerCase() !== subjectKey) return false;
      if (lc.is_live) return true;
      if (lc.is_completed) return false;
      return true;
    });
  }, [liveClasses, subjectKey]);

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

  const locked = !isAdmin && !course?.isEnrolled;
  const requireAccess = () => {
    if (!locked) return true;
    Alert.alert(
      course?.is_free ? "Enroll Required" : "Purchase Required",
      course?.is_free
        ? "Please enroll in this course to access this content."
        : "Please purchase this course to access this content.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: course?.is_free ? "Enroll Free" : "Buy Now",
          onPress: () => {
            if (course?.is_free) purchase();
            else router.push(`/course-about/${id}` as any);
          },
        },
      ],
    );
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
    section === "Live" ? liveRowsForTab :
    section === "Lecture" ? subjectContent.lectures :
    section === "Study Material" ? subjectContent.materials :
    section === "Missions" ? courseMissions :
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
  const visibleRootFolders = rootFolders.filter((folder: any) => folderItemCount(folder) > 0);

  const noun = section === "Lecture" ? "videos" : section === "Study Material" ? "files" : section === "Live" ? "classes" : section === "Missions" ? "missions" : "tests";

  const renderFolder = (folder: any) => {
    const name = folderFullName(folder);
    const count = folderItemCount(folder);
    return (
      <Pressable
        key={`folder-${folder.id || name}`}
        style={[styles.sectionCard, { backgroundColor: colors.card, shadowColor: colors.shadow, borderLeftColor: sectionColor }]}
        onPress={() => {
          if (!requireAccess()) return;
          router.push({ pathname: "/course-folder/[id]/[type]/[name]", params: { id: String(id), type: routeType, name: encodeURIComponent(name), subjectKey, testType: routeTestType } } as any);
        }}
      >
        <View style={[styles.sectionIconWrap, { backgroundColor: sectionColor + "18" }]}>
          <Ionicons name="folder" size={22} color={sectionColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionCardTitle, { color: colors.text }]} numberOfLines={2}>{folder.name || name}</Text>
          <Text style={[styles.sectionCardCount, { color: colors.textMuted }]}>{count} {count === 1 ? noun.replace(/s$/, "") : noun}</Text>
        </View>
        <Ionicons name={locked ? "lock-closed" : "chevron-forward"} size={20} color={colors.textMuted} />
      </Pressable>
    );
  };

  const renderLiveRow = (item: any) => {
    const isLive = !!item.is_live;
    const isCompleted = !!item.is_completed;
    const badgeColors: [string, string] = isLive ? ["#DC2626", "#EF4444"] : isCompleted ? ["#1A56DB", "#3B82F6"] : ["#6B7280", "#9CA3AF"];
    const time = item.scheduled_at
      ? `${new Date(Number(item.scheduled_at)).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} · ${new Date(Number(item.scheduled_at)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
      : "Not scheduled";
    return (
      <Pressable
        key={`live-${item.id}`}
        style={({ pressed }) => [styles.liveClassItem, { backgroundColor: colors.card, borderBottomColor: colors.border }, pressed && { opacity: 0.85 }]}
        onPress={() => { if (!requireAccess()) return; router.push(`/live-class/${item.id}` as any); }}
      >
        <LinearGradient colors={badgeColors} style={styles.liveStatusBadge}>
          {isLive ? (
            <><View style={styles.liveDot} /><Text style={styles.liveStatusText}>LIVE</Text></>
          ) : isCompleted ? (
            <Ionicons name="play" size={14} color="#fff" />
          ) : (
            <Ionicons name="time" size={14} color="#fff" />
          )}
        </LinearGradient>
        <View style={styles.liveClassInfo}>
          <Text style={[styles.liveClassTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
          <Text style={[styles.liveClassTime, { color: colors.textMuted }]}>{isLive ? "Happening now" : time}</Text>
        </View>
        <Ionicons name={locked ? "lock-closed" : isLive || isCompleted ? "play-circle" : "calendar"} size={22} color={isLive ? "#DC2626" : isCompleted ? Colors.light.primary : colors.textMuted} />
      </Pressable>
    );
  };

  const renderRow = (item: any) => {
    if (section === "Live") return renderLiveRow(item);
    if (section === "Missions") {
      return (
        <View key={`mission-${item.id}`} style={[styles.itemCard, { backgroundColor: colors.card, borderBottomColor: colors.border }, locked && { opacity: 0.6 }]}>
          <Pressable
            style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
            onPress={() => {
              if (!requireAccess()) return;
              router.push(`/(tabs)/daily-mission` as any);
            }}
          >
            <View style={[styles.itemColorBar, { backgroundColor: sectionColor }]} />
            <View style={[styles.itemIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="flag" size={22} color={sectionColor} />
            </View>
            <View style={styles.itemInfo}>
              <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
              <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                {Array.isArray(item.questions) ? item.questions.length : 0} questions · {item.xp_reward || 50} XP
              </Text>
            </View>
            {locked ? <Ionicons name="lock-closed" size={18} color={colors.textMuted} /> : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
          </Pressable>
        </View>
      );
    }
    const isLecture = section === "Lecture";
    const isMaterial = section === "Study Material";
    const attempt = !isLecture && !isMaterial ? attemptSummary[item.id] : null;
    const meta = isLecture
      ? `${item.duration_minutes || 0} min${item.is_free_preview ? " · Free Preview" : ""}`
      : isMaterial
        ? String(item.file_type || "PDF").toUpperCase()
        : `${item.total_questions || 0} questions · ${item.duration_minutes || 0}min · ${item.total_marks || 0} marks`;
    return (
      <View key={`${section}-${item.id}`} style={[styles.itemCard, { backgroundColor: colors.card, borderBottomColor: colors.border }, locked && { opacity: 0.6 }]}>
        <Pressable
          style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
          onPress={() => {
            if (!requireAccess()) return;
            if (isLecture) router.push({ pathname: "/lecture/[id]", params: { id: String(item.id), courseId: String(id), videoUrl: item.video_url || "", title: item.title } } as any);
            else if (isMaterial) router.push(`/material/${item.id}` as any);
            else router.push(`/test/${item.id}` as any);
          }}
        >
          <View style={[styles.itemColorBar, { backgroundColor: sectionColor }]} />
          <View style={[styles.itemIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name={isLecture ? "videocam" : isMaterial ? "document-text" : "document-text"} size={22} color={sectionColor} />
          </View>
          <View style={styles.itemInfo}>
            <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={[styles.itemMeta, { color: colors.textMuted }]}>{meta}</Text>
              {attempt ? (
                <View style={styles.attemptBadge}>
                  <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                  <Text style={styles.attemptBadgeText}>{attempt.score}/{attempt.total_marks}</Text>
                </View>
              ) : null}
            </View>
          </View>
          {locked ? <Ionicons name="lock-closed" size={18} color={colors.textMuted} /> : attempt ? <Ionicons name="bar-chart" size={18} color={Colors.light.primary} /> : !isMaterial ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
        </Pressable>
        {isMaterial ? (
          <DownloadButton
            itemType="material"
            itemId={item.id}
            downloadAllowed={item.download_allowed || false}
            isEnrolled={!!course?.isEnrolled}
            title={item.title || "Material"}
            fileType={item.file_type || "pdf"}
          />
        ) : null}
      </View>
    );
  };

  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={Colors.light.primary} /></View>;

  const emptyCopy = EMPTY_SECTION_COPY[section];
  const showEmptyState = rows.length === 0 && (section === "Live" || visibleRootFolders.length === 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={styles.headerTextCol}>
          <Text style={styles.title} numberOfLines={2}>{course?.title || "Course"}</Text>
          <Text style={styles.subtitle}>{SUBJECT_LABELS[subjectKey] || getSubjectMeta(subjectKey).label}</Text>
        </View>
      </LinearGradient>

      {/* Section tab bar — same style as normal course screen */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={[styles.tabBarScroll, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
        contentContainerStyle={styles.tabBarContent}
      >
        {SECTIONS.map((name) => (
          <Pressable key={name} style={[styles.tabItem, section === name && styles.tabItemActive]} onPress={() => setSection(name)}>
            <Text style={[styles.tabText, { color: colors.textSecondary }, section === name && styles.tabTextActive]}>{name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}>
        {section !== "Live" && section !== "Missions" ? visibleRootFolders.map(renderFolder) : null}
        {rows.length > 0 ? rows.map(renderRow) : showEmptyState ? (
          <View style={styles.emptyState}>
            <Ionicons name={emptyCopy.icon} size={40} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>{emptyCopy.title}</Text>
            {emptyCopy.subtitle ? (
              <Text style={[styles.emptySubText, { color: colors.textMuted }]}>{emptyCopy.subtitle}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {paymentModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "column", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  headerTextCol: { width: "100%", gap: 4 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 28 },
  subtitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.85)" },

  // Tab bar (matches app/course/[id].tsx)
  tabBarScroll: { borderBottomWidth: 1, maxHeight: 52, flexGrow: 0 },
  tabBarContent: { paddingHorizontal: 4 },
  tabItem: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  tabTextActive: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },

  scrollView: { flex: 1 },

  // Folder card (matches testSectionCard)
  sectionCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, padding: 16, borderLeftWidth: 4,
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  sectionIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionCardTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sectionCardCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Item row (matches testCard)
  itemCard: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderRadius: 12, overflow: "hidden" },
  itemColorBar: { width: 4, alignSelf: "stretch" },
  itemIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", margin: 12 },
  itemInfo: { flex: 1, paddingVertical: 14, paddingRight: 12 },
  itemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  itemMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  attemptBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  attemptBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" },

  // Live row (matches liveClassItem)
  liveClassItem: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1 },
  liveStatusBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveStatusText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  liveClassInfo: { flex: 1 },
  liveClassTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  liveClassTime: { fontSize: 12, fontFamily: "Inter_400Regular" },

  emptyState: { paddingVertical: 48, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },
  emptySubText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 20, lineHeight: 18 },
});
