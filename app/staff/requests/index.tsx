import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiUrl, apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const REQUEST_TYPES = [
  { key: "recording_upload", label: "Recording session permission" },
  { key: "youtube_materials", label: "YouTube in materials" },
  { key: "student_course_access", label: "Course access as student" },
  { key: "new_subject", label: "New subject assignment" },
];

export default function StaffRequestsScreen() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["/api/staff/requests"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/staff/requests", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const submit = async (requestType: string) => {
    try {
      await apiRequest("POST", "/api/staff/requests", { requestType, payload: {} });
      qc.invalidateQueries({ queryKey: ["/api/staff/requests"] });
      Alert.alert("Submitted", "Admin will review your request.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 12 }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.title, { color: colors.text }]}>Access Requests</Text>
      {REQUEST_TYPES.map((t) => (
        <Pressable key={t.key} style={[styles.requestBtn, { backgroundColor: colors.surfaceAlt }]} onPress={() => submit(t.key)}>
          <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>{t.label}</Text>
        </Pressable>
      ))}
      <Text style={[styles.sub, { color: colors.text }]}>Your requests</Text>
      {isLoading ? <ActivityIndicator color={Colors.light.primary} /> : requests.map((r: any) => (
        <View key={r.id} style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>{r.request_type}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{r.status}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontFamily: "Inter_800ExtraBold", marginBottom: 12 },
  sub: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 20, marginBottom: 8 },
  requestBtn: { padding: 14, borderRadius: 10, marginBottom: 8 },
  card: { padding: 12, borderRadius: 10, marginBottom: 8 },
});
