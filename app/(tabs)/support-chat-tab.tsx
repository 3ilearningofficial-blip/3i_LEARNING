import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, Platform, KeyboardAvoidingView, Modal, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

type Message = {
  id: number;
  sender: "user" | "admin";
  message: string;
  is_read: boolean;
  created_at: number | string;
};

export default function SupportChatTab() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [text, setText] = useState("");
  const [chatAuthLost, setChatAuthLost] = useState(false);

  // Admin state
  const [adminSelectedUserId, setAdminSelectedUserId] = useState<number | null>(null);
  const [adminSelectedUserName, setAdminSelectedUserName] = useState("");
  const [adminReply, setAdminReply] = useState("");
  const [adminReplying, setAdminReplying] = useState(false);
  const adminScrollRef = useRef<ScrollView>(null);

  const { data: adminConvos = [], isLoading: adminConvosLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/support/conversations"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/admin/support/conversations", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdmin,
    staleTime: 60000,
    refetchInterval: isAdmin ? 45000 : false,
    refetchOnMount: false,
  });

  const { data: adminMessages = [], isLoading: adminMsgLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/support/messages", adminSelectedUserId],
    queryFn: async () => {
      if (!adminSelectedUserId) return [];
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/admin/support/messages/${adminSelectedUserId}`, baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdmin && adminSelectedUserId !== null,
    staleTime: 15000,
    refetchInterval: isAdmin && adminSelectedUserId !== null ? 15000 : false,
    refetchOnMount: false,
  });

  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    if (adminMessages.length > 0) {
      scrollTimer = setTimeout(() => adminScrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, [adminMessages.length]);

  const sendAdminReply = async () => {
    if (!adminReply.trim() || !adminSelectedUserId) return;
    setAdminReplying(true);
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/admin/support/messages/${adminSelectedUserId}`, baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: adminReply.trim() }),
      });
      if (!res.ok) {
        throw new Error("Failed to send reply");
      }
      setAdminReply("");
      qc.invalidateQueries({ queryKey: ["/api/admin/support/messages", adminSelectedUserId] });
      qc.invalidateQueries({ queryKey: ["/api/admin/support/conversations"] });
    } catch (_e) {
      Alert.alert("Error", "Failed to send reply. Please try again.");
    } finally {
      setAdminReplying(false);
    }
  };

  if (isAdmin) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 16 : insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerAvatar}>
            <Ionicons name="headset" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Support Inbox</Text>
            <Text style={styles.headerSub}>Tap a conversation to reply</Text>
          </View>
        </View>

        {/* Conversations list */}
        {adminConvosLoading ? (
          <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />
        ) : adminConvos.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="chatbubbles-outline" size={52} color={Colors.light.textMuted} />
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySub}>Student support messages will appear here.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }} showsVerticalScrollIndicator={false}>
            {adminConvos.map((convo: any) => (
              <Pressable
                key={convo.user_id}
                style={({ pressed }) => [adminStyles.convoCard, pressed && { opacity: 0.85 }]}
                onPress={() => { setAdminSelectedUserId(convo.user_id); setAdminSelectedUserName(convo.name || convo.phone || "Student"); }}
              >
                <View style={adminStyles.convoAvatar}>
                  <Text style={adminStyles.convoAvatarText}>{(convo.name || "S")[0].toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={adminStyles.convoName}>{convo.name || convo.phone || "Student"}</Text>
                  <Text style={adminStyles.convoLast} numberOfLines={1}>{convo.last_message || ""}</Text>
                </View>
                {parseInt(convo.unread_count) > 0 && (
                  <View style={adminStyles.unreadBadge}>
                    <Text style={adminStyles.unreadText}>{convo.unread_count}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={Colors.light.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Thread — full-screen modal, input pinned at bottom */}
        <Modal visible={!!adminSelectedUserId} animationType="slide" onRequestClose={() => { setAdminSelectedUserId(null); setAdminSelectedUserName(""); setAdminReply(""); }}>
          <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#F0F4FF" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            {/* Header */}
            <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: Platform.OS === "web" ? 16 : insets.top + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => { setAdminSelectedUserId(null); setAdminSelectedUserName(""); setAdminReply(""); }}>
                <Ionicons name="arrow-back" size={20} color="#fff" />
              </Pressable>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>{(adminSelectedUserName || "S")[0].toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>{adminSelectedUserName}</Text>
                <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>Student</Text>
              </View>
            </LinearGradient>
            {/* Messages */}
            {adminMsgLoading ? (
              <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />
            ) : (
              <ScrollView
                ref={adminScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={styles.messageList}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => adminScrollRef.current?.scrollToEnd({ animated: false })}
              >
                {adminMessages.length === 0 && (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptySub}>No messages yet</Text>
                  </View>
                )}
                {adminMessages.map((msg: any) => {
                  const isAdminMsg = msg.sender === "admin";
                  const ts = typeof msg.created_at === "string" ? parseInt(msg.created_at) : msg.created_at;
                  const time = ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                  return (
                    <View key={msg.id} style={[styles.bubble, isAdminMsg ? styles.bubbleMe : styles.bubbleThem]}>
                      {!isAdminMsg && <Text style={styles.senderLabel}>{adminSelectedUserName}</Text>}
                      <Text style={[styles.bubbleText, isAdminMsg ? styles.bubbleTextMe : styles.bubbleTextThem]}>{msg.message}</Text>
                      <View style={styles.bubbleMeta}>
                        <Text style={[styles.bubbleTime, isAdminMsg ? styles.bubbleTimeMe : styles.bubbleTimeThem]}>{time}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            {/* Input pinned at bottom */}
            <View style={[styles.inputRow, { paddingBottom: Platform.OS === "web" ? 16 : insets.bottom + 16 }]}>
              <TextInput
                style={styles.input}
                placeholder="Type your reply..."
                placeholderTextColor={Colors.light.textMuted}
                value={adminReply}
                onChangeText={setAdminReply}
                multiline
                maxLength={1000}
              />
              <Pressable
                style={[styles.sendBtn, (!adminReply.trim() || adminReplying) && styles.sendBtnDisabled]}
                onPress={sendAdminReply}
                disabled={!adminReply.trim() || adminReplying}
              >
                {adminReplying ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    );
  }

  const { data: messages = [], isLoading } = useQuery<Message[]>({
    queryKey: ["/api/support/messages"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/support/messages", baseUrl).toString());
      if (res.status === 401) {
        setChatAuthLost(true);
        return [];
      }
      if (!res.ok) return [];
      setChatAuthLost(false);
      return res.json();
    },
    enabled: !!user && !isAdmin && !chatAuthLost,
    staleTime: 30000,
    refetchInterval: !!user && !chatAuthLost ? 20000 : false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/support/messages", { message });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/support/messages"] });
      setText("");
    },
  });

  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    if (messages.length > 0) {
      scrollTimer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, [messages.length]);

  const formatTime = (ts: number | string) => {
    const n = typeof ts === "string" ? parseInt(ts) : ts;
    if (!n || isNaN(n)) return "";
    return new Date(n).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (ts: number | string) => {
    const n = typeof ts === "string" ? parseInt(ts) : ts;
    if (!n || isNaN(n)) return "Today";
    const d = new Date(n);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  };

  const grouped: { date: string; msgs: Message[] }[] = [];
  for (const msg of messages) {
    const dateStr = formatDate(msg.created_at);
    const last = grouped[grouped.length - 1];
    if (last && last.date === dateStr) last.msgs.push(msg);
    else grouped.push({ date: dateStr, msgs: [msg] });
  }

  /** Clearance above the bottom tab bar — keep modest so the composer sits near the bar, not floating high. */
  const TAB_BAR_CLEARANCE = Platform.OS === "android" ? 52 : Platform.OS === "web" ? 56 : 52;
  const composerBottomPadding =
    Platform.OS === "web"
      ? 8
      : TAB_BAR_CLEARANCE + Math.max(insets.bottom, 6);

  return (
    <View style={{ flex: 1, backgroundColor: "#F0F4FF" }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 16 : insets.top + 8 }]}>
        <View style={styles.headerAvatar}>
          <Ionicons name="headset" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Support Chat</Text>
          <Text style={styles.headerSub}>3i Learning Team · We reply within 24h</Text>
        </View>
      </View>

      {/* Messages */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.light.primary} />
        </View>
      ) : chatAuthLost ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }}>
          <Ionicons name="lock-closed-outline" size={44} color={Colors.light.textMuted} />
          <Text style={[styles.emptyTitle, { marginTop: 10 }]}>Session expired</Text>
          <Text style={styles.emptySub}>Please login again to use Support Chat.</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 8, gap: 2, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60 }}>
              <Ionicons name="chatbubbles-outline" size={52} color={Colors.light.textMuted} />
              <Text style={styles.emptyTitle}>Start a conversation</Text>
              <Text style={styles.emptySub}>Send us a message and we'll get back to you shortly.</Text>
            </View>
          )}
          {grouped.map(({ date, msgs }) => (
            <View key={date}>
              <View style={styles.dateDivider}>
                <Text style={styles.dateDividerText}>{date}</Text>
              </View>
              {msgs.map((msg) => {
                const isMe = msg.sender === "user";
                return (
                  <View key={msg.id} style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                    {!isMe && <Text style={styles.senderLabel}>Support Team</Text>}
                    <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextThem]}>
                      {msg.message}
                    </Text>
                    <View style={styles.bubbleMeta}>
                      <Text style={[styles.bubbleTime, isMe ? styles.bubbleTimeMe : styles.bubbleTimeThem]}>
                        {formatTime(msg.created_at)}
                      </Text>
                      {isMe && (
                        <Ionicons
                          name={msg.is_read ? "checkmark-done" : "checkmark"}
                          size={14}
                          color={msg.is_read ? "#60A5FA" : "rgba(255,255,255,0.55)"}
                          style={{ marginLeft: 3 }}
                        />
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Input — sits above tab bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? TAB_BAR_CLEARANCE + insets.bottom : 0}
      >
        <View style={[styles.inputRow, { paddingBottom: composerBottomPadding }]}>
          <TextInput
            style={styles.input}
            placeholder="Type your message..."
            placeholderTextColor={Colors.light.textMuted}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            editable={!chatAuthLost}
          />
          <Pressable
            style={[styles.sendBtn, (!text.trim() || sendMutation.isPending) && styles.sendBtnDisabled]}
            onPress={() => text.trim() && sendMutation.mutate(text.trim())}
            disabled={!text.trim() || sendMutation.isPending || chatAuthLost}
          >
            {sendMutation.isPending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={18} color="#fff" />
            }
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F4FF" },
  header: {
    backgroundColor: "#0A1628",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 14,
  },
  headerAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.light.primary,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)" },
  messageList: { padding: 16, gap: 2, flexGrow: 1 },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 80 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "center", paddingHorizontal: 20 },
  dateDivider: { alignItems: "center", marginVertical: 10 },
  dateDividerText: {
    fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted,
    backgroundColor: "#DDE4F0", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
  },
  bubble: {
    maxWidth: "78%", borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 4,
  },
  bubbleMe: {
    alignSelf: "flex-end", backgroundColor: Colors.light.primary,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    alignSelf: "flex-start", backgroundColor: "#fff",
    borderBottomLeftRadius: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 2, elevation: 1,
  },
  senderLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.light.primary, marginBottom: 2 },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  bubbleTextMe: { color: "#fff" },
  bubbleTextThem: { color: Colors.light.text },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 3 },
  bubbleTimeMe: { color: "rgba(255,255,255,0.6)", textAlign: "right" },
  bubbleTimeThem: { color: Colors.light.textMuted },
  bubbleMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 3 },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: Colors.light.border,
  },
  input: {
    flex: 1, backgroundColor: Colors.light.secondary, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text,
    maxHeight: 100, borderWidth: 1, borderColor: Colors.light.border,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.light.primary,
    alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
});

const adminStyles = StyleSheet.create({
  convoCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
    marginBottom: 8,
  },
  convoAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.light.primary,
    alignItems: "center", justifyContent: "center",
  },
  convoAvatarText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  convoName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  convoLast: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 },
  unreadBadge: {
    backgroundColor: "#EF4444", borderRadius: 10,
    minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  unreadText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
});
