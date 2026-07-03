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
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import { filterChatMessages } from "@/lib/chat-utils";
import { useVoiceInput } from "@/lib/useVoiceInput";
import ClassroomCompositePlayer from "@/components/classroom/ClassroomCompositePlayer";
import NativeClassroomPlayer from "@/components/classroom/NativeClassroomPlayer";
import ClassroomLiveOverlays from "@/components/classroom/ClassroomLiveOverlays";
import ClassroomStudentPortraitShell from "@/components/classroom/ClassroomStudentPortraitShell";
import LiveClassRecordingTimer from "@/components/LiveClassRecordingTimer";
import ClassroomHeaderActivityTimer from "@/components/classroom/ClassroomHeaderActivityTimer";
import { useLiveEngagementSse } from "@/lib/useLiveEngagementSse";
import { isTruthyDbFlag } from "@/lib/live-class/dbFlags";
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
  isLive: boolean;
  startedAt?: number | null;
  isCompleted: boolean;
  chatMode?: string;
  pipPosition?: string;
  topPadding: number;
  bottomPadding: number;
};

export default function ClassroomStudentView({
  liveClassId,
  title,
  showAsLiveUI,
  isLive,
  startedAt,
  isCompleted,
  chatMode = "public",
  pipPosition: _pipPosition,
  topPadding,
  bottomPadding,
}: Props) {
  const { width, height } = useWindowDimensions();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsg, setChatMsg] = useState("");
  const [handRaised, setHandRaised] = useState(false);
  const listRef = useRef<FlatList<ChatMsg>>(null);
  const chatInputRef = useRef<TextInput>(null);
  const prevIsLiveRef = useRef(false);

  const isPhonePortrait = width < 768;
  const isWideLayout = width >= 768;
  const classIsLive = isTruthyDbFlag(isLive) || isLive === true;
  const canChat = classIsLive && !isCompleted;
  const showLiveHeader = (showAsLiveUI || classIsLive) && !isCompleted;
  const watchComposite = showAsLiveUI && classIsLive && !isCompleted;

  useLiveEngagementSse({
    liveClassId,
    enabled: canChat,
    isAdmin: false,
  });

  const appendVoiceText = useCallback((text: string) => {
    setChatMsg((prev) => (prev ? `${prev} ${text}` : text));
  }, []);
  const { isListening, startListening, stopListening } = useVoiceInput(appendVoiceText);

  useEffect(() => {
    if (!chatOpen || Platform.OS !== "web" || isPhonePortrait) return;
    const t = requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(t);
  }, [chatOpen, isPhonePortrait]);

  const { data: messages = [] } = useQuery<ChatMsg[]>({
    queryKey: [`/api/live-classes/${liveClassId}/chat`],
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${liveClassId}/chat`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: canChat ? 3000 : false,
    enabled: !!liveClassId,
  });

  const displayMessages = filterChatMessages(
    messages,
    user?.id ?? 0,
    false,
    (chatMode as "public" | "private") || "public",
  );

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", `/api/live-classes/${liveClassId}/chat`, { message });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Failed to send message");
      }
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [`/api/admin/live-classes/${liveClassId}/raised-hands`] });
    },
  });

  useEffect(() => {
    if (!classIsLive || isCompleted || !liveClassId) {
      prevIsLiveRef.current = false;
      return;
    }
    const sendHeartbeat = () => {
      void apiRequest("POST", `/api/live-classes/${liveClassId}/viewers/heartbeat`, {}).catch(
        () => {},
      );
    };
    sendHeartbeat();
    prevIsLiveRef.current = true;
    const t = setInterval(sendHeartbeat, 12000);
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        sendHeartbeat();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(t);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [liveClassId, classIsLive, isCompleted]);

  const handleSend = useCallback(() => {
    const t = chatMsg.trim();
    if (!t || !canChat) return;
    sendMutation.mutate(t);
  }, [chatMsg, canChat, sendMutation]);

  const renderVideoStage = (layout: "default" | "portraitTop") => (
    <View style={layout === "portraitTop" ? styles.stagePortraitSlot : styles.stageWideSlot}>
      {!showAsLiveUI && !isCompleted ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={Colors.light.primary} />
          <Text style={styles.waitingText}>Waiting for teacher to start…</Text>
        </View>
      ) : watchComposite ? (
        <>
          {Platform.OS === "web" ? (
            <ClassroomCompositePlayer liveClassId={liveClassId} enabled layout={layout} />
          ) : (
            <NativeClassroomPlayer liveClassId={liveClassId} enabled />
          )}
          <ClassroomLiveOverlays liveClassId={liveClassId} sessionActive={isLive} />
        </>
      ) : showAsLiveUI || isCompleted ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={Colors.light.primary} />
          <Text style={styles.waitingText}>Connecting to class…</Text>
        </View>
      ) : null}
    </View>
  );

  const renderWideChatPanel = () => (
    <View
      style={[
        styles.chatPanel,
        isWideLayout ? styles.chatPanelSide : styles.chatPanelPortrait,
        { paddingBottom: bottomPadding },
      ]}
    >
      <View style={styles.chatSheetHeader}>
        <Text style={styles.chatSheetTitle}>Live chat</Text>
        <Pressable
          style={styles.closeBtn}
          onPress={() => setChatOpen(false)}
          accessibilityLabel="Close chat"
        >
          <Ionicons name="close" size={24} color={Colors.light.text} />
        </Pressable>
      </View>
      <FlatList
        ref={listRef}
        data={displayMessages}
        keyExtractor={(m) => String(m.id)}
        style={styles.chatList}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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
          ref={chatInputRef}
          style={styles.chatInput}
          value={chatMsg}
          onChangeText={setChatMsg}
          placeholder={canChat ? "Ask a doubt…" : "Chat closed"}
          editable={canChat}
          onSubmitEditing={handleSend}
          autoFocus={chatOpen}
          enterKeyHint="send"
        />
        {Platform.OS === "web" ? (
          <Pressable
            style={[styles.micBtn, isListening && styles.micBtnActive]}
            onPress={isListening ? stopListening : startListening}
            disabled={!canChat}
          >
            <Ionicons
              name={isListening ? "mic" : "mic-outline"}
              size={18}
              color={isListening ? "#EF4444" : Colors.light.textMuted}
            />
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.sendBtn, !chatMsg.trim() && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!canChat || !chatMsg.trim() || sendMutation.isPending}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
      {sendMutation.error ? (
        <Text style={styles.chatErrorText}>{sendMutation.error.message}</Text>
      ) : null}
    </View>
  );

  if (isPhonePortrait || Platform.OS !== "web") {
    return (
      <ClassroomStudentPortraitShell
        title={title}
        liveClassId={liveClassId}
        topPadding={topPadding}
        bottomPadding={bottomPadding}
        showLiveHeader={showLiveHeader}
        isLive={isLive}
        startedAt={startedAt}
        canChat={canChat}
        handRaised={handRaised}
        onHandRaise={() => handMutation.mutate(!handRaised)}
        chatMsg={chatMsg}
        onChatMsgChange={setChatMsg}
        onSend={handleSend}
        sendPending={sendMutation.isPending}
        chatError={sendMutation.error?.message}
        displayMessages={displayMessages}
        listRef={listRef}
        chatInputRef={chatInputRef}
        isListening={isListening}
        onMicPress={isListening ? stopListening : startListening}
        videoSlot={renderVideoStage("portraitTop")}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior="padding"
      keyboardVerticalOffset={topPadding}
    >
      <View style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {showLiveHeader ? (
          <View style={styles.headerStatus}>
            <LiveClassRecordingTimer startedAt={startedAt} active={isLive} compact />
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            <ClassroomHeaderActivityTimer liveClassId={liveClassId} sessionActive={isLive} />
          </View>
        ) : null}
      </View>

      <View style={[styles.body, isWideLayout && chatOpen && styles.bodyRow]}>
        <View style={[styles.stage, isWideLayout && chatOpen && styles.stageWithChat]}>
          {renderVideoStage("default")}
          {!isWideLayout && chatOpen ? renderWideChatPanel() : null}
        </View>

        {isWideLayout && chatOpen ? renderWideChatPanel() : null}
      </View>

      {!chatOpen ? (
        <View style={[styles.floatingBar, { bottom: bottomPadding + 12 }]}>
          <Pressable
            style={[styles.fab, handRaised && styles.fabActive]}
            onPress={() => handMutation.mutate(!handRaised)}
            disabled={!canChat}
          >
            <Text style={{ fontSize: 20 }}>✋</Text>
          </Pressable>
          <Pressable
            style={styles.fab}
            onPress={() => {
              setChatOpen(true);
              requestAnimationFrame(() => chatInputRef.current?.focus());
            }}
          >
            <Ionicons name="chatbubbles" size={22} color="#fff" />
          </Pressable>
        </View>
      ) : null}
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
  headerStatus: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
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
  body: { flex: 1 },
  bodyRow: { flexDirection: "row" },
  stage: {
    flex: 1,
    position: "relative",
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  stagePortraitSlot: {
    width: "100%",
    height: "100%",
    position: "relative",
    backgroundColor: "#000",
  },
  stageWideSlot: {
    flex: 1,
    width: "100%",
    position: "relative",
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  stageWithChat: { flex: 1 },
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
  chatPanel: {
    backgroundColor: "#fff",
    zIndex: 40,
    overflow: "hidden",
  },
  chatPanelSide: {
    width: 320,
    maxWidth: "38%",
    borderLeftWidth: 1,
    borderLeftColor: "#E5E7EB",
  },
  chatPanelPortrait: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "42%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
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
  chatErrorText: {
    fontSize: 12,
    color: "#DC2626",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  chatInputRow: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    alignItems: "center",
  },
  chatInput: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnActive: { backgroundColor: "#FEE2E2" },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.5 },
});
