import React from "react";
import { View, Text, StyleSheet, Image, Platform, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { getCourseAccentColor } from "@shared/courseTheme";
import { COURSE_BANNER_ASPECT } from "@/constants/courseBanner";

type Props = {
  course: {
    id: number;
    title: string;
    thumbnail?: string;
    course_type?: string;
    category?: string;
    teacher_name?: string;
    total_lectures?: number;
    total_tests?: number;
    total_materials?: number;
  };
  assignment?: { subject_key?: string | null } | null;
  topPadding?: number;
};

export function CourseDetailHero({ course, assignment, topPadding = 16 }: Props) {
  const { colors, isDarkMode } = useAppTheme();
  const { width } = useWindowDimensions();
  const accent = getCourseAccentColor(course.id);
  const headerMinHeight = course.thumbnail && width > 0 ? Math.min(200, width / COURSE_BANNER_ASPECT) : undefined;
  const subjectKey = assignment?.subject_key?.trim();

  return (
    <LinearGradient
      colors={isDarkMode ? ["#020617", accent, "#0F172A"] : ["#0A1628", accent, `${accent}CC`]}
      style={[styles.header, { paddingTop: topPadding + 4 }, headerMinHeight != null ? { minHeight: headerMinHeight } : null]}
    >
      {course.thumbnail ? (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Image
            source={{ uri: course.thumbnail }}
            style={[
              styles.headerThumbnail,
              Platform.OS === "web"
                ? ({ objectFit: "cover", objectPosition: "center center", width: "100%", height: "100%" } as any)
                : null,
            ]}
            resizeMode="cover"
          />
          <LinearGradient colors={["rgba(10,22,40,0.55)", "rgba(10,22,40,0.75)"]} style={StyleSheet.absoluteFillObject} />
        </View>
      ) : null}
      <View style={styles.headerContent}>
        <Text style={styles.category}>{course.category || "Course"}</Text>
        <Text style={styles.title} numberOfLines={2}>{course.title}</Text>
        {course.teacher_name ? (
          <View style={styles.metaRow}>
            <Ionicons name="person" size={14} color="rgba(255,255,255,0.85)" />
            <Text style={styles.metaText}>{course.teacher_name}</Text>
          </View>
        ) : null}
        {subjectKey ? (
          <View style={styles.subjectChip}>
            <Text style={styles.subjectChipText}>Assigned: {subjectKey}</Text>
          </View>
        ) : null}
        <View style={styles.statsRow}>
          <Text style={styles.statText}>{course.total_lectures || 0} Lectures</Text>
          <Text style={styles.statDot}>·</Text>
          <Text style={styles.statText}>{course.total_tests || 0} Tests</Text>
          <Text style={styles.statDot}>·</Text>
          <Text style={styles.statText}>{course.total_materials || 0} Materials</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 18, borderRadius: 0, overflow: "hidden" },
  headerThumbnail: { ...StyleSheet.absoluteFillObject },
  headerContent: { gap: 6, zIndex: 1 },
  category: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  title: { color: "#fff", fontSize: 22, fontFamily: "Inter_800ExtraBold", lineHeight: 28 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontFamily: "Inter_500Medium" },
  subjectChip: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 2,
  },
  subjectChipText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  statText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Inter_500Medium" },
  statDot: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
});
