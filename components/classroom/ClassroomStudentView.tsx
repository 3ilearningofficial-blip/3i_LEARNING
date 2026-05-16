import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import { filterChatMessages } from "@/lib/chat-utils";
import TldrawClassroom from "@/components/classroom/TldrawClassroom";
import TeacherVideoPiP from "@/components/classroom/TeacherVideoPiP";
import Colors from "@/constants/colors";

type ChatMsg = {
  id: number;
  user_id: number;
  user_name: string;
  message: string;
  is_admin: boolean;
  created_at: number;
};

type Props = {
  liveClassId: string;
  title: string;
  showAsLiveUI: boolean;
  isCompleted: boolean;
  chatMode?: string;
  topPadding: number;
  bottomPadding: number;
};

export default function ClassroomStudentView({
  liveClassId,
  title,
  showAsLiveUI,
  isCompleted,
  chatMode = "public",
  topPadding,
  bottomPadding,
}: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsg, setChatMsg] = useState("");
  const [handRaised, setHandRaised] = useState(false);
  const listRef = useRef<FlatList>(null);

  const canInteract = showAsLiveUI && !isCompleted;

  const { data: messages = [] } = useQuery<ChatMsg[]>({
    queryKey: [`/api/live-classes/${liveClassId}/chat`],
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${liveClassId}/chat`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: canInteract ? 3000 : false,
    enabled: !!liveClassId,
  });

  const displayMessages = filterChatMessages(
    messages,
    user?.id ?? 0,
    false,
    (chatMode as "public" | "private") || "public"
  );

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      await apiRequest("POST", `/api/live-classes/${liveClassId}/chat`, { message });
    },
    onSuccess: () => {
      setChatMsg("");
      qc.invalidateQueries({ queryKey: [`/api/live-classes/${liveClassId}/chat`] });
    },
  });

  const handMutation = useMutation({
    mutationFn: async (raise: boolean) => {
      if (raise) {
        await apiRequest("POST", `/api/live-classes/${liveClassId}/raise-hand`, {});
      } else {
        await apiRequest("DELETE", `/api/live-classes/${liveClassId}/raise-hand`);
      }
    },
    onSuccess: (_d, raise) => setHandRaised(raise),
  });

  useEffect(() => {
    if (!canInteract) return;
    const t = setInterval(() => {
      void apiRequest("POST", `/api/live-classes/${liveClassId}/viewers/heartbeat`, {});
    }, 8000);
    void apiRequest("POST", `/api/live-classes/${liveClassId}/viewers/heartbeat`, {});
    return () => clearInterval(t);
  }, [liveClassId, canInteract]);

  const handleSend = useCallback(() => {
    const t = chatMsg.trim();
    if (!t || !canInteract) return;
    sendMutation.mutate(t);
  }, [chatMsg, canInteract, sendMutation]);

  if (Platform.OS !== "web") {
    return (
      <View style={[styles.nativeGate, { paddingTop: topPadding }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={styles.nativeTitle}>{title}</Text>
        <Text style={styles.nativeText}>
          Interactive classroom is available in the mobile browser. Open this class on 3i Learning web to see the live board and teacher video.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root}>
      <View style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {showAsLiveUI && !isCompleted ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.stage}>
        {!showAsLiveUI && !isCompleted ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={Colors.light.primary} />
            <Text style={styles.waitingText}>Waiting for teacher to start…</Text>
          </View>
        ) : showAsLiveUI || isCompleted ? (
          <>
            <TldrawClassroom liveClassId={liveClassId} readonly />
            {showAsLiveUI && !isCompleted ? <TeacherVideoPiP liveClassId={liveClassId} enabled /> : null}
          </>
        ) : null}
      </View>

      {chatOpen ? (
        <View style={[styles.chatSheet, { paddingBottom: bottomPadding }]}>
          <View style={styles.chatSheetHeader}>
            <Text style={styles.chatSheetTitle}>Live chat</Text>
            <Pressable onPress={() => setChatOpen(false)}>
              <Ionicons name="close" size={22} color={Colors.light.text} />
            </Pressable>
          </View>
          <FlatList
            ref={listRef}
            data={displayMessages}
            keyExtractor={(m) => String(m.id)}
            style={styles.chatList}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.is_admin && styles.bubbleAdmin]}>
                <Text style={styles.bubbleName}>{item.user_name}</Text>
                <Text style={styles.bubbleText}>{item.message}</Text>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyChat}>No messages yet. Ask your doubt here.</Text>
            }
          />
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              value={chatMsg}
              onChangeText={setChatMsg}
              placeholder={canInteract ? "Ask a doubt…" : "Chat closed"}
              editable={canInteract}
              onSubmitEditing={handleSend}
            />
            <Pressable
              style={[styles.sendBtn, !chatMsg.trim() && styles.sendDisabled]}
              onPress={handleSend}
              disabled={!canInteract || !chatMsg.trim()}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={[styles.floatingBar, { bottom: bottomPadding + 12 }]}>
        <Pressable
          style={[styles.fab, handRaised && styles.fabActive]}
          onPress={() => handMutation.mutate(!handRaised)}
          disabled={!canInteract}
        >
          <Text style={{ fontSize: 20 }}>✋</Text>
        </Pressable>
        <Pressable style={styles.fab} onPress={() => setChatOpen((v) => !v)}>
          <Ionicons name="chatbubbles" size={22} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: "#0A1628",
    zIndex: 30,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: "#fff" },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DC2626",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveText: { fontSize: 10, fontWeight: "800", color: "#fff" },
  stage: { flex: 1, position: "relative" },
  waiting: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  waitingText: { color: "#9CA3AF", fontSize: 14 },
  floatingBar: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    gap: 12,
    backgroundColor: "rgba(30,30,30,0.92)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 28,
    zIndex: 25,
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  fabActive: { backgroundColor: Colors.light.primary },
  chatSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "45%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    zIndex: 40,
    paddingTop: 12,
  },
  chatSheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  chatSheetTitle: { fontSize: 16, fontWeight: "700", color: Colors.light.text },
  chatList: { flex: 1, paddingHorizontal: 12 },
  bubble: {
    backgroundColor: "#F3F4F6",
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
    maxWidth: "90%",
  },
  bubbleAdmin: { backgroundColor: "#EDE9FE", alignSelf: "flex-start" },
  bubbleName: { fontSize: 11, fontWeight: "700", color: Colors.light.primary, marginBottom: 2 },
  bubbleText: { fontSize: 14, color: Colors.light.text },
  emptyChat: { textAlign: "center", color: Colors.light.textMuted, marginTop: 24 },
  chatInputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  chatInput: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.5 },
  nativeGate: { flex: 1, backgroundColor: "#0A1628", padding: 20 },
  nativeTitle: { fontSize: 18, fontWeight: "700", color: "#fff", marginTop: 16 },
  nativeText: { fontSize: 14, color: "#9CA3AF", marginTop: 12, lineHeight: 20 },
});
