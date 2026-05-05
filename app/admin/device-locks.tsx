import React from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import type { DeviceDeniedUserRow } from "./user-types";

export default function AdminDeviceLocksScreen() {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery<DeviceDeniedUserRow[]>({
    queryKey: ["/api/admin/device-denied-users", "screen"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/admin/device-denied-users", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  const clearMutation = useMutation({
    mutationFn: async (userId: number) => {
      await apiRequest("POST", `/api/admin/users/${userId}/reset-device-binding`, {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/device-denied-users"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/device-denied-users", "screen"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <View style={{ paddingTop: Platform.OS === "web" ? 18 : 16, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.light.border, backgroundColor: "#fff" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable onPress={() => router.back()} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="arrow-back" size={18} color={Colors.light.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Blocked Sign-in Attempts</Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>
              Students locked due to device/browser mismatch
            </Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {isLoading ? (
          <ActivityIndicator size="large" color={Colors.light.primary} />
        ) : rows.length === 0 ? (
          <View style={{ backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border, padding: 14 }}>
            <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>No blocked students.</Text>
          </View>
        ) : (
          rows.map((row) => (
            <View key={row.user_id} style={{ backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border, padding: 12 }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                {row.user_name || `User #${row.user_id}`}
              </Text>
              {!!row.phone && <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{row.phone}</Text>}
              {!!row.email && <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{row.email}</Text>}
              <Text style={{ fontSize: 11, color: Colors.light.textMuted, marginTop: 4, fontFamily: "Inter_400Regular" }}>
                Last: {row.latest_at ? new Date(Number(row.latest_at)).toLocaleString() : ""} · {row.latest_platform || "?"} · {row.latest_reason || ""}
                {Number(row.event_count) > 1 ? ` · ${row.event_count} attempts` : ""}
              </Text>

              <Pressable
                style={{ alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#EEF2FF", opacity: clearMutation.isPending ? 0.6 : 1 }}
                onPress={() => {
                  Alert.alert(
                    "Unlock this student device lock?",
                    "Are you sure you want to unlock this device binding? The student will be able to sign in again from a new phone/laptop browser.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "OK",
                        onPress: async () => {
                          try {
                            await clearMutation.mutateAsync(row.user_id);
                            Alert.alert("Unlocked", "Device lock cleared successfully.");
                          } catch (err: any) {
                            Alert.alert("Failed", err?.message || "Could not clear device lock. Please try again.");
                          }
                        },
                      },
                    ]
                  );
                }}
                disabled={clearMutation.isPending}
              >
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Clear device lock</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

