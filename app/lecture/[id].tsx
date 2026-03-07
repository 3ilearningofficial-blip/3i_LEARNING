import React, { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator, Alert, ScrollView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

function getYouTubeVideoId(url: string): string {
  if (!url) return "";
  let decoded = url;
  try { decoded = decodeURIComponent(decodeURIComponent(url)); } catch { try { decoded = decodeURIComponent(url); } catch {} }
  decoded = decoded.trim();
  try {
    const parsed = new URL(decoded);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1).split("?")[0].split("/")[0];
    }
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtube-nocookie.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v")!;
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "embed" || pathParts[0] === "shorts" || pathParts[0] === "live") {
        return pathParts[1] || "";
      }
      if (pathParts.length >= 2 && pathParts[pathParts.length - 2] === "live") {
        return pathParts[pathParts.length - 1] || "";
      }
      for (const part of pathParts) {
        if (/^[A-Za-z0-9_-]{11}$/.test(part) && part !== "watch" && part !== "channel" && !part.startsWith("@")) {
          return part;
        }
      }
    }
  } catch {}
  const match = decoded.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  if (match?.[1]) return match[1];
  const simpleMatch = decoded.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (simpleMatch?.[1]) return simpleMatch[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(decoded)) return decoded;
  return "";
}

function buildYouTubeHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
#player { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="player"></div>
<script>
var tag = document.createElement('script');
tag.src = "https://www.youtube-nocookie.com/iframe_api";
document.head.appendChild(tag);
function onYouTubeIframeAPIReady() {
  new YT.Player('player', {
    videoId: '${videoId}',
    playerVars: {
      autoplay: 1,
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      showinfo: 0,
      fs: 1,
      iv_load_policy: 3,
      disablekb: 0,
      origin: window.location.origin
    },
    events: {
      onReady: function(e) { e.target.playVideo(); }
    }
  });
}
</script>
</body>
</html>`;
}

export default function LectureScreen() {
  const { id, courseId, videoUrl, title } = useLocalSearchParams<{
    id: string; courseId: string; videoUrl: string; title: string;
  }>();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasError, setHasError] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const videoId = getYouTubeVideoId(videoUrl || "");
  const youtubeHtml = videoId ? buildYouTubeHtml(videoId) : "";

  const handleMarkComplete = async () => {
    try {
      await apiRequest("POST", `/api/lectures/${id}/progress`, {
        courseId: courseId ? parseInt(courseId) : undefined,
        watchPercent: 100,
        isCompleted: true,
      });
      setIsCompleted(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Lecture Completed!", "Your progress has been saved.", [
        { text: "Continue", onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert("Error", "Failed to save progress.");
    }
  };

  const preventScreenCapture = `
    (function() {
      document.addEventListener('contextmenu', function(e){ e.preventDefault(); return false; });
    })();
    true;
  `;

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#000"]} style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.headerTitle}>
            <Text style={styles.lectureTitleText} numberOfLines={2}>{title || "Lecture"}</Text>
          </View>
          {isCompleted ? (
            <View style={styles.completedBadge}>
              <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
            </View>
          ) : <View style={{ width: 36 }} />}
        </View>
      </LinearGradient>

      <View style={styles.playerContainer}>
        {isLoading && !hasError && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading video...</Text>
          </View>
        )}
        {hasError && (
          <View style={styles.errorOverlay}>
            <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
            <Text style={styles.errorTitle}>Video unavailable</Text>
            <Text style={styles.errorSub}>Check your internet connection and try again.</Text>
            <Pressable style={styles.retryBtn} onPress={() => { setHasError(false); setIsLoading(true); }}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        )}
        {!hasError && youtubeHtml && Platform.OS === "web" ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&cc_load_policy=0&fs=1`}
            style={{ width: "100%", height: "100%", border: "none", position: "absolute", top: 0, left: 0 } as any}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            onLoad={() => setIsLoading(false)}
          />
        ) : !hasError && youtubeHtml && Platform.OS !== "web" ? (
          <WebView
            source={{ html: youtubeHtml, baseUrl: "https://www.youtube-nocookie.com" }}
            style={styles.webView}
            onLoad={() => setIsLoading(false)}
            onError={() => { setIsLoading(false); setHasError(true); }}
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            injectedJavaScript={preventScreenCapture}
            allowsInlineMediaPlayback
            scrollEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={["*"]}
          />
        ) : !hasError && !youtubeHtml ? (
          <View style={styles.errorOverlay}>
            <Ionicons name="videocam-off-outline" size={40} color={Colors.light.textMuted} />
            <Text style={styles.errorTitle}>No video available</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        style={styles.infoSection}
        contentContainerStyle={[styles.infoContent, { paddingBottom: bottomPadding + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lectureInfoTitle}>{title || "Lecture"}</Text>
        <Text style={styles.lectureInfoSub}>Take notes and pause as needed for better understanding.</Text>

        <View style={styles.securityNotice}>
          <Ionicons name="shield-checkmark" size={16} color={Colors.light.primary} />
          <Text style={styles.securityText}>Content protection is active. Recording & screenshots are restricted.</Text>
        </View>

        {!isCompleted && (
          <Pressable
            style={({ pressed }) => [styles.completeBtn, pressed && { opacity: 0.9 }]}
            onPress={handleMarkComplete}
          >
            <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.completeBtnGradient}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.completeBtnText}>Mark as Complete</Text>
            </LinearGradient>
          </Pressable>
        )}

        {isCompleted && (
          <View style={styles.completedBanner}>
            <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
            <Text style={styles.completedBannerText}>Lecture completed! Great work!</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1 },
  lectureTitleText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  completedBadge: { width: 36, alignItems: "center" },
  playerContainer: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000", position: "relative" },
  webView: { flex: 1, backgroundColor: "#000" },
  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#000", alignItems: "center", justifyContent: "center", gap: 12, zIndex: 10,
  },
  loadingText: { color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", fontSize: 13 },
  errorOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, zIndex: 10,
  },
  errorTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff", textAlign: "center" },
  errorSub: { fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { backgroundColor: Colors.light.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  infoSection: { flex: 1, backgroundColor: Colors.light.background },
  infoContent: { padding: 20, gap: 14 },
  lectureInfoTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  lectureInfoSub: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 18 },
  securityNotice: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.light.secondary, borderRadius: 10, padding: 10,
  },
  securityText: { fontSize: 12, color: Colors.light.primary, fontFamily: "Inter_500Medium", flex: 1 },
  completeBtn: { borderRadius: 14, overflow: "hidden" },
  completeBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 8 },
  completeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  completedBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#DCFCE7", borderRadius: 12, padding: 14,
  },
  completedBannerText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#15803D", flex: 1 },
});
