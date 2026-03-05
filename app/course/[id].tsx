import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert,
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
  isCompleted?: boolean;
}

interface CourseTest {
  id: number;
  title: string;
  duration_minutes: number;
  total_questions: number;
  test_type: string;
}

interface Material {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
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

const TABS = ["Lectures", "Tests", "Materials"];

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
      Alert.alert("Enroll in Course", `Enroll in "${course?.title}" for ₹${parseFloat(course?.price || "0").toFixed(0)}?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Enroll", onPress: () => enrollMutation.mutate() },
      ]);
    }
  };

  const handleLecture = (lecture: Lecture) => {
    if (!course?.isEnrolled && !lecture.is_free_preview) {
      Alert.alert("Enroll Required", "Please enroll in this course to access all lectures.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: `/lecture/${lecture.id}`, params: { courseId: id, videoUrl: lecture.video_url, title: lecture.title } });
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

  const discount = course.original_price && parseFloat(course.original_price) > 0
    ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100)
    : 0;

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50", "#1A56DB"]} style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <View style={styles.headerTop}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.headerBadges}>
            {course.is_free && <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>}
            {discount > 0 && <View style={styles.discountBadge}><Text style={styles.discountBadgeText}>{discount}% OFF</Text></View>}
          </View>
        </View>

        <View style={styles.courseIconArea}>
          <MaterialCommunityIcons name="math-compass" size={48} color="rgba(255,255,255,0.25)" />
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
          <View style={styles.quickStat}>
            <Ionicons name="videocam" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.quickStatText}>{course.total_lectures} Lectures</Text>
          </View>
          <View style={styles.quickStat}>
            <Ionicons name="document-text" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.quickStatText}>{course.total_tests} Tests</Text>
          </View>
          <View style={styles.quickStat}>
            <Ionicons name="people" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.quickStatText}>{course.total_students} Students</Text>
          </View>
          <View style={styles.quickStat}>
            <Ionicons name="time" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.quickStatText}>{course.duration_hours}h</Text>
          </View>
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

      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <Pressable key={tab} style={[styles.tabItem, activeTab === tab && styles.tabItemActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 100 }]}>
        {activeTab === "Lectures" && (
          <View style={styles.list}>
            {course.lectures.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="videocam-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No lectures added yet</Text>
              </View>
            ) : (
              course.lectures.map((lecture, idx) => (
                <Pressable
                  key={lecture.id}
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
              ))
            )}
          </View>
        )}

        {activeTab === "Tests" && (
          <View style={styles.list}>
            {course.tests.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No tests available</Text>
              </View>
            ) : (
              course.tests.map((test) => (
                <Pressable
                  key={test.id}
                  style={({ pressed }) => [styles.testItem, pressed && { opacity: 0.85 }]}
                  onPress={() => router.push(`/test/${test.id}`)}
                >
                  <View style={styles.testItemIcon}>
                    <Ionicons name="document-text" size={22} color={Colors.light.primary} />
                  </View>
                  <View style={styles.testItemInfo}>
                    <Text style={styles.testItemTitle}>{test.title}</Text>
                    <Text style={styles.testItemMeta}>{test.total_questions} questions · {test.duration_minutes}min</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                </Pressable>
              ))
            )}
          </View>
        )}

        {activeTab === "Materials" && (
          <View style={styles.list}>
            {course.materials.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No materials available</Text>
              </View>
            ) : (
              course.materials.map((mat) => (
                <Pressable key={mat.id} style={styles.materialItem}>
                  <View style={styles.materialIcon}>
                    <Ionicons name="document-text" size={22} color="#DC2626" />
                  </View>
                  <View style={styles.materialInfo}>
                    <Text style={styles.materialTitle}>{mat.title}</Text>
                    {mat.description && <Text style={styles.materialDesc} numberOfLines={1}>{mat.description}</Text>}
                  </View>
                  <Ionicons name="download-outline" size={20} color={Colors.light.primary} />
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
            <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.enrollBtnGradient}>
              {enrollMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.enrollBtnText}>{course.is_free ? "Enroll for Free" : "Enroll Now"}</Text>
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
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  tabItem: { flex: 1, paddingVertical: 14, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  tabTextActive: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, gap: 0 },
  list: { gap: 0 },
  lectureItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border,
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
  testItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  testItemIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  testItemInfo: { flex: 1 },
  testItemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 3 },
  testItemMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  materialItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  materialIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  materialInfo: { flex: 1 },
  materialTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  materialDesc: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  emptyState: { paddingVertical: 40, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 15, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
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
