import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator, TextInput, FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import { filterChatMessages, ChatMessage } from "@/lib/chat-utils";
import Colors from "@/constants/colors";

interface LiveChatPanelProps {
  liveClassId: string;
  chatMode: "public" | "private";
  isAdmin: boolean;
}

interface HandRaise {
  id: number;
  userId: number;
  userName: string;
  raisedAt: number;
}

function useVoiceInput(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setSupported(!!SR);
    }
  }, []);

  const startListening = useCallback(() => {
    if (Platform.OS !== "web") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      onResult(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [onResult]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, startListening, stopListening, supported };
}

export default function LiveChatPanel({ liveClassId, chatMode, isAdmin }: LiveChatPanelProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [chatMsg, setChatMsg] = useState("");
  const [handRaised, setHandRaised] = useState(false);
  const chatListRef = useRef<FlatList>(null);
  const lastMsgTimeRef = useRef<number>(0);

  // Poll chat messages every 3 seconds
  const { data: rawMessages = [], refetch: refetchChat } = useQuery<ChatMessage[]>({
    queryKey: [`/api/live-classes/${liveClassId}/chat`],
    refetchInterval: 3000,
  });

  // Filter messages based on chat mode
  const chatMessages = filterChatMessages(
    rawMessages,
    user?.id ?? 0,
    isAdmin,
    chatMode,
  );

  // Admin: poll raised hands every 5 seconds
  const { data: raisedHands = [], refetch: refetchHands } = useQuery<HandRaise[]>({
    queryKey: [`/api/admin/live-classes/${liveClassId}/raised-hands`],
    enabled: isAdmin,
    refetchInterval: 5000,
  });

  // Auto-scroll on new messages
  useEffect(() => {
    if (chatMessages.length > 0) {
      const latestTime = Number(chatMessages[chatMessages.length - 1].created_at);
      if (latestTime > lastMsgTimeRef.current) {
        lastMsgTimeRef.current = latestTime;
        setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);
      }
    }
  }, [chatMessages]);

  const sendMsgMutation = useMutation({
    mutationFn: (msg: string) =>
      apiRequest("POST", `/api/live-classes/${liveClassId}/chat`, { message: msg }),
    onSuccess: () => { setChatMsg(""); refetchChat(); },
  });

  const deleteMsgMutation = useMutation({
    mutationFn: (msgId: number) =>
      apiRequest("DELETE", `/api/admin/live-classes/${liveClassId}/chat/${msgId}`),
    onSuccess: () => refetchChat(),
  });

  const raiseHandMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/live-classes/${liveClassId}/raise-hand`, {}),
    onSuccess: () => { setHandRaised(true); refetchHands(); },
  });

  const lowerHandMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/live-classes/${liveClassId}/raise-hand`),
    onSuccess: () => { setHandRaised(false); refetchHands(); },
  });

  const resolveHandMutation = useMutation({
    mutationFn: (userId: number) =>
      apiRequest("POST", `/api/admin/live-classes/${liveClassId}/raised-hands/${userId}/resolve`, {}),
    onSuccess: () => refetchHands(),
  });

  const handleSend = useCallback(() => {
    const msg = chatMsg.trim();
    if (!msg) return;
    sendMsgMutation.mutate(msg);
  }, [chatMsg]);

  const { isListening, startListening, stopListening, supported: voiceSupported } = useVoiceInput(
    (text) => setChatMsg((prev) => (prev ? prev + " " + text : text)),
  );

  const handleHandRaise = useCallback(() => {
    if (handRaised) lowerHandMutation.mutate();
    else raiseHandMutation.mutate();
  }, [handRaised]);

  const renderChatItem = useCallback(({ item }: { item: ChatMessage }) => (
    <View style={[styles.msgRow]}>
      <View style={[styles.avatar, item.is_admin && styles.adminAvatar]}>
        <Text style={styles.avatarText}>
          {item.is_admin ? "T" : (item.user_name?.charAt(0) || "S").toUpperCase()}
        </Text>
      </View>
      <View style={[styles.msgBubble, item.is_admin && styles.adminBubble]}>
        <View style={styles.msgHeader}>
          <Text style={[styles.msgName, item.is_admin && styles.adminName]}>
            {item.is_admin ? "Teacher" : item.user_name}
          </Text>
          {item.is_admin && (
            <View style={styles.teacherBadge}>
              <Text style={styles.teacherBadgeText}>TEACHER</Text>
            </View>
          )}
          <Text style={styles.msgTime}>
            {new Date(Number(item.created_at)).toLocaleTimeString([], {
              hour: "2-digit", minute: "2-digit",
            })}
          </Text>
        </View>
        <Text style={styles.msgText}>{item.message}</Text>
      </View>
      {isAdmin && (
        <Pressable style={styles.deleteBtn} onPress={() => deleteMsgMutation.mutate(item.id)}>
          <Ionicons name="close" size={14} color="#999" />
        </Pressable>
      )}
    </View>
  ), [isAdmin]);

  return (
    <View style={styles.container}>
      {/* Header with hand-raise count */}
      <View style={styles.header}>
        <Ionicons name="chatbubbles" size={16} color={Colors.light.primary} />
        <Text style={styles.headerText}>Chat</Text>
        {isAdmin && raisedHands.length > 0 && (
          <View style={styles.raisedHandsBadge}>
            <Text style={styles.raisedHandsText}>✋ {raisedHands.length}</Text>
          </View>
        )}
      </View>

      {/* Admin: raised hands list */}
      {isAdmin && raisedHands.length > 0 && (
        <View style={styles.raisedHandsList}>
          <Text style={styles.raisedHandsTitle}>Raised Hands</Text>
          {raisedHands.map((h) => (
            <View key={h.id} style={styles.raisedHandItem}>
              <Text style={styles.raisedHandName}>✋ {h.userName}</Text>
              <Pressable
                style={styles.resolveBtn}
                onPress={() => resolveHandMutation.mutate(h.userId)}
              >
                <Text style={styles.resolveBtnText}>Dismiss</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Messages list */}
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
            <Text style={styles.emptyChatText}>No messages yet</Text>
          </View>
        }
      />

      {/* Input row */}
      <View style={styles.inputRow}>
        {!isAdmin && (
          <Pressable
            style={[styles.iconBtn, handRaised && styles.iconBtnActive]}
            onPress={handleHandRaise}
          >
            <Text style={{ fontSize: 16 }}>✋</Text>
          </Pressable>
        )}
        <TextInput
          style={styles.chatInput}
          value={chatMsg}
          onChangeText={setChatMsg}
          placeholder="Type a message..."
          placeholderTextColor="#999"
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        {/* Voice-to-text button (web only, if supported) */}
        {Platform.OS === "web" && voiceSupported && (
          <Pressable
            style={[styles.iconBtn, isListening && styles.iconBtnActive]}
            onPress={isListening ? stopListening : startListening}
          >
            <Ionicons
              name={isListening ? "mic" : "mic-outline"}
              size={18}
              color={isListening ? "#EF4444" : Colors.light.textMuted}
            />
          </Pressable>
        )}
        <Pressable
          style={[styles.sendBtn, !chatMsg.trim() && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!chatMsg.trim() || sendMsgMutation.isPending}
        >
          {sendMsgMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={16} color="#fff" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  headerText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, flex: 1 },
  raisedHandsBadge: {
    backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  raisedHandsText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#B45309" },
  raisedHandsList: {
    backgroundColor: "#FFFBEB", borderBottomWidth: 1, borderBottomColor: "#FDE68A",
    paddingHorizontal: 12, paddingVertical: 8, gap: 6,
  },
  raisedHandsTitle: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#B45309", marginBottom: 2 },
  raisedHandItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  raisedHandName: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.text },
  resolveBtn: { backgroundColor: "#F59E0B", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  resolveBtnText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff" },
  chatList: { flex: 1 },
  chatListContent: { padding: 10, gap: 8 },
  emptyChat: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  emptyChatText: { fontSize: 12, color: "#999", fontFamily: "Inter_400Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 8, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.light.secondary,
    alignItems: "center", justifyContent: "center",
  },
  iconBtnActive: { backgroundColor: "#FEF3C7" },
  chatInput: {
    flex: 1, backgroundColor: Colors.light.secondary, borderRadius: 18,
    paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.text,
    maxHeight: 70,
  },
  sendBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.light.primary,
    alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#ccc" },
  // Message styles
  msgRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.light.secondary,
    alignItems: "center", justifyContent: "center",
  },
  adminAvatar: { backgroundColor: "#FEF3C7" },
  avatarText: { fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.textMuted },
  msgBubble: {
    flex: 1, backgroundColor: Colors.light.secondary,
    borderRadius: 10, padding: 8, borderTopLeftRadius: 3,
  },
  adminBubble: { backgroundColor: "#FEF3C7" },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 },
  msgName: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  adminName: { color: "#B45309" },
  teacherBadge: { backgroundColor: "#F59E0B", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  teacherBadgeText: { fontSize: 7, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 0.5 },
  msgTime: { fontSize: 9, color: "#999", fontFamily: "Inter_400Regular", marginLeft: "auto" as any },
  msgText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.text, lineHeight: 17 },
  deleteBtn: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
});
