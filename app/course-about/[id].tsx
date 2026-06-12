import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image } from "react-native";
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

export default function MultiSubjectCourseAbout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
        <LinearGradient colors={[cover, `${cover}CC`]} style={[styles.hero, { paddingTop: insets.top + 12 }]}>
          <View style={styles.topRow}>
            <Pressable style={styles.iconBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => router.push(`/multi-course/${course.id}` as any)}>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </Pressable>
          </View>
          {course.thumbnail ? <Image source={{ uri: course.thumbnail }} style={styles.bannerImage} resizeMode="cover" /> : null}
          <View style={styles.heroText}>
            <Text style={styles.badge}>MULTI SUBJECT COURSE</Text>
            <Text style={styles.title}>{course.title}</Text>
            <Text style={styles.meta}>{course.category || "Course"} · {course.level || "Beginner"} · {course.course_language || "HINGLISH"}</Text>
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

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>About Course</Text>
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{course.description || "Course details will be added soon."}</Text>
            {aboutMeta.features.length > 0 ? (
              <View style={styles.featuresList}>
                {aboutMeta.features.map((feature) => (
                  <View key={feature} style={styles.featureRow}>
                    <Ionicons name="checkmark-circle" size={17} color="#16A34A" />
                    <Text style={[styles.featureText, { color: colors.text }]}>{feature}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Teachers</Text>
            {teachers.map((teacher, index) => (
              <View key={`${teacher.name}-${index}`} style={[styles.teacherCard, { borderColor: colors.border }]}>
                {teacher.imageUrl ? <Image source={{ uri: teacher.imageUrl }} style={styles.teacherImage} /> : (
                  <View style={[styles.teacherImage, styles.teacherFallback]}><Ionicons name="person" size={30} color={Colors.light.primary} /></View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.teacherName, { color: colors.text }]}>{teacher.name || "3i Learning"}</Text>
                  <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{teacher.bio || "Teacher details will be added soon."}</Text>
                </View>
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
  badge: { alignSelf: "flex-start", color: "#fff", fontSize: 11, fontFamily: "Inter_800ExtraBold", backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  title: { color: "#fff", fontSize: 26, lineHeight: 32, fontFamily: "Inter_800ExtraBold" },
  meta: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  body: { padding: 16, gap: 14 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  progressText: { fontSize: 18, fontFamily: "Inter_800ExtraBold", color: Colors.light.primary },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: "#E2E8F0", overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: Colors.light.primary },
  countGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  countPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EEF2FF", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  countValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold", color: Colors.light.primary },
  countLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#334155" },
  bodyText: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_500Medium" },
  featuresList: { gap: 9, marginTop: 4 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  featureText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: "Inter_700Bold" },
  teacherCard: { flexDirection: "row", gap: 14, borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 8 },
  teacherImage: { width: 68, height: 68, borderRadius: 18 },
  teacherFallback: { backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" },
  teacherName: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginBottom: 4 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  buyBtn: { backgroundColor: Colors.light.primary, borderRadius: 16, paddingVertical: 15, alignItems: "center" },
  buyText: { color: "#fff", fontSize: 16, fontFamily: "Inter_800ExtraBold" },
});
