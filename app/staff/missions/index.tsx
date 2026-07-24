import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiUrl, apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStaffPermissions } from "@/lib/staff/useStaffPermissions";

export default function StaffMissionsScreen() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const { can } = useStaffPermissions();
  const canCreate = can("missions.create");

  const { data: missions = [], isLoading } = useQuery({
    queryKey: ["/api/staff/daily-missions"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/staff/daily-missions", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMission = async () => {
    if (!canCreate) return Alert.alert("Not allowed", "You do not have permission to create missions.");
    if (!title.trim() || !courseId) return Alert.alert("Title and course ID required");
    try {
      await apiRequest("POST", "/api/staff/daily-missions", {
        title,
        courseId: Number(courseId),
        questions: [{ question: "Sample?", options: ["A", "B"], correct: 0 }],
      });
      qc.invalidateQueries({ queryKey: ["/api/staff/daily-missions"] });
      Alert.alert("Created", "Mission added.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 12 }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.title, { color: colors.text }]}>Daily Missions</Text>
      {canCreate ? (
        <>
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Mission title" value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} />
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Course ID" value={courseId} onChangeText={setCourseId} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
          <Pressable style={styles.btn} onPress={createMission}><Text style={styles.btnText}>Add Mission</Text></Pressable>
        </>
      ) : null}
      {isLoading ? <ActivityIndicator color={Colors.light.primary} /> : missions.map((m: any) => (
        <View key={m.id} style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>{m.title}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontFamily: "Inter_800ExtraBold", marginBottom: 12 },
  input: { borderRadius: 8, padding: 12, marginBottom: 8, fontFamily: "Inter_400Regular" },
  btn: { backgroundColor: Colors.light.primary, borderRadius: 8, padding: 12, alignItems: "center", marginBottom: 16 },
  btnText: { color: "#fff", fontFamily: "Inter_700Bold" },
  card: { padding: 12, borderRadius: 10, marginBottom: 8 },
});
