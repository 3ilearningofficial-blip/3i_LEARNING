import React, { type ReactNode, type RefObject } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ClassroomHeaderActivityTimer from "@/components/classroom/ClassroomHeaderActivityTimer";
import StudentActivePollPanel from "@/components/classroom/StudentActivePollPanel";
import StudentPollStatsOverlay from "@/components/classroom/StudentPollStatsOverlay";
import { useActivePoll } from "@/lib/classroom/useActivePoll";
import { usePollBroadcastStats } from "@/lib/classroom/usePollBroadcastStats";
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
  title: string;
  liveClassId: string;
  topPadding: number;
  bottomPadding: number;
  showLiveHeader: boolean;
  isLive: boolean;
  canChat: boolean;
  canSendChat?: boolean;
  chatDisabled?: boolean;
  /** When true, poll/stats are shown on the video frame — skip under-title copy. */
  hideUnderVideoEngagement?: boolean;
  handRaised: boolean;
  onHandRaise: () => void;
  chatMsg: string;
  onChatMsgChange: (text: string) => void;
  onSend: () => void;
  sendPending: boolean;
  chatError?: string;
  displayMessages: ChatMsg[];
  listRef: RefObject<FlatList<ChatMsg> | null>;
  chatInputRef: RefObject<TextInput | null>;
  isListening?: boolean;
  onMicPress?: () => void;
  videoSlot: ReactNode;
};

function formatRelativeTime(createdAt: number): string {
  const diffMs = Date.now() - Number(createdAt);
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "Just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
}

export default function ClassroomStudentPortraitShell({
  title,
  liveClassId,
  topPadding,
  bottomPadding,
  showLiveHeader,
  isLive,
  canChat,
  canSendChat = canChat,
  chatDisabled = false,
  hideUnderVideoEngagement = false,
  handRaised,
  onHandRaise,
  chatMsg,
  onChatMsgChange,
  onSend,
  sendPending,
  chatError,
  displayMessages,
  listRef,
  chatInputRef,
  isListening = false,
  onMicPress,
  videoSlot,
}: Props) {
  const { data: activePoll } = useActivePoll(liveClassId, canChat);
  const pollActive =
    !!activePoll && Number(activePoll.ends_at) > Date.now() && !activePoll.ended_at;
  const { data: broadcastStats } = usePollBroadcastStats(liveClassId, canChat);
  const statsBroadcast = !!broadcastStats && !pollActive;
  const showUnderVideoPoll = pollActive && !hideUnderVideoEngagement;
  const showUnderVideoStats = statsBroadcast && !hideUnderVideoEngagement;
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={topPadding}
    >
      <View style={[styles.compactHeader, { paddingTop: topPadding + 4 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        {showLiveHeader ? (
          <View style={styles.headerStatus}>
            {/* Recording pill is admin-only; students see just LIVE + the activity timer. */}
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            <ClassroomHeaderActivityTimer liveClassId={liveClassId} sessionActive={isLive} />
          </View>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      <View style={styles.videoBlock}>{videoSlot}</View>

      <View style={styles.titleBar}>
        <Text style={styles.titleText} numberOfLines={2}>
          {title}
        </Text>
      </View>

      {showUnderVideoPoll ? (
        <View style={[styles.pollBlock, { paddingBottom: Math.max(bottomPadding, 12) }]}>
          <StudentActivePollPanel liveClassId={liveClassId} enabled={canChat} />
        </View>
      ) : showUnderVideoStats ? (
        <View style={[styles.pollBlock, { paddingBottom: Math.max(bottomPadding, 12) }]}>
          <StudentPollStatsOverlay liveClassId={liveClassId} enabled={canChat} />
        </View>
      ) : chatDisabled ? (
        <View style={[styles.chatDisabledBox, { paddingBottom: Math.max(bottomPadding, 24) }]}>
          <Ionicons name="chatbubbles-outline" size={48} color="#6B7280" />
          <Text style={styles.chatDisabledTitle}>Live Chat Has Been disabled by the Teacher</Text>
          <Text style={styles.chatDisabledSub}>Focus on learning</Text>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.actionRowScroll}
            contentContainerStyle={styles.actionRow}
          >
            <Pressable
              style={[styles.actionBtn, handRaised && styles.actionBtnActive]}
              onPress={onHandRaise}
              disabled={!canChat}
            >
              <Text style={styles.actionEmoji}>✋</Text>
              <Text style={[styles.actionLabel, handRaised && styles.actionLabelActive]}>
                Hand Raise
              </Text>
            </Pressable>
            <View style={[styles.actionBtn, styles.actionBtnSelected]}>
              <Ionicons name="chatbubbles" size={22} color="#A78BFA" />
              <Text style={[styles.actionLabel, styles.actionLabelActive]}>Live Chat</Text>
            </View>
            {Platform.OS === "web" && onMicPress ? (
              <Pressable
                style={[styles.actionBtn, isListening && styles.actionBtnActive]}
                onPress={onMicPress}
                disabled={!canSendChat}
              >
                <Ionicons
                  name={isListening ? "mic" : "mic-outline"}
                  size={22}
                  color={isListening ? "#EF4444" : "#9CA3AF"}
                />
                <Text style={styles.actionLabel}>Voice</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={styles.chatPanel}>
            <View style={styles.chatPanelHeader}>
              <Text style={styles.chatPanelTitle}>Live chat</Text>
              <Ionicons name="information-circle-outline" size={18} color="#6B7280" />
            </View>
            <FlatList
              ref={listRef}
              data={displayMessages}
              keyExtractor={(m) => String(m.id)}
              style={styles.chatList}
              contentContainerStyle={styles.chatListContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              renderItem={({ item }) => (
                <View style={[styles.msgCard, item.is_admin && styles.msgCardAdmin]}>
                  <View style={styles.msgAvatar}>
                    <Ionicons name="person" size={16} color="#9CA3AF" />
                  </View>
                  <View style={styles.msgBody}>
                    <View style={styles.msgMeta}>
                      <Text style={styles.msgName} numberOfLines={1}>
                        {item.user_name}
                      </Text>
                      <Text style={styles.msgTime}>{formatRelativeTime(item.created_at)}</Text>
                    </View>
                    <Text style={styles.msgText}>{item.message}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyChat}>No messages yet. Ask your doubt here.</Text>
              }
            />
            <View style={[styles.chatInputRow, { paddingBottom: Math.max(bottomPadding, 10) }]}>
              <TextInput
                ref={chatInputRef}
                style={styles.chatInput}
                value={chatMsg}
                onChangeText={onChatMsgChange}
                placeholder={canSendChat ? "Ask a doubt…" : "Chat closed"}
                placeholderTextColor="#6B7280"
                editable={canSendChat}
                onSubmitEditing={onSend}
                enterKeyHint="send"
              />
              <Pressable
                style={[styles.sendBtn, (!chatMsg.trim() || sendPending) && styles.sendDisabled]}
                onPress={onSend}
                disabled={!canSendChat || !chatMsg.trim() || sendPending}
              >
                <Ionicons name="send" size={18} color="#fff" />
              </Pressable>
            </View>
            {chatError ? <Text style={styles.chatErrorText}>{chatError}</Text> : null}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0A0A", minHeight: 0 },
  compactHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 6,
    backgroundColor: "#0A0A0A",
    zIndex: 20,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerSpacer: { flex: 1 },
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
  videoBlock: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  titleBar: {
    backgroundColor: "#0A0A0A",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  titleText: { fontSize: 15, fontWeight: "700", color: "#F9FAFB", lineHeight: 20 },
  pollBlock: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "#0F172A",
    padding: 12,
  },
  actionRowScroll: { flexGrow: 0, backgroundColor: "#0A0A0A" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionBtn: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 4,
  },
  actionBtnActive: { backgroundColor: "rgba(124,58,237,0.2)" },
  actionBtnSelected: { backgroundColor: "rgba(124,58,237,0.28)" },
  actionEmoji: { fontSize: 22 },
  actionLabel: { fontSize: 11, fontWeight: "600", color: "#9CA3AF" },
  actionLabelActive: { color: "#C4B5FD" },
  chatPanel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "#111827",
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
  },
  chatPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  chatPanelTitle: { fontSize: 15, fontWeight: "700", color: "#F3F4F6" },
  chatList: { flex: 1 },
  chatListContent: { padding: 12, gap: 8 },
  msgCard: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#1F2937",
    borderRadius: 12,
    padding: 10,
  },
  msgCardAdmin: { backgroundColor: "#312E81" },
  msgAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#374151",
    alignItems: "center",
    justifyContent: "center",
  },
  msgBody: { flex: 1, minWidth: 0 },
  msgMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  msgName: { flex: 1, fontSize: 13, fontWeight: "700", color: "#E5E7EB" },
  msgTime: { fontSize: 11, color: "#6B7280" },
  msgText: { fontSize: 14, color: "#D1D5DB", lineHeight: 20 },
  emptyChat: { textAlign: "center", color: "#6B7280", marginTop: 24, fontSize: 13 },
  chatDisabledBox: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 28,
    backgroundColor: "#111827",
  },
  chatDisabledTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#F3F4F6",
    textAlign: "center",
    lineHeight: 24,
  },
  chatDisabledSub: { fontSize: 14, color: "#9CA3AF", textAlign: "center" },
  chatInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
    backgroundColor: "#111827",
  },
  chatInput: {
    flex: 1,
    backgroundColor: "#1F2937",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: "#F9FAFB",
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
  chatErrorText: {
    fontSize: 12,
    color: "#DC2626",
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
});
