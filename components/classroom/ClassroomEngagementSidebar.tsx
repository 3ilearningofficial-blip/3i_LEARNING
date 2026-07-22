import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import LiveChatPanel from "@/components/LiveChatPanel";
import LiveStudentsPanel from "@/components/LiveStudentsPanel";
import ClassroomEngagementPanel from "@/components/classroom/ClassroomEngagementPanel";
import { useActivePoll } from "@/lib/classroom/useActivePoll";
import Colors from "@/constants/colors";
import type { ChatMode } from "@/lib/live-stream/types";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";

type SideTab = "chat" | "poll" | "students";

type Props = {
  liveClassId: string;
  chatMode: ChatMode;
  showViewerCount?: boolean;
  engagementEnabled?: boolean;
  parentViewers?: {
    viewers: { user_id: number; user_name: string }[];
    count: number;
  };
};

type HandRaiseRow = {
  id: number;
  user_id?: number;
  userId?: number;
  user_name?: string;
  userName?: string;
  raised_at?: number;
  raisedAt?: number;
};

export default function ClassroomEngagementSidebar({
  liveClassId,
  chatMode,
  showViewerCount = true,
  engagementEnabled = true,
  parentViewers,
}: Props) {
  const [activeTab, setActiveTab] = useState<SideTab>("chat");
  const previousTabRef = useRef<SideTab>("chat");
  const wasPollActiveRef = useRef(false);
  const qc = useQueryClient();

  const { data: activePoll } = useActivePoll(liveClassId, engagementEnabled);
  const pollActive =
    !!activePoll && Number(activePoll.ends_at) > Date.now() && !activePoll.ended_at;

  // Auto-swap: when a poll goes active, jump the admin to the Poll tab so
  // they can watch results roll in. When it ends, restore whatever tab they
  // had open before (usually "chat") so the sidebar doesn't feel sticky.
  useEffect(() => {
    if (pollActive && !wasPollActiveRef.current) {
      previousTabRef.current = activeTab;
      if (activeTab !== "poll") setActiveTab("poll");
    }
    if (!pollActive && wasPollActiveRef.current) {
      if (activeTab === "poll") setActiveTab(previousTabRef.current || "chat");
    }
    wasPollActiveRef.current = pollActive;
  }, [pollActive, activeTab]);

  // Own the raised-hands poll at the sidebar level so LiveChatPanel doesn't
  // fire its own 500 ms poll while the parent (chat tab) is already polling
  // — that duplicate produced 401 noise while auth flapped, and the sidebar
  // has the right lifecycle to gate polling on engagementEnabled.
  const { data: raisedHandsRaw = [] } = useQuery<HandRaiseRow[]>({
    queryKey: [`/api/admin/live-classes/${liveClassId}/raised-hands`],
    queryFn: async () => {
      const res = await authFetch(
        `${getApiUrl()}/admin/live-classes/${encodeURIComponent(liveClassId)}/raised-hands`
      );
      if (!res.ok) return [];
      return (await res.json()) as HandRaiseRow[];
    },
    enabled: engagementEnabled && Platform.OS === "web",
    refetchInterval: engagementEnabled ? 2000 : false,
    staleTime: 0,
  });

  const raisedHands = useMemo(
    () =>
      raisedHandsRaw.map((h) => ({
        id: Number(h.id),
        userId: Number(h.userId ?? h.user_id ?? 0),
        userName: String(h.userName ?? h.user_name ?? "Student"),
        raisedAt: Number(h.raisedAt ?? h.raised_at ?? 0),
      })),
    [raisedHandsRaw]
  );

  const resolveHandMutation = useMutation({
    mutationFn: (userId: number) =>
      apiRequest("POST", `/api/admin/live-classes/${liveClassId}/raised-hands/${userId}/resolve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/admin/live-classes/${liveClassId}/raised-hands`],
      });
    },
  });

  if (Platform.OS !== "web") {
    return <Text style={styles.note}>Engagement panel is web-only.</Text>;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, activeTab === "chat" && styles.tabActive]}
          onPress={() => setActiveTab("chat")}
        >
          <Ionicons
            name="chatbubbles-outline"
            size={16}
            color={activeTab === "chat" ? Colors.light.primary : Colors.light.textMuted}
          />
          <Text style={[styles.tabText, activeTab === "chat" && styles.tabTextActive]}>Chat</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "poll" && styles.tabActive]}
          onPress={() => setActiveTab("poll")}
        >
          <Ionicons
            name="stats-chart-outline"
            size={16}
            color={activeTab === "poll" ? Colors.light.primary : Colors.light.textMuted}
          />
          <Text style={[styles.tabText, activeTab === "poll" && styles.tabTextActive]}>
            Poll / Quiz
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "students" && styles.tabActive]}
          onPress={() => setActiveTab("students")}
        >
          <Ionicons
            name="people-outline"
            size={16}
            color={activeTab === "students" ? Colors.light.primary : Colors.light.textMuted}
          />
          <Text style={[styles.tabText, activeTab === "students" && styles.tabTextActive]}>
            Students
          </Text>
        </Pressable>
      </View>

      <View style={styles.tabContent}>
        {activeTab === "chat" ? (
          <LiveChatPanel
            liveClassId={liveClassId}
            chatMode={chatMode}
            isAdmin
            enabled={engagementEnabled}
            raisedHands={raisedHands}
            onResolveHand={(userId) => resolveHandMutation.mutate(userId)}
          />
        ) : activeTab === "poll" ? (
          <View style={styles.tabPanelFill}>
            <ClassroomEngagementPanel liveClassId={liveClassId} enabled={engagementEnabled} />
          </View>
        ) : (
          <LiveStudentsPanel
            liveClassId={liveClassId}
            showViewerCount={showViewerCount}
            parentViewers={parentViewers}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0 },
  note: { fontSize: 12, color: Colors.light.textMuted, padding: 12 },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 12, fontWeight: "600", color: Colors.light.textMuted },
  tabTextActive: { color: Colors.light.primary },
  tabContent: { flex: 1, minHeight: 0 },
  tabPanelFill: { flex: 1, minHeight: 0 },
});
