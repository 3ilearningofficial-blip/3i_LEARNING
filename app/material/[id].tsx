import React, { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
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
  const [retryCount, setRetryCount] = useState(0);
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const { isAdmin } = useAuth();


  const { data: material, isError: fetchError } = useQuery<{
    id: number; title: string; file_url: string; file_type: string;
    description: string; download_allowed: boolean; is_free: boolean;
    section_title: string | null;
  }>({
    queryKey: ["/api/study-materials", id],
    enabled: !!id,
  });

  const viewUrl = material ? getViewUrl(material.file_url, material.file_type) : "";

  const handleRetry = () => {
    setError(false);
    setLoading(true);
    setRetryCount(prev => prev + 1);
  };

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
            {isAdmin && material?.download_allowed && (
              <Pressable
                style={styles.actionBtn}
                onPress={() => {
                  if (Platform.OS === "web") {
                    window.open(material.file_url, "_blank");
                  } else {
                    const { Linking } = require("react-native");
                    Linking.openURL(material.file_url);
                  }
                }}
              >
                <Ionicons name="download-outline" size={20} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {fetchError ? (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={48} color={Colors.light.accent} />
            <Text style={styles.errorTitle}>Failed to load material</Text>
            <Text style={styles.errorSub}>Please check your connection and try again.</Text>
            <Pressable style={styles.retryBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={16} color="#fff" />
              <Text style={styles.retryBtnText}>Go Back</Text>
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
            <Text style={styles.errorSub}>This file can't be previewed right now.</Text>
            <Pressable style={styles.retryBtn} onPress={handleRetry}>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.retryBtnText}>Try Again</Text>
            </Pressable>
          </View>
        ) : Platform.OS === "web" ? (
          <iframe
            key={`pdf-frame-${retryCount}`}
            src={viewUrl}
            style={{ width: "100%", height: "100%", border: "none" } as any}
            title={material.title}
            onLoad={() => setLoading(false)}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <WebView
            key={`webview-${retryCount}`}
            source={{ uri: viewUrl }}
            style={styles.webview}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true); }}
            onHttpError={(e) => {
              if (e.nativeEvent.statusCode >= 400) {
                setLoading(false);
                setError(true);
              }
            }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            allowsInlineMediaPlayback
            mixedContentMode="compatibility"
            allowsFullscreenVideo
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
            userAgent="Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
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
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.light.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  webview: { flex: 1 },
  webviewLoading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
  webLoadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
});
