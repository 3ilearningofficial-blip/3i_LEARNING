import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiUrl, apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function StaffTestsScreen() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");

  const { data: tests = [], isLoading } = useQuery({
    queryKey: ["/api/staff/tests"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/staff/tests", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createTest = async () => {
    if (!title.trim()) return Alert.alert("Title required");
    try {
      await apiRequest("POST", "/api/staff/tests", {
        title: title.trim(),
        courseId: courseId ? Number(courseId) : null,
        testType: "practice",
      });
      setTitle("");
      qc.invalidateQueries({ queryKey: ["/api/staff/tests"] });
      Alert.alert("Created", "Test created.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 12 }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.title, { color: colors.text }]}>Tests</Text>
      <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Test title" value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} />
      <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Course ID (optional)" value={courseId} onChangeText={setCourseId} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
      <Pressable style={styles.btn} onPress={createTest}><Text style={styles.btnText}>Add Test</Text></Pressable>
      {isLoading ? <ActivityIndicator color={Colors.light.primary} /> : tests.map((t: any) => (
        <View key={t.id} style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>{t.title}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t.course_title || "Standalone"} · {t.test_type}</Text>
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
