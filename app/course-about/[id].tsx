import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useCoursePurchase } from "@/lib/use-course-purchase";
import { getCourseAccentColor } from "@shared/courseTheme";

type Course = {
  id: number;
  title: string;
  description?: string;
  teacher_name?: string;
  teacher_bio?: string;
  teacher_image_url?: string;
  thumbnail?: string;
  cover_color?: string;
  category?: string;
  subject?: string;
  price?: string;
  original_price?: string;
  is_free?: boolean;
  isEnrolled?: boolean;
  progress?: number;
  lectures?: any[];
  tests?: any[];
  materials?: any[];
  teacher_details_json?: any;
  course_language?: string;
  course_type?: string;
  level?: string;
  start_date?: string;
  end_date?: string;
  validity_months?: number | string | null;
  duration_hours?: string | number;
  total_lectures?: number;
  total_tests?: number;
  total_materials?: number;
  practice_count?: number;
  pyq_count?: number;
  mock_count?: number;
  daily_mission_count?: number;
};

type AboutTeacher = { name: string; imageUrl: string; bio: string };

function courseAccentColor(course: Course): string {
  if (course.course_type === "multi_subject") {
    return course.cover_color || "#B91C1C";
  }
  return getCourseAccentColor(course.id);
}

function parseAboutMeta(value: any): { features: string[]; teachers: AboutTeacher[] } {
  const raw = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return value; } })() : value;
  const normalizeTeacher = (t: any): AboutTeacher => ({
    name: String(t?.name || "").trim(),
    imageUrl: String(t?.imageUrl || t?.image_url || "").trim(),
    bio: String(t?.bio || t?.description || "").trim(),
  });
  if (Array.isArray(raw)) {
    const teachers = raw.map(normalizeTeacher).filter((t) => t.name || t.imageUrl || t.bio);
    return { features: [], teachers };
  }
  if (raw && typeof raw === "object") {
    const features = Array.isArray(raw.features) ? raw.features.map((f: any) => String(f || "").trim()).filter(Boolean) : [];
    const teachers = Array.isArray(raw.teachers) ? raw.teachers.map(normalizeTeacher).filter((t: AboutTeacher) => t.name || t.imageUrl || t.bio) : [];
    return { features, teachers };
  }
  return { features: [], teachers: [] };
}

async function fetchCourse(id: string, userId?: number): Promise<Course | null> {
  const url = new URL(`/api/courses/${id}`, getApiUrl());
  if (userId) url.searchParams.set("_uid", String(userId));
  const res = await authFetch(url.toString());
  if (!res.ok) return null;
  return res.json();
}

function readableValue(value?: string | number | null): string {
  if (value == null || value === "") return "";
  return String(value);
}

export default function CourseAboutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { data: course, isLoading } = useQuery({
    queryKey: ["/api/courses", String(id), String(user?.id ?? "guest")],
    queryFn: () => fetchCourse(String(id), user?.id),
    enabled: !!id,
    staleTime: 0,
  });
  const isFreeCourse = !!(course && (course.is_free || parseFloat(String(course.price || "0")) <= 0));
  const { purchase, isPending, paymentModal } = useCoursePurchase({
    courseId: Number(id),
    courseTitle: course?.title,
    isFree: isFreeCourse,
    price: course?.price,
  });

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={Colors.light.primary} /></View>;
  }
  if (!course) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={{ color: colors.text }}>Course not found</Text></View>;
  }

  const isMultiSubject = course.course_type === "multi_subject";
  const accent = courseAccentColor(course);
  const discount = course.original_price && parseFloat(course.original_price) > 0 && parseFloat(course.price || "0") > 0
    ? Math.round((1 - parseFloat(course.price!) / parseFloat(course.original_price)) * 100)
    : 0;
  const progress = Math.max(0, Math.min(100, Number(course.progress || 0)));
  const lecturesCount = Array.isArray(course.lectures) ? course.lectures.length : Number(course.total_lectures || 0);
  const materialsCount = Array.isArray(course.materials) ? course.materials.length : Number(course.total_materials || 0);
  const tests = Array.isArray(course.tests) ? course.tests : [];
  const pyqCount = tests.filter((t) => String(t.test_type || "").toLowerCase() === "pyq").length;
  const mockListCount = tests.filter((t) => String(t.test_type || "").toLowerCase() === "mock").length;
  const mockCount = isMultiSubject
    ? mockListCount
    : Math.max(mockListCount, Number(course.mock_count) || 0);
  const missionCount = Number(course.daily_mission_count) || 0;
  const regularTestCountFromList = tests.filter((t) => !["pyq", "mock"].includes(String(t.test_type || "").toLowerCase())).length;
  const testCount = isMultiSubject
    ? regularTestCountFromList
    : Math.max(
        regularTestCountFromList,
        Number(course.practice_count) || 0,
        Math.max(0, (Number(course.total_tests) || 0) - mockCount - pyqCount),
      );
  const aboutMeta = parseAboutMeta(course.teacher_details_json);
  const teachers = aboutMeta.teachers;
  const instructorName = teachers[0]?.name || course.teacher_name || "";
  const teacherCardWidth = width >= 900 ? "19%" : width >= 600 ? "31.5%" : "48%";
  const descriptionLines = String(course.description || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const aboutLines = [...descriptionLines, ...aboutMeta.features];
  const detailRows = isMultiSubject
    ? [
        { label: "Instructor", value: instructorName, icon: "person" },
        { label: "Level", value: course.level || "Beginner", icon: "bar-chart" },
        { label: "Language", value: course.course_language || "HINGLISH", icon: "language" },
        { label: "Start Date", value: readableValue(course.start_date), icon: "calendar" },
        { label: "End Date", value: readableValue(course.end_date), icon: "calendar-outline" },
        { label: "Validity", value: course.validity_months ? `${course.validity_months} months` : "", icon: "time" },
      ].filter((row) => row.value)
    : [
        { label: "Instructor", value: instructorName, icon: "person" },
        { label: "Level", value: course.level || "Beginner", icon: "bar-chart" },
        { label: "Subject", value: readableValue(course.subject), icon: "bookmark" },
        { label: "Duration", value: course.duration_hours ? `${course.duration_hours}h total` : "", icon: "time" },
      ].filter((row) => row.value);

  const countItems = isMultiSubject
    ? [
        { label: "Lectures", value: lecturesCount, icon: "play-circle" },
        { label: "Tests", value: testCount, icon: "document-text" },
        { label: "Mock", value: mockCount, icon: "clipboard" },
        { label: "PYQs", value: pyqCount, icon: "school" },
        { label: "Material", value: materialsCount, icon: "folder" },
        { label: "Missions", value: missionCount, icon: "flag" },
      ]
    : [
        { label: "Lectures", value: lecturesCount, icon: "play-circle" },
        { label: "Tests", value: testCount, icon: "document-text" },
        { label: "Mock", value: mockCount, icon: "clipboard" },
        { label: "Materials", value: materialsCount, icon: "folder" },
        { label: "Missions", value: missionCount, icon: "flag" },
      ];

  const explorePath = isMultiSubject ? `/multi-course/${course.id}` : `/course/${course.id}`;
  const continuePath = explorePath;

  const headerGradient: [string, string] = isMultiSubject
    ? ["#0A1628", "#1A2E50"]
    : [accent, `${accent}DD`];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
        <LinearGradient colors={headerGradient} style={[styles.hero, isMultiSubject ? null : styles.heroNormal, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerTopRow}>
            <Pressable style={styles.iconBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }} />
            {course.is_free ? (
              <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>FREE</Text></View>
            ) : discount > 0 ? (
              <View style={[styles.headerBadge, { backgroundColor: Colors.light.accent }]}><Text style={styles.headerBadgeText}>{discount}% OFF</Text></View>
            ) : null}
          </View>

          {isMultiSubject ? (
            <View style={styles.headerTextCol}>
              <Text style={styles.title} numberOfLines={2}>{course.title}</Text>
              <Text style={styles.meta}>{course.category || "Course"} · {course.level || "Beginner"} · {course.course_language || "HINGLISH"}</Text>
            </View>
          ) : (
            <>
              <Text style={styles.category}>{course.category || "Course"}</Text>
              <Text style={styles.title} numberOfLines={2}>{course.title}</Text>
              <View style={styles.instructorRow}>
                <View style={styles.instructorAvatar}><Ionicons name="person" size={14} color="#fff" /></View>
                <Text style={styles.instructorName}>{course.teacher_name || "3i Learning"}</Text>
                <View style={styles.levelChip}><Text style={styles.levelChipText}>{course.level || "Beginner"}</Text></View>
              </View>
              {(course.start_date || course.end_date) ? (
                <View style={styles.courseDateRow}>
                  <Ionicons name="calendar" size={14} color="rgba(255,255,255,0.9)" />
                  <Text style={styles.courseDateText}>
                    {readableValue(course.start_date) || "TBD"} → {readableValue(course.end_date) || "TBD"}
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </LinearGradient>

        <View style={styles.body}>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Progress</Text>
              <Text style={styles.progressText}>{progress}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
            </View>
            <View style={styles.countGrid}>
              {countItems.map((item) => (
                <View key={item.label} style={styles.countPill}>
                  <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={15} color={Colors.light.primary} />
                  <Text style={styles.countValue}>{item.value}</Text>
                  <Text style={styles.countLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.aboutSection, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
            <View style={styles.aboutSectionHeader}>
              <Ionicons name="information-circle" size={20} color={Colors.light.primary} />
              <Text style={[styles.aboutSectionTitle, { color: colors.text }]}>About this Course</Text>
            </View>
            <View style={{ gap: 10 }}>
              {(aboutLines.length > 0 ? aboutLines : ["Course details will be added soon."]).map((line, index) => (
                <View key={`${line}-${index}`} style={styles.aboutIncludeItem}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.light.primary} />
                  <Text style={[styles.aboutIncludeText, { color: colors.text }]}>{line}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.aboutSection, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
            <View style={styles.aboutSectionHeader}>
              <Ionicons name="list" size={20} color={Colors.light.primary} />
              <Text style={[styles.aboutSectionTitle, { color: colors.text }]}>Course Details</Text>
            </View>
            <View style={styles.aboutDetailGrid}>
              {detailRows.map((row) => (
                <View key={row.label} style={styles.aboutDetailItem}>
                  <Ionicons name={row.icon as keyof typeof Ionicons.glyphMap} size={16} color={Colors.light.textMuted} />
                  <View>
                    <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>{row.label}</Text>
                    <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{row.value}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.aboutSection, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
            <View style={styles.aboutSectionHeader}>
              <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
              <Text style={[styles.aboutSectionTitle, { color: colors.text }]}>What's Included</Text>
            </View>
            <View style={{ gap: 10 }}>
              {isMultiSubject ? (
                <>
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="grid" size={18} color={Colors.light.primary} />
                    <Text style={[styles.aboutIncludeText, { color: colors.text }]}>Maths, English, Science and G.K subject sections</Text>
                  </View>
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="layers" size={18} color="#F59E0B" />
                    <Text style={[styles.aboutIncludeText, { color: colors.text }]}>Separate Live, Lecture, Test, PYQ, Mock and Material areas</Text>
                  </View>
                </>
              ) : (
                <>
                  {lecturesCount > 0 ? (
                    <View style={styles.aboutIncludeItem}>
                      <Ionicons name="videocam" size={18} color={Colors.light.primary} />
                      <Text style={[styles.aboutIncludeText, { color: colors.text }]}>{lecturesCount} Video Lectures</Text>
                    </View>
                  ) : null}
                  {testCount > 0 ? (
                    <View style={styles.aboutIncludeItem}>
                      <Ionicons name="document-text" size={18} color="#F59E0B" />
                      <Text style={[styles.aboutIncludeText, { color: colors.text }]}>{testCount} Tests</Text>
                    </View>
                  ) : null}
                  {materialsCount > 0 ? (
                    <View style={styles.aboutIncludeItem}>
                      <Ionicons name="folder" size={18} color="#7C3AED" />
                      <Text style={[styles.aboutIncludeText, { color: colors.text }]}>{materialsCount} Study Materials</Text>
                    </View>
                  ) : null}
                  {(course.course_type || "live") === "live" ? (
                    <View style={styles.aboutIncludeItem}>
                      <Ionicons name="radio" size={18} color="#EF4444" />
                      <Text style={[styles.aboutIncludeText, { color: colors.text }]}>Live classes and recordings</Text>
                    </View>
                  ) : null}
                </>
              )}
              <View style={styles.aboutIncludeItem}>
                <Ionicons name="phone-portrait" size={18} color="#7C3AED" />
                <Text style={[styles.aboutIncludeText, { color: colors.text }]}>Access on mobile & web</Text>
              </View>
            </View>
          </View>

          {teachers.length > 0 ? (
          <View style={[styles.aboutSection, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
            <View style={styles.aboutSectionHeader}>
              <Ionicons name="people" size={20} color={Colors.light.primary} />
              <Text style={[styles.aboutSectionTitle, { color: colors.text }]}>Teachers</Text>
            </View>
            <View style={styles.teacherGrid}>
              {teachers.map((teacher, index) => (
                <View key={`${teacher.name}-${index}`} style={[styles.teacherCard, { borderColor: colors.border, width: teacherCardWidth as any }]}>
                  {teacher.imageUrl ? <Image source={{ uri: teacher.imageUrl }} style={styles.teacherImage} /> : (
                    <View style={[styles.teacherImage, styles.teacherFallback]}><Ionicons name="person" size={30} color={Colors.light.primary} /></View>
                  )}
                  <View style={{ flex: 1, alignItems: "center" }}>
                    {teacher.name ? (
                      <Text style={[styles.teacherName, { color: colors.text }]} numberOfLines={2}>{teacher.name}</Text>
                    ) : null}
                    <Text style={[styles.teacherBio, { color: colors.textSecondary }]} numberOfLines={4}>
                      {teacher.bio?.trim() ? teacher.bio : "no description"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
          ) : null}

          <View style={styles.aboutTncBlock}>
            <View style={styles.aboutSectionHeader}>
              <Ionicons name="shield-checkmark" size={18} color="#92400E" />
              <Text style={[styles.aboutSectionTitle, { color: "#92400E", fontSize: 14 }]}>Terms & Conditions</Text>
            </View>
            {[
              "Fee is non-refundable and non-transferable under any circumstances.",
              "If you are blocked or removed from the course, you will lose all further access. To regain access, you will need to purchase the course again.",
              "The validity of this course is fixed and cannot be extended under any circumstances.",
            ].map((point, index) => (
              <View key={index} style={styles.aboutTncItem}>
                <Text style={styles.aboutTncBullet}>•</Text>
                <Text style={styles.aboutTncText}>{point}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10, backgroundColor: colors.card, borderTopColor: colors.border }]}>
        {course.isEnrolled ? (
          <Pressable style={styles.bottomBtnWrap} onPress={() => router.push(continuePath as any)}>
            <LinearGradient colors={["#EA580C", "#F97316"]} style={styles.bottomBtn}>
              <Text style={styles.buyText}>Continue Learning</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
        ) : (
          <>
            <Pressable style={styles.bottomBtnWrap} onPress={() => router.push(explorePath as any)}>
              <LinearGradient colors={["#1A56DB", "#2563EB"]} style={styles.bottomBtn}>
                <Text style={styles.exploreText}>Explore Now</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </LinearGradient>
            </Pressable>
            <Pressable style={styles.bottomBtnWrap} onPress={purchase} disabled={isPending}>
              <LinearGradient colors={["#EA580C", "#F97316"]} style={styles.bottomBtn}>
                {isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buyText} numberOfLines={1}>
                    {isFreeCourse ? "Enroll Free" : `Buy Now${course.price ? ` - Rs ${parseFloat(course.price).toFixed(0)}` : ""}`}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>
          </>
        )}
      </View>
      {paymentModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { paddingHorizontal: 16, paddingBottom: 16 },
  heroNormal: { paddingBottom: 14, gap: 2 },
  headerTopRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  headerTextCol: { gap: 4 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerBadge: { backgroundColor: "#22C55E", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  headerBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  category: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", marginBottom: 4 },
  title: { color: "#fff", fontSize: 22, lineHeight: 28, fontFamily: "Inter_700Bold" },
  meta: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  instructorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  instructorAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  instructorName: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  levelChip: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  levelChipText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  courseDateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  courseDateText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.9)" },
  exploreText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  body: { padding: 20, gap: 20 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  progressText: { fontSize: 18, fontFamily: "Inter_800ExtraBold", color: Colors.light.primary },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: "#E2E8F0", overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: Colors.light.primary },
  countGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  countPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EEF2FF", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  countValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold", color: Colors.light.primary },
  countLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#334155" },
  aboutSection: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  aboutSectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  aboutSectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text },
  aboutDetailGrid: { gap: 14 },
  aboutDetailItem: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  aboutDetailLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  aboutDetailValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginTop: 1 },
  aboutIncludeItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  aboutIncludeText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text, lineHeight: 20 },
  teacherGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  teacherCard: { alignItems: "center", gap: 9, borderWidth: 1, borderRadius: 14, padding: 12, minHeight: 166 },
  teacherImage: { width: 62, height: 62, borderRadius: 16 },
  teacherFallback: { backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" },
  teacherName: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 3, textAlign: "center" },
  teacherBio: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", textAlign: "center" },
  aboutTncBlock: { backgroundColor: "#FFFBEB", borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: "#FDE68A" },
  aboutTncItem: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  aboutTncBullet: { fontSize: 14, color: "#92400E", lineHeight: 20, marginTop: 1 },
  aboutTncText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#78350F", lineHeight: 20 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, flexDirection: "row", gap: 10, alignItems: "center" },
  bottomBtnWrap: { flex: 1, borderRadius: 16, overflow: "hidden" },
  bottomBtn: { borderRadius: 16, paddingVertical: 15, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", minHeight: 52, flexDirection: "row", gap: 6 },
  buyText: { color: "#fff", fontSize: 15, fontFamily: "Inter_800ExtraBold", flexShrink: 1 },
});
