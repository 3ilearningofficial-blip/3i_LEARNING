import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator, TextInput, FlatList, KeyboardAvoidingView,
  Dimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

function getYouTubeVideoId(url: string): string {
  if (!url) return "";
  let decoded = url;
  try { decoded = decodeURIComponent(decodeURIComponent(url)); } catch { try { decoded = decodeURIComponent(url); } catch {} }
  decoded = decoded.trim();
  try {
    const parsed = new URL(decoded);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1).split("?")[0].split("/")[0];
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtube-nocookie.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v")!;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] || "";
      for (const p of parts) {
        if (/^[A-Za-z0-9_-]{11}$/.test(p) && !["watch", "channel"].includes(p) && !p.startsWith("@")) return p;
      }
    }
  } catch {}
  const m = decoded.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  if (m?.[1]) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(decoded)) return decoded;
  return "";
}

function buildYouTubeHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
.wrapper { position: relative; width: 100%; height: 100%; overflow: hidden; }
iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; }
.cover-top {
  position: absolute; top: 0; left: 0; right: 0;
  height: 52px; background: #000;
  z-index: 50; pointer-events: auto;
  cursor: default;
}
.cover-top-right {
  position: absolute; top: 0; right: 0;
  width: 180px; height: 52px;
  background: #000;
  z-index: 51; pointer-events: auto;
  cursor: default;
}
.cover-bottom-right {
  position: absolute; bottom: 0; right: 60px;
  width: 80px; height: 36px;
  background: transparent; z-index: 50;
  pointer-events: auto; cursor: default;
}
</style>
</head><body>
<div class="wrapper">
<div class="cover-top"></div>
<div class="cover-top-right"></div>
<iframe
  src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&showinfo=0&iv_load_policy=3&cc_load_policy=0&fs=1&controls=1"
  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  allowfullscreen
></iframe>
<div class="cover-bottom-right"></div>
</div>
<script>document.addEventListener('contextmenu', function(e) { e.preventDefault(); });</script>
</body></html>`;
}

interface ChatMsg {
  id: number;
  live_class_id: number;
  user_id: number;
  user_name: string;
  message: string;
  is_admin: boolean;
  created_at: number;
}

export default function LiveClassScreen() {
  const { id, videoUrl, title } = useLocalSearchParams<{
    id: string; videoUrl: string; title: string;
  }>();
  const insets = useSafeAreaInsets();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [chatMsg, setChatMsg] = useState("");
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const chatListRef = useRef<FlatList>(null);
  const lastMsgTimeRef = useRef<number>(0);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;
  const screenHeight = Dimensions.get("window").height;
  const videoHeight = Math.min(screenHeight * 0.35, 280);

  const videoId = getYouTubeVideoId(videoUrl || "");
  const youtubeHtml = videoId ? buildYouTubeHtml(videoId) : "";

  const { data: chatMessages = [], refetch: refetchChat } = useQuery<ChatMsg[]>({
    queryKey: [`/api/live-classes/${id}/chat`],
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (chatMessages.length > 0) {
      const latestTime = chatMessages[chatMessages.length - 1].created_at;
      if (latestTime > lastMsgTimeRef.current) {
        lastMsgTimeRef.current = latestTime;
        setTimeout(() => {
          chatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    }
  }, [chatMessages]);

  const sendMsgMutation = useMutation({
    mutationFn: async (msg: string) => {
      return apiRequest("POST", `/api/live-classes/${id}/chat`, { message: msg });
    },
    onSuccess: () => {
      setChatMsg("");
      refetchChat();
    },
  });

  const deleteMsgMutation = useMutation({
    mutationFn: async (msgId: number) => {
      return apiRequest("DELETE", `/api/admin/live-classes/${id}/chat/${msgId}`);
    },
    onSuccess: () => refetchChat(),
  });

  const handleSend = useCallback(() => {
    const msg = chatMsg.trim();
    if (!msg) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMsgMutation.mutate(msg);
  }, [chatMsg]);

  const renderChatItem = useCallback(({ item }: { item: ChatMsg }) => (
    <View style={[chatStyles.msgRow, item.is_admin && chatStyles.adminMsgRow]}>
      <View style={[chatStyles.avatar, item.is_admin && chatStyles.adminAvatar]}>
        <Text style={chatStyles.avatarText}>
          {item.is_admin ? "T" : (item.user_name?.charAt(0) || "S").toUpperCase()}
        </Text>
      </View>
      <View style={[chatStyles.msgBubble, item.is_admin && chatStyles.adminBubble]}>
        <View style={chatStyles.msgHeader}>
          <Text style={[chatStyles.msgName, item.is_admin && chatStyles.adminName]}>
            {item.is_admin ? "Pankaj Sir" : item.user_name}
          </Text>
          {item.is_admin && (
            <View style={chatStyles.teacherBadge}>
              <Text style={chatStyles.teacherBadgeText}>TEACHER</Text>
            </View>
          )}
          <Text style={chatStyles.msgTime}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
        <Text style={chatStyles.msgText}>{item.message}</Text>
      </View>
      {isAdmin && (
        <Pressable
          style={chatStyles.deleteBtn}
          onPress={() => deleteMsgMutation.mutate(item.id)}
        >
          <Ionicons name="close" size={14} color="#999" />
        </Pressable>
      )}
    </View>
  ), [isAdmin]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{title || "Live Class"}</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <View style={[styles.playerContainer, { height: videoHeight }]}>
        {isVideoLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
          </View>
        )}
        {youtubeHtml && Platform.OS === "web" ? (
          <iframe
            srcDoc={youtubeHtml}
            style={{ width: "100%", height: "100%", border: "none", position: "absolute", top: 0, left: 0 } as any}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            onLoad={() => setIsVideoLoading(false)}
          />
        ) : youtubeHtml ? (
          <WebView
            source={{ html: youtubeHtml, baseUrl: "https://www.youtube-nocookie.com" }}
            style={{ flex: 1, backgroundColor: "#000" }}
            onLoad={() => setIsVideoLoading(false)}
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            scrollEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="compatibility"
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
          />
        ) : (
          <View style={styles.noVideoOverlay}>
            <Ionicons name="videocam-off-outline" size={32} color="#666" />
            <Text style={styles.noVideoText}>No video available</Text>
          </View>
        )}
      </View>

      <View style={styles.chatContainer}>
        <View style={styles.chatHeader}>
          <Ionicons name="chatbubbles" size={18} color={Colors.light.primary} />
          <Text style={styles.chatHeaderText}>Live Chat</Text>
          <Text style={styles.chatCount}>{chatMessages.length}</Text>
        </View>

        <FlatList
          ref={chatListRef}
          data={chatMessages}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderChatItem}
          style={styles.chatList}
          contentContainerStyle={styles.chatListContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons name="chatbubble-ellipses-outline" size={28} color="#ccc" />
              <Text style={styles.emptyChatText}>No messages yet. Say hello!</Text>
            </View>
          }
        />

        <View style={[styles.inputRow, { paddingBottom: Math.max(bottomPadding, 8) }]}>
          <TextInput
            style={styles.chatInput}
            value={chatMsg}
            onChangeText={setChatMsg}
            placeholder="Ask a doubt or say hi..."
            placeholderTextColor="#999"
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            style={[styles.sendBtn, !chatMsg.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!chatMsg.trim() || sendMsgMutation.isPending}
          >
            {sendMsgMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingBottom: 8, backgroundColor: "#0A1628",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  liveIndicator: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#DC2626", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 1 },
  headerTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff", flex: 1 },
  playerContainer: {
    width: "100%", backgroundColor: "#000", position: "relative", overflow: "hidden",
  },
  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#000", alignItems: "center", justifyContent: "center", zIndex: 10,
  },
  noVideoOverlay: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 8,
  },
  noVideoText: { color: "#666", fontFamily: "Inter_400Regular", fontSize: 13 },
  chatContainer: { flex: 1, backgroundColor: Colors.light.background },
  chatHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  chatHeaderText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text, flex: 1 },
  chatCount: {
    fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted,
    backgroundColor: Colors.light.secondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  chatList: { flex: 1 },
  chatListContent: { padding: 12, gap: 8 },
  emptyChat: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  emptyChatText: { fontSize: 13, color: "#999", fontFamily: "Inter_400Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  chatInput: {
    flex: 1, backgroundColor: Colors.light.secondary,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text,
    maxHeight: 80,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#ccc" },
});

const chatStyles = StyleSheet.create({
  msgRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  adminMsgRow: {},
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center",
  },
  adminAvatar: { backgroundColor: "#FEF3C7" },
  avatarText: { fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.textMuted },
  msgBubble: {
    flex: 1, backgroundColor: Colors.light.secondary,
    borderRadius: 12, padding: 10, borderTopLeftRadius: 4,
  },
  adminBubble: { backgroundColor: "#FEF3C7" },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  msgName: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  adminName: { color: "#B45309" },
  teacherBadge: {
    backgroundColor: "#F59E0B", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3,
  },
  teacherBadgeText: { fontSize: 8, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 0.5 },
  msgTime: { fontSize: 10, color: "#999", fontFamily: "Inter_400Regular", marginLeft: "auto" as any },
  msgText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.text, lineHeight: 18 },
  deleteBtn: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
});
