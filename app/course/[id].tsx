import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, Linking,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { fetch } from "expo/fetch";
import { useAuth } from "@/context/AuthContext";

interface Lecture {
  id: number;
  title: string;
  description: string;
  video_url: string;
  video_type: string;
  duration_minutes: number;
  order_index: number;
  is_free_preview: boolean;
  section_title?: string;
  isCompleted?: boolean;
}

interface CourseTest {
  id: number;
  title: string;
  duration_minutes: number;
  total_questions: number;
  total_marks: number;
  test_type: string;
}

interface Material {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  section_title?: string;
}

interface LiveClass {
  id: number;
  title: string;
  description: string;
  youtube_url: string;
  is_live: boolean;
  is_completed: boolean;
  scheduled_at: number;
}

interface CourseDetail {
  id: number;
  title: string;
  description: string;
  teacher_name: string;
  price: string;
  original_price: string;
  category: string;
  is_free: boolean;
  course_type?: string;
  total_lectures: number;
  total_tests: number;
  total_students: number;
  level: string;
  duration_hours: string;
  isEnrolled: boolean;
  progress: number;
  lectures: Lecture[];
  tests: CourseTest[];
  materials: Material[];
}

const TEST_TYPE_COLORS: Record<string, string> = {
  mock: "#DC2626", practice: "#1A56DB", chapter: "#059669", weekly: "#7C3AED",
};

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("Lectures");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: course, isLoading } = useQuery<CourseDetail>({
    queryKey: ["/api/courses", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${id}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load course");
      return res.json();
    },
  });

  const { data: liveClasses = [] } = useQuery<LiveClass[]>({
    queryKey: ["/api/live-classes", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/live-classes?courseId=${id}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "Live",
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/courses/${id}/enroll`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Enrolled!", "You have successfully enrolled in this course.");
    },
    onError: () => {
      Alert.alert("Error", "Failed to enroll. Please try again.");
    },
  });

  const handleEnroll = () => {
    if (!user) { router.push("/(auth)/login"); return; }
    if (course?.is_free) {
      enrollMutation.mutate();
    } else {
      Alert.alert(
        "Purchase Course",
        `Buy "${course?.title}" for ₹${parseFloat(course?.price || "0").toFixed(0)}?\n\nAfter purchase you'll get instant access to all content.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Buy Now", onPress: () => enrollMutation.mutate() },
        ]
      );
    }
  };

  const handleLecture = (lecture: Lecture) => {
    if (!course?.isEnrolled && !lecture.is_free_preview) {
      Alert.alert(
        course?.is_free ? "Enroll Required" : "Purchase Required",
        course?.is_free ? "Please enroll for free to access this lecture." : "Please purchase this course to access all lectures.",
        [
          { text: "Cancel", style: "cancel" },
          { text: course?.is_free ? "Enroll Free" : "Buy Now", onPress: handleEnroll },
        ]
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: `/lecture/${lecture.id}`,
      params: { courseId: id, videoUrl: lecture.video_url, title: lecture.title },
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { paddingTop: topPadding }]}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (!course) {
    return (
      <View style={[styles.centered, { paddingTop: topPadding }]}>
        <Text style={styles.errorText}>Course not found</Text>
      </View>
    );
  }

  const isTestSeriesCourse = course.course_type === "test_series" || (course.total_lectures === 0 && course.total_tests > 0);
  const TABS = isTestSeriesCourse
    ? ["Tests", "Materials"]
    : ["Lectures", "Tests", "Materials", "Live"];

  const discount = course.original_price && parseFloat(course.original_price) > 0
    ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100)
    : 0;

  const firstTab = TABS[0];
  const currentActiveTab = TABS.includes(activeTab) ? activeTab : firstTab;

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50", "#1A56DB"]} style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <View style={styles.headerTop}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.headerBadges}>
            {course.is_free && <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>}
            {isTestSeriesCourse && <View style={styles.testSeriesBadge}><Text style={styles.testSeriesBadgeText}>TEST SERIES</Text></View>}
            {!course.is_free && discount > 0 && <View style={styles.discountBadge}><Text style={styles.discountBadgeText}>{discount}% OFF</Text></View>}
          </View>
        </View>

        <View style={styles.courseIconArea}>
          <MaterialCommunityIcons
            name={isTestSeriesCourse ? "clipboard-check" : "math-compass"}
            size={48} color="rgba(255,255,255,0.25)"
          />
        </View>

        <Text style={styles.courseCategory}>{course.category}</Text>
        <Text style={styles.courseTitle}>{course.title}</Text>

        <View style={styles.instructorRow}>
          <View style={styles.instructorAvatar}>
            <Ionicons name="person" size={14} color="#fff" />
          </View>
          <Text style={styles.instructorName}>{course.teacher_name}</Text>
          <View style={styles.levelChip}><Text style={styles.levelChipText}>{course.level}</Text></View>
        </View>

        <View style={styles.courseQuickStats}>
          {!isTestSeriesCourse && (
            <View style={styles.quickStat}>
              <Ionicons name="videocam" size={16} color="rgba(255,255,255,0.8)" />
              <Text style={styles.quickStatText}>{course.total_lectures} Lectures</Text>
            </View>
          )}
          <View style={styles.quickStat}>
            <Ionicons name="document-text" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.quickStatText}>{course.total_tests} Tests</Text>
          </View>
          <View style={styles.quickStat}>
            <Ionicons name="people" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.quickStatText}>{course.total_students} Students</Text>
          </View>
          {!isTestSeriesCourse && (
            <View style={styles.quickStat}>
              <Ionicons name="time" size={16} color="rgba(255,255,255,0.8)" />
              <Text style={styles.quickStatText}>{course.duration_hours}h</Text>
            </View>
          )}
        </View>

        {course.isEnrolled && (
          <View style={styles.progressSection}>
            <View style={styles.progressRow}>
              <Text style={styles.progressLabel}>Your Progress</Text>
              <Text style={styles.progressPct}>{course.progress}%</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${course.progress}%` }]} />
            </View>
          </View>
        )}
      </LinearGradient>

      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={styles.tabBarScroll}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tabItem, currentActiveTab === tab && styles.tabItemActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, currentActiveTab === tab && styles.tabTextActive]}>{tab}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 100 }]}
      >
        {currentActiveTab === "Lectures" && (
          <View style={styles.list}>
            {course.lectures.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="videocam-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No lectures added yet</Text>
              </View>
            ) : (
              course.lectures.map((lecture, idx) => (
                <React.Fragment key={lecture.id}>
                  {lecture.section_title && (
                    <View style={styles.sectionHeader}>
                      <Ionicons name="folder" size={14} color={Colors.light.primary} />
                      <Text style={styles.sectionHeaderText}>{lecture.section_title}</Text>
                    </View>
                  )}
                  <Pressable
                    style={({ pressed }) => [styles.lectureItem, pressed && { opacity: 0.85 }]}
                    onPress={() => handleLecture(lecture)}
                  >
                    <View style={[styles.lectureNumber, lecture.isCompleted && styles.lectureNumberDone]}>
                      {lecture.isCompleted ? (
                        <Ionicons name="checkmark" size={16} color="#fff" />
                      ) : (
                        <Text style={styles.lectureNumberText}>{idx + 1}</Text>
                      )}
                    </View>
                    <View style={styles.lectureInfo}>
                      <Text style={styles.lectureTitle}>{lecture.title}</Text>
                      <View style={styles.lectureMetaRow}>
                        <Ionicons name="time-outline" size={12} color={Colors.light.textMuted} />
                        <Text style={styles.lectureMeta}>{lecture.duration_minutes}min</Text>
                        {lecture.is_free_preview && (
                          <View style={styles.previewBadge}><Text style={styles.previewBadgeText}>Preview</Text></View>
                        )}
                      </View>
                    </View>
                    {!course.isEnrolled && !lecture.is_free_preview ? (
                      <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} />
                    ) : (
                      <Ionicons name="play-circle" size={22} color={Colors.light.primary} />
                    )}
                  </Pressable>
                </React.Fragment>
              ))
            )}
          </View>
        )}

        {currentActiveTab === "Tests" && (
          <View style={styles.list}>
            {course.tests.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No tests available</Text>
              </View>
            ) : (
              course.tests.map((test) => {
                const color = TEST_TYPE_COLORS[test.test_type] || Colors.light.primary;
                return (
                  <Pressable
                    key={test.id}
                    style={({ pressed }) => [styles.testCard, pressed && { opacity: 0.85 }]}
                    onPress={() => {
                      if (!course.isEnrolled && !course.is_free) {
                        Alert.alert("Purchase Required", "Please purchase this course to access tests.");
                        return;
                      }
                      router.push(`/test/${test.id}`);
                    }}
                  >
                    <View style={[styles.testColorBar, { backgroundColor: color }]} />
                    <View style={styles.testItemIcon}>
                      <Ionicons name="document-text" size={22} color={color} />
                    </View>
                    <View style={styles.testItemInfo}>
                      <Text style={styles.testItemTitle}>{test.title}</Text>
                      <Text style={styles.testItemMeta}>
                        {test.total_questions} questions · {test.duration_minutes}min · {test.total_marks} marks
                      </Text>
                    </View>
                    {!course.isEnrolled && !course.is_free ? (
                      <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                    )}
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        {currentActiveTab === "Materials" && (
          <View style={styles.list}>
            {course.materials.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No materials available</Text>
              </View>
            ) : (
              course.materials.map((mat) => {
                const canAccess = mat.is_free || isEnrolled;
                return (
                <React.Fragment key={mat.id}>
                  {mat.section_title && (
                    <View style={styles.sectionHeader}>
                      <Ionicons name="folder" size={14} color="#DC2626" />
                      <Text style={styles.sectionHeaderText}>{mat.section_title}</Text>
                    </View>
                  )}
                  <Pressable
                    style={({ pressed }) => [styles.materialItem, pressed && { opacity: 0.85 }, !canAccess && { opacity: 0.5 }]}
                    onPress={() => {
                      if (!canAccess) { Alert.alert("Locked", "Enroll in this course to access materials."); return; }
                      if (!mat.file_url) return;
                      if (mat.download_allowed) {
                        Linking.openURL(mat.file_url);
                      } else {
                        const viewUrl = mat.file_type === "pdf"
                          ? `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(mat.file_url)}`
                          : mat.file_url;
                        Linking.openURL(viewUrl);
                      }
                    }}
                  >
                    <View style={styles.materialIcon}>
                      <Ionicons
                        name={!canAccess ? "lock-closed" : mat.file_type === "video" ? "videocam" : mat.file_type === "link" ? "link" : "document-text"}
                        size={22} color={!canAccess ? Colors.light.textMuted : "#DC2626"}
                      />
                    </View>
                    <View style={styles.materialInfo}>
                      <Text style={styles.materialTitle}>{mat.title}</Text>
                      {mat.description && <Text style={styles.materialDesc} numberOfLines={1}>{mat.description}</Text>}
                      <Text style={styles.materialType}>{(mat.file_type || "pdf").toUpperCase()}{mat.download_allowed ? "" : " · View Only"}</Text>
                    </View>
                    <Ionicons name={mat.download_allowed ? "download-outline" : "eye-outline"} size={20} color={Colors.light.primary} />
                  </Pressable>
                </React.Fragment>
                );
              })
            )}
          </View>
        )}

        {currentActiveTab === "Live" && (
          <View style={styles.list}>
            {liveClasses.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="videocam-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No live classes scheduled</Text>
                <Text style={styles.emptySubText}>Check back soon for upcoming live sessions</Text>
              </View>
            ) : (
              liveClasses.map((lc) => (
                <Pressable
                  key={lc.id}
                  style={({ pressed }) => [styles.liveClassItem, pressed && { opacity: 0.85 }]}
                  onPress={() => router.push({
                    pathname: `/lecture/${lc.id}`,
                    params: { videoUrl: lc.youtube_url, title: lc.title },
                  })}
                >
                  <LinearGradient
                    colors={lc.is_live ? ["#DC2626", "#EF4444"] : ["#6B7280", "#9CA3AF"]}
                    style={styles.liveStatusBadge}
                  >
                    {lc.is_live ? (
                      <>
                        <View style={styles.liveDot} />
                        <Text style={styles.liveStatusText}>LIVE</Text>
                      </>
                    ) : (
                      <Ionicons name="time" size={14} color="#fff" />
                    )}
                  </LinearGradient>
                  <View style={styles.liveClassInfo}>
                    <Text style={styles.liveClassTitle}>{lc.title}</Text>
                    {lc.description ? <Text style={styles.liveClassDesc} numberOfLines={2}>{lc.description}</Text> : null}
                    <Text style={styles.liveClassTime}>
                      {lc.is_live ? "Happening now" : new Date(lc.scheduled_at).toLocaleString()}
                    </Text>
                  </View>
                  <Ionicons name={lc.is_live ? "play-circle" : "calendar"} size={24} color={lc.is_live ? "#DC2626" : Colors.light.textMuted} />
                </Pressable>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {!course.isEnrolled && (
        <View style={[styles.enrollBar, { paddingBottom: bottomPadding + 12 }]}>
          <View style={styles.priceSection}>
            {course.is_free ? (
              <Text style={styles.priceText}>Free</Text>
            ) : (
              <>
                <Text style={styles.priceText}>₹{parseFloat(course.price).toFixed(0)}</Text>
                {parseFloat(course.original_price) > 0 && (
                  <Text style={styles.originalPrice}>₹{parseFloat(course.original_price).toFixed(0)}</Text>
                )}
              </>
            )}
          </View>
          <Pressable
            style={({ pressed }) => [styles.enrollBtn, pressed && { opacity: 0.9 }]}
            onPress={handleEnroll}
            disabled={enrollMutation.isPending}
          >
            <LinearGradient
              colors={course.is_free ? ["#22C55E", "#16A34A"] : [Colors.light.accent, "#E55A25"]}
              style={styles.enrollBtnGradient}
            >
              {enrollMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.enrollBtnText}>
                  {course.is_free ? "Enroll for Free" : "Buy Now"}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 16, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  header: { paddingHorizontal: 20, paddingBottom: 20, gap: 8 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerBadges: { flexDirection: "row", gap: 8 },
  freeBadge: { backgroundColor: "#22C55E", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  freeBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  testSeriesBadge: { backgroundColor: "#7C3AED", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  testSeriesBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  discountBadge: { backgroundColor: Colors.light.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  discountBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  courseIconArea: { position: "absolute", right: 20, top: 60, opacity: 0.4 },
  courseCategory: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  courseTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 30, maxWidth: "85%" },
  instructorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  instructorAvatar: { width: 24, height: 24, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  instructorName: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_500Medium" },
  levelChip: { backgroundColor: Colors.light.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  levelChipText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  courseQuickStats: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  quickStat: { flexDirection: "row", alignItems: "center", gap: 5 },
  quickStatText: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
  progressSection: { gap: 6 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" },
  progressPct: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#22C55E" },
  progressBar: { height: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: "#22C55E", borderRadius: 3 },
  tabBarScroll: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border, maxHeight: 52 },
  tabBarContent: { paddingHorizontal: 4 },
  tabItem: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  tabTextActive: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  scrollView: { flex: 1 },
  scrollContent: { gap: 0 },
  list: { gap: 0 },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F0F4FF", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  sectionHeaderText: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  lectureItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  lectureNumber: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center",
  },
  lectureNumberDone: { backgroundColor: "#22C55E" },
  lectureNumberText: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  lectureInfo: { flex: 1 },
  lectureTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 3 },
  lectureMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  lectureMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  previewBadge: { backgroundColor: "#DCFCE7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 },
  previewBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#15803D" },
  testCard: { flexDirection: "row", alignItems: "center", gap: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  testColorBar: { width: 4, alignSelf: "stretch" },
  testItemIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center", margin: 12 },
  testItemInfo: { flex: 1, paddingVertical: 14, paddingRight: 12 },
  testItemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 3 },
  testItemMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  materialItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  materialIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  materialInfo: { flex: 1 },
  materialTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  materialDesc: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 2 },
  materialType: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#DC2626", backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, alignSelf: "flex-start" },
  liveClassItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  liveStatusBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveStatusText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  liveClassInfo: { flex: 1 },
  liveClassTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  liveClassDesc: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", marginBottom: 2 },
  liveClassTime: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  emptyState: { paddingVertical: 40, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 15, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  emptySubText: { fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 20 },
  enrollBar: {
    backgroundColor: "#fff", paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.light.border,
    flexDirection: "row", alignItems: "center", gap: 16,
  },
  priceSection: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  priceText: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  originalPrice: { fontSize: 14, color: Colors.light.textMuted, textDecorationLine: "line-through", fontFamily: "Inter_400Regular" },
  enrollBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  enrollBtnGradient: { paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  enrollBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
