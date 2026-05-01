import React from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { DownloadButton } from "@/components/DownloadButton";
import { useAuth } from "@/context/AuthContext";

interface Material {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  section_title: string;
  download_allowed: boolean;
  created_at: number;
}

const FILE_ICONS: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  pdf: { icon: "document-text", color: "#DC2626", bg: "#FEE2E2", label: "PDF" },
  video: { icon: "videocam", color: "#7C3AED", bg: "#F3E8FF", label: "VIDEO" },
  doc: { icon: "document", color: "#1A56DB", bg: "#EFF6FF", label: "DOC" },
  link: { icon: "link", color: "#059669", bg: "#DCFCE7", label: "LINK" },
};

export default function MaterialFolderScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const folderName = decodeURIComponent(name || "");
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;

  const { data: materials = [], isLoading } = useQuery<Material[]>({
    queryKey: ["/api/study-materials/folder", folderName],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/study-materials/folder/${encodeURIComponent(folderName)}`, baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!folderName,
  });

  const openMaterial = (mat: Material) => {
    router.push(`/material/${mat.id}`);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)" as any);
          }}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{folderName}</Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)" }}>
              {isLoading ? "Loading..." : `${materials.length} ${materials.length === 1 ? "item" : "items"}`}
            </Text>
          </View>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="folder-open" size={22} color="#F59E0B" />
          </View>
        </View>
      </LinearGradient>

      {isLoading ? (
        <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 40 }} />
      ) : materials.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={48} color={Colors.light.textMuted} />
          <Text style={styles.emptyTitle}>No materials yet</Text>
          <Text style={styles.emptySub}>Materials added to this folder will appear here</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 32 }}>
          {materials.map((mat) => {
            const ft = FILE_ICONS[mat.file_type] || FILE_ICONS.link;
            return (
              <Pressable
                key={mat.id}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
                onPress={() => openMaterial(mat)}
              >
                <View style={[styles.iconBg, { backgroundColor: ft.bg }]}>
                  <Ionicons name={ft.icon as any} size={24} color={ft.color} />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{mat.title}</Text>
                  {mat.description ? <Text style={styles.cardDesc} numberOfLines={1}>{mat.description}</Text> : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                    <View style={[styles.typePill, { backgroundColor: ft.bg }]}>
                      <Text style={[styles.typePillText, { color: ft.color }]}>{ft.label}</Text>
                    </View>
                  </View>
                </View>
                <DownloadButton
                  itemType="material"
                  itemId={mat.id}
                  downloadAllowed={mat.download_allowed}
                  isEnrolled={true}
                  title={mat.title || 'Material'}
                  fileType={mat.file_type || 'pdf'}
                />
                <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  empty: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  emptySub: { fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#fff", borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: Colors.light.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  iconBg: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted },
  typePill: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  typePillText: { fontSize: 10, fontFamily: "Inter_700Bold" },
});
