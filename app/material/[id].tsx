import React, { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator, Share, Linking,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";

function getViewUrl(fileUrl: string, fileType: string): string {
  if (!fileUrl) return "";
  if (fileType === "pdf" || fileUrl.toLowerCase().endsWith(".pdf")) {
    return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(fileUrl)}`;
  }
  return fileUrl;
}

function getIconName(fileType: string): keyof typeof Ionicons.glyphMap {
  switch (fileType) {
    case "pdf": return "document-text";
    case "video": return "videocam";
    case "doc": return "document";
    default: return "link";
  }
}

export default function MaterialViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const { data: material, isError: fetchError } = useQuery<{
    id: number; title: string; file_url: string; file_type: string;
    description: string; download_allowed: boolean; is_free: boolean;
    section_title: string | null;
  }>({
    queryKey: ["/api/study-materials", id],
    enabled: !!id,
  });

  const viewUrl = material ? getViewUrl(material.file_url, material.file_type) : "";

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable
            style={styles.backBtn}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle} numberOfLines={1}>{material?.title || "Study Material"}</Text>
            {material && (
              <View style={styles.headerMeta}>
                <Ionicons name={getIconName(material.file_type)} size={12} color="rgba(255,255,255,0.6)" />
                <Text style={styles.headerMetaText}>{material.file_type?.toUpperCase() || "FILE"}</Text>
                {material.is_free && (
                  <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>
                )}
              </View>
            )}
          </View>
          <View style={styles.headerActions}>
            {material?.download_allowed && (
              <Pressable
                style={styles.actionBtn}
                onPress={() => {
                  if (material?.file_url) Linking.openURL(material.file_url);
                }}
              >
                <Ionicons name="download-outline" size={20} color="#fff" />
              </Pressable>
            )}
            <Pressable
              style={styles.actionBtn}
              onPress={async () => {
                if (material?.file_url) {
                  try {
                    await Share.share({ url: material.file_url, message: `${material.title}: ${material.file_url}` });
                  } catch {}
                }
              }}
            >
              <Ionicons name="share-outline" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {fetchError ? (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={48} color={Colors.light.accent} />
            <Text style={styles.errorTitle}>Failed to load material</Text>
            <Text style={styles.errorSub}>Please check your connection and try again.</Text>
            <Pressable style={styles.openExtBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={16} color="#fff" />
              <Text style={styles.openExtBtnText}>Go Back</Text>
            </Pressable>
          </View>
        ) : !material ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading material...</Text>
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={48} color={Colors.light.accent} />
            <Text style={styles.errorTitle}>Unable to preview</Text>
            <Text style={styles.errorSub}>This file can't be previewed in-app.</Text>
            <Pressable style={styles.openExtBtn} onPress={() => Linking.openURL(material.file_url)}>
              <Ionicons name="open-outline" size={16} color="#fff" />
              <Text style={styles.openExtBtnText}>Open in Browser</Text>
            </Pressable>
          </View>
        ) : Platform.OS === "web" ? (
          <iframe
            src={viewUrl}
            style={{ width: "100%", height: "100%", border: "none" } as any}
            title={material.title}
            onLoad={() => setLoading(false)}
          />
        ) : (
          <WebView
            source={{ uri: viewUrl }}
            style={styles.webview}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true); }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            allowsInlineMediaPlayback
            mixedContentMode="compatibility"
            allowsFullscreenVideo
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
            renderLoading={() => (
              <View style={styles.webviewLoading}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
              </View>
            )}
          />
        )}
        {loading && Platform.OS === "web" && (
          <View style={styles.webLoadingOverlay}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  headerMetaText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  freeBadge: { backgroundColor: "#22C55E30", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  freeBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#22C55E" },
  headerActions: { flexDirection: "row", gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  content: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  loadingText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginTop: 12 },
  errorTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text, marginTop: 16 },
  errorSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 6, textAlign: "center" },
  openExtBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.light.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  openExtBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  webview: { flex: 1 },
  webviewLoading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
  webLoadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
});
