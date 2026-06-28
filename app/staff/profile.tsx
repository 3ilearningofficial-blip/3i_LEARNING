import React, { useState } from "react";
import { View, ActivityIndicator, Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { StaffProfileSections } from "@/components/staff/StaffProfileSections";
import Colors from "@/constants/colors";
import { router } from "expo-router";
import { Pressable, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function StaffProfileScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/staff/profile"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/staff/profile", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const saveProfile = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/staff/profile", payload);
      qc.invalidateQueries({ queryKey: ["/api/staff/profile"] });
      Alert.alert("Saved", "Profile updated.");
    } finally {
      setSaving(false);
    }
  };

  const saveEducation = async (items: any[]) => {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/staff/profile/education", { items });
      qc.invalidateQueries({ queryKey: ["/api/staff/profile"] });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !data) return <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />;

  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingHorizontal: 16 }}>
      {Platform.OS !== "web" && (
        <Pressable style={styles.moreLink} onPress={() => router.push("/staff/more" as any)}>
          <Ionicons name="menu" size={20} color={Colors.light.primary} />
          <Text style={styles.moreText}>Missions, Requests & More</Text>
        </Pressable>
      )}
      <StaffProfileSections
        mode="teacher"
        profile={data.profile}
        user={data.user}
        education={data.education || []}
        experience={data.experience || []}
        saving={saving}
        onSavePersonal={saveProfile}
        onSaveBank={saveProfile}
        onSaveEducation={saveEducation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  moreLink: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, paddingVertical: 8 },
  moreText: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
});
