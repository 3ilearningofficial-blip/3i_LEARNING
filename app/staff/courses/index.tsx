import React from "react";
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { CourseCard, type CourseHomeCardCourse } from "@/components/course/CourseHomeCards";

function assignmentSubjects(course: any): string[] {
  return (course.assignments || [])
    .map((a: any) => a.subject_key)
    .filter((k: string) => k && String(k).trim());
}

export default function StaffCoursesIndex() {
  const { colors, isDarkMode } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const topPadding = Platform.OS === "web" ? 16 : insets.top;

  const { data: courses = [], isLoading } = useQuery({
    queryKey: ["/api/staff/courses"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/staff/courses", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }}>
      <LinearGradient
        colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]}
        style={{ paddingTop: topPadding + 12, paddingHorizontal: 20, paddingBottom: 20 }}
      >
        <Text style={{ color: "#fff", fontFamily: "Inter_800ExtraBold", fontSize: 22 }}>My Courses</Text>
        <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 4, fontFamily: "Inter_400Regular" }}>
          Browse and manage your assigned courses
        </Text>
      </LinearGradient>
      {isLoading ? (
        <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 24 }} />
      ) : (
        <View style={[styles.grid, isWide && styles.gridWide]}>
          {courses.map((c: CourseHomeCardCourse & { assignments?: any[] }) => (
            <View key={c.id} style={[styles.gridItem, isWide && styles.gridItemWide]}>
              <CourseCard
                course={c}
                variant="staff"
                assignmentSubjects={assignmentSubjects(c)}
                onPress={() => router.push(`/staff/courses/${c.id}` as any)}
              />
            </View>
          ))}
          {courses.length === 0 && (
            <Text style={{ color: colors.textMuted, textAlign: "center", width: "100%", padding: 24 }}>
              No courses assigned yet.
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { padding: 16, gap: 0 },
  gridWide: { flexDirection: "row", flexWrap: "wrap", gap: 16, paddingHorizontal: 20 },
  gridItem: { marginBottom: 4 },
  gridItemWide: { width: "31%", minWidth: 280 },
});
