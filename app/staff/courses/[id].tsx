import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { CourseContentTabs } from "@/components/staff/CourseContentTabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function StaffCourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("Lectures");

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
    <View style={{ flex: 1, paddingTop: insets.top, paddingHorizontal: 12 }}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Ionicons name="arrow-back" size={22} color={Colors.light.text} />
        <Text style={styles.backText}>{data.course?.title}</Text>
      </Pressable>
      <CourseContentTabs
        course={data.course}
        assignment={data.assignment}
        lectures={data.lectures || []}
        tests={data.tests || []}
        materials={data.materials || []}
        liveClasses={data.liveClasses || []}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={() => { refetch(); qc.invalidateQueries({ queryKey: ["/api/staff/dashboard"] }); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  backText: { fontFamily: "Inter_700Bold", fontSize: 16, flex: 1 },
});
