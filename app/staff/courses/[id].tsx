import React, { useState } from "react";
import { View, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { CourseContentTabs } from "@/components/staff/CourseContentTabs";
import { CourseDetailHero } from "@/components/course/CourseDetailHero";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "@/context/AppThemeContext";
import { Platform } from "react-native";

export default function StaffCourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("Lectures");
  const topPadding = Platform.OS === "web" ? 16 : insets.top;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/staff/courses", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/staff/courses/${id}`, getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading || !data) return <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CourseDetailHero course={data.course} assignment={data.assignment} topPadding={topPadding} />
      <View style={[styles.toolbar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
      </View>
      <CourseContentTabs
        course={data.course}
        assignment={data.assignment}
        lectures={data.lectures || []}
        tests={data.tests || []}
        materials={data.materials || []}
        liveClasses={data.liveClasses || []}
        courseFolders={data.folders || []}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={() => {
          refetch();
          qc.invalidateQueries({ queryKey: ["/api/staff/dashboard"] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { padding: 4 },
});
