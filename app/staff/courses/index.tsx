import React from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

export default function StaffCoursesIndex() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
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
      <LinearGradient colors={[Colors.light.primary, "#1e40af"]} style={{ paddingTop: insets.top + 12, padding: 16 }}>
        <Text style={{ color: "#fff", fontFamily: "Inter_800ExtraBold", fontSize: 20 }}>My Courses</Text>
      </LinearGradient>
      {isLoading ? (
        <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 24 }} />
      ) : (
        <View style={{ padding: 16 }}>
          {courses.map((c: any) => (
            <Pressable
              key={c.id}
              style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
              onPress={() => router.push(`/staff/courses/${c.id}` as any)}
            >
              <Text style={{ color: colors.text, fontFamily: "Inter_700Bold", fontSize: 16 }}>{c.title}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                {(c.assignments || []).map((a: any) => a.subject_key || "Full course").join(", ")}
              </Text>
            </Pressable>
          ))}
          {courses.length === 0 && <Text style={{ color: colors.textMuted, textAlign: "center" }}>No courses assigned yet.</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
});
