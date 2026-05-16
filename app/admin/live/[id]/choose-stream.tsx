import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { liveClassQueryKey } from "@/lib/query-keys";
import { STREAM_TYPE_OPTIONS, type StreamType } from "@/lib/live-stream/types";
import { getAdminSetupRoute } from "@/lib/live-stream/liveRoutes";
import { useClassroomConfig } from "@/lib/classroom/useClassroomToken";
import Colors from "@/constants/colors";

export default function ChooseStreamPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const liveClassId = String(id || "");
  const [saving, setSaving] = useState<StreamType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: liveClass, isLoading } = useQuery({
    queryKey: liveClassQueryKey(liveClassId),
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}`);
      if (!res.ok) throw new Error("Failed to load live class");
      const payload = await res.json();
      return payload?.data ?? payload;
    },
    enabled: !!liveClassId,
  });

  const { data: classroomConfig } = useClassroomConfig(liveClassId);

  const handleSelect = async (type: StreamType) => {
    if (type === "classroom" && classroomConfig && !classroomConfig.livekitConfigured) {
      setError("LiveKit is not configured on the server. Choose another stream type or configure LIVEKIT_* env vars.");
      return;
    }
    if (type === "classroom" && Platform.OS !== "web") {
      setError("Interactive Classroom requires the admin web app on desktop.");
      return;
    }
    setError(null);
    setSaving(type);
    try {
      await apiRequest("PUT", `/api/admin/live-classes/${liveClassId}`, {
        streamType: type,
        isLive: false,
      });
      router.replace(getAdminSetupRoute(liveClassId, type) as any);
    } catch (err: any) {
      setError(err?.message || "Failed to save stream type");
      setSaving(null);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2A4A"]} style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {liveClass?.title || "Live class"}
          </Text>
          <Text style={styles.headerSub}>Choose how you want to teach</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {STREAM_TYPE_OPTIONS.map((opt) => {
          const disabled =
            (opt.id === "classroom" && !classroomConfig?.livekitConfigured) ||
            (opt.id === "classroom" && Platform.OS !== "web");
          return (
            <Pressable
              key={opt.id}
              style={[styles.card, disabled && styles.cardDisabled]}
              onPress={() => handleSelect(opt.id)}
              disabled={!!saving || disabled}
            >
              <View style={styles.cardIcon}>
                <Ionicons name={opt.icon as any} size={28} color={Colors.light.primary} />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle}>{opt.title}</Text>
                  {opt.recommended ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Recommended</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardDesc}>{opt.description}</Text>
                {disabled && opt.id === "classroom" ? (
                  <Text style={styles.cardWarn}>
                    {Platform.OS !== "web"
                      ? "Use admin on desktop web"
                      : "Configure LiveKit on server"}
                  </Text>
                ) : null}
              </View>
              {saving === opt.id ? (
                <ActivityIndicator size="small" color={Colors.light.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={22} color={Colors.light.textMuted} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "web" ? 16 : 48,
    paddingBottom: 16,
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  errorBox: {
    backgroundColor: "#FEE2E2",
    padding: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  errorText: { fontSize: 13, color: "#B91C1C", lineHeight: 18 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardDisabled: { opacity: 0.55 },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#F0F5FF",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: Colors.light.text },
  badge: {
    backgroundColor: "#EDE9FE",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#6D28D9" },
  cardDesc: { fontSize: 13, color: Colors.light.textMuted, marginTop: 4, lineHeight: 18 },
  cardWarn: { fontSize: 12, color: "#B45309", marginTop: 6 },
});
