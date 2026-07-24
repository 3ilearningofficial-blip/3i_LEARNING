import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiUrl, apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStaffPermissions } from "@/lib/staff/useStaffPermissions";

export default function StaffMaterialsScreen() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const { can } = useStaffPermissions();
  const canCreate = can("materials.free.create");
  const canDelete = can("materials.free.delete");

  const { data: materials = [], isLoading } = useQuery({
    queryKey: ["/api/staff/materials"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/staff/materials", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const upload = async () => {
    if (!canCreate) return Alert.alert("Not allowed", "You do not have permission to upload materials.");
    if (!title.trim() || !fileUrl.trim()) return Alert.alert("Title and file URL required");
    try {
      await apiRequest("POST", "/api/staff/materials", { title, fileUrl, fileType: "pdf" });
      qc.invalidateQueries({ queryKey: ["/api/staff/materials"] });
      setTitle("");
      setFileUrl("");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed");
    }
  };

  const remove = async (id: number) => {
    if (!canDelete) return Alert.alert("Not allowed", "You do not have permission to delete materials.");
    try {
      await apiRequest("DELETE", `/api/staff/materials/${id}`, {});
      qc.invalidateQueries({ queryKey: ["/api/staff/materials"] });
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 12 }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.title, { color: colors.text }]}>Free Materials</Text>
      {canCreate ? (
        <>
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Title" value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} />
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="File URL (R2)" value={fileUrl} onChangeText={setFileUrl} placeholderTextColor={colors.textMuted} />
          <Pressable style={styles.btn} onPress={upload}><Text style={styles.btnText}>Upload Material</Text></Pressable>
        </>
      ) : null}
      {isLoading ? <ActivityIndicator color={Colors.light.primary} /> : materials.map((m: any) => (
        <View key={m.id} style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold", flex: 1 }}>{m.title}</Text>
          {canDelete ? (
            <Pressable onPress={() => remove(m.id)}><Text style={{ color: "#dc2626" }}>Delete</Text></Pressable>
          ) : null}
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
  card: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, marginBottom: 8, gap: 8 },
});
