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
  level?: string;
  start_date?: string;
  end_date?: string;
  validity_months?: number | string | null;
};

type AboutTeacher = { name: string; imageUrl: string; bio: string };

function parseAboutMeta(value: any, course: Course): { features: string[]; teachers: AboutTeacher[] } {
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
  return {
    features: [],
    teachers: course.teacher_name || course.teacher_bio || course.teacher_image_url
      ? [{ name: course.teacher_name || "3i Learning", imageUrl: course.teacher_image_url || "", bio: course.teacher_bio || "" }]
      : [],
  };
}

async function fetchCourse(id: string): Promise<Course | null> {
  const res = await authFetch(new URL(`/api/courses/${id}`, getApiUrl()).toString());
  if (!res.ok) return null;
  return res.json();
}

function readableValue(value?: string | number | null): string {
  if (value == null || value === "") return "";
  return String(value);
}

export default function MultiSubjectCourseAbout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { data: course, isLoading } = useQuery({
    queryKey: ["/api/courses", String(id)],
    queryFn: () => fetchCourse(String(id)),
    enabled: !!id,
    staleTime: 0,
  });

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={Colors.light.primary} /></View>;
  }
  if (!course) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={{ color: colors.text }}>Course not found</Text></View>;
  }

  const cover = course.cover_color || "#4F46E5";
  const isFreeCourse = course.is_free || parseFloat(String(course.price || "0")) <= 0;
  const progress = Math.max(0, Math.min(100, Number(course.progress || 0)));
  const lecturesCount = Array.isArray(course.lectures) ? course.lectures.length : 0;
  const materialsCount = Array.isArray(course.materials) ? course.materials.length : 0;
  const tests = Array.isArray(course.tests) ? course.tests : [];
  const pyqCount = tests.filter((t) => String(t.test_type || "").toLowerCase() === "pyq").length;
  const mockCount = tests.filter((t) => String(t.test_type || "").toLowerCase() === "mock").length;
  const testCount = tests.filter((t) => !["pyq", "mock"].includes(String(t.test_type || "").toLowerCase())).length;
  const aboutMeta = parseAboutMeta(course.teacher_details_json, course);
  const teachers = aboutMeta.teachers.length > 0 ? aboutMeta.teachers : [{ name: course.teacher_name || "3i Learning", imageUrl: course.teacher_image_url || "", bio: course.teacher_bio || "Teacher details can be managed from the admin dashboard." }];
  const teacherCardWidth = width >= 900 ? "19%" : width >= 600 ? "31.5%" : "48%";
  const descriptionLines = String(course.description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const aboutLines = [...descriptionLines, ...aboutMeta.features];
  const detailRows = [
    { label: "Instructor", value: teachers[0]?.name || course.teacher_name || "3i Learning", icon: "person" },
    { label: "Level", value: course.level || "Beginner", icon: "bar-chart" },
    { label: "Language", value: course.course_language || "HINGLISH", icon: "language" },
    { label: "Start Date", value: readableValue(course.start_date), icon: "calendar" },
    { label: "End Date", value: readableValue(course.end_date), icon: "calendar-outline" },
    { label: "Validity", value: course.validity_months ? `${course.validity_months} months` : "", icon: "time" },
  ].filter((row) => row.value);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
        <LinearGradient colors={[cover, `${cover}CC`]} style={[styles.hero, { paddingTop: insets.top + 12 }]}>
          <View style={styles.topRow}>
            <Pressable style={styles.iconBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ width: 42 }} />
          </View>
          {course.thumbnail ? <Image source={{ uri: course.thumbnail }} style={styles.bannerImage} resizeMode="cover" /> : null}
          <View style={styles.heroText}>
            <Text style={styles.title}>{course.title}</Text>
            <Text style={styles.meta}>{course.category || "Course"} · {course.level || "Beginner"} · {course.course_language || "HINGLISH"}</Text>
            <Pressable style={styles.exploreBtn} onPress={() => router.push(`/multi-course/${course.id}` as any)}>
              <Text style={styles.exploreText}>Explore Course</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Pressable>
          </View>
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
              {[
                { label: "Lectures", value: lecturesCount, icon: "play-circle" },
                { label: "Tests", value: testCount, icon: "document-text" },
                { label: "Mock", value: mockCount, icon: "clipboard" },
                { label: "PYQs", value: pyqCount, icon: "school" },
                { label: "Material", value: materialsCount, icon: "folder" },
              ].map((item) => (
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
              <View style={styles.aboutIncludeItem}>
                <Ionicons name="grid" size={18} color={Colors.light.primary} />
                <Text style={[styles.aboutIncludeText, { color: colors.text }]}>Maths, English, Science and G.K subject sections</Text>
              </View>
              <View style={styles.aboutIncludeItem}>
                <Ionicons name="layers" size={18} color="#F59E0B" />
                <Text style={[styles.aboutIncludeText, { color: colors.text }]}>Separate Live, Lecture, Test, PYQ, Mock and Material areas</Text>
              </View>
              <View style={styles.aboutIncludeItem}>
                <Ionicons name="phone-portrait" size={18} color="#7C3AED" />
                <Text style={[styles.aboutIncludeText, { color: colors.text }]}>Access on mobile & web</Text>
              </View>
            </View>
          </View>

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
                  <Text style={[styles.teacherName, { color: colors.text }]} numberOfLines={2}>{teacher.name || "3i Learning"}</Text>
                  <Text style={[styles.teacherBio, { color: colors.textSecondary }]} numberOfLines={4}>{teacher.bio || "Teacher details will be added soon."}</Text>
                </View>
              </View>
            ))}
            </View>
          </View>

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
        <Pressable style={styles.buyBtn} onPress={() => router.push(`/course/${course.id}` as any)}>
          <Text style={styles.buyText}>{course.isEnrolled ? "Continue Learning" : isFreeCourse ? "Enroll Free" : `Buy Now${course.price ? ` - Rs ${parseFloat(course.price).toFixed(0)}` : ""}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { paddingHorizontal: 18, paddingBottom: 22 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  bannerImage: { height: 150, borderRadius: 20, marginBottom: 16 },
  heroText: { gap: 8 },
  title: { color: "#fff", fontSize: 26, lineHeight: 32, fontFamily: "Inter_800ExtraBold" },
  meta: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  exploreBtn: { marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(15,23,42,0.72)", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  exploreText: { color: "#fff", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
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
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  buyBtn: { backgroundColor: Colors.light.primary, borderRadius: 16, paddingVertical: 15, alignItems: "center" },
  buyText: { color: "#fff", fontSize: 16, fontFamily: "Inter_800ExtraBold" },
});
