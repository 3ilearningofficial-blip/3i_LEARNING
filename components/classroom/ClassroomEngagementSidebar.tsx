import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

type SideTab = "camera" | "chat" | "poll" | "students";

type Props = {
  liveClassId: string;
  chatMode: ChatMode;
  showViewerCount?: boolean;
  engagementEnabled?: boolean;
  /**
   * Camera / LiveKit panel. Always kept mounted (hidden when another tab is
   * active) so publishing to students is never interrupted by tab switches.
   */
  cameraPanel: ReactNode;
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
  cameraPanel,
  parentViewers,
}: Props) {
  const [activeTab, setActiveTab] = useState<SideTab>("camera");
  const previousTabRef = useRef<SideTab>("camera");
  const wasPollActiveRef = useRef(false);
  const [authBlocked, setAuthBlocked] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    setAuthBlocked(false);
  }, [engagementEnabled, liveClassId]);

  const { data: activePoll } = useActivePoll(liveClassId, engagementEnabled);
  const pollActive =
    !!activePoll && Number(activePoll.ends_at) > Date.now() && !activePoll.ended_at;

  // Auto-swap: when a poll goes active, jump the admin to the Poll tab so
  // they can watch results roll in. When it ends, restore whatever tab they
  // had open before so the sidebar doesn't feel sticky.
  useEffect(() => {
    if (pollActive && !wasPollActiveRef.current) {
      previousTabRef.current = activeTab;
      if (activeTab !== "poll") setActiveTab("poll");
    }
    if (!pollActive && wasPollActiveRef.current) {
      if (activeTab === "poll") setActiveTab(previousTabRef.current || "camera");
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
      if (res.status === 401 || res.status === 403) {
        setAuthBlocked(true);
        return [];
      }
      if (!res.ok) return [];
      return (await res.json()) as HandRaiseRow[];
    },
    enabled: engagementEnabled && Platform.OS === "web" && !authBlocked,
    refetchInterval: engagementEnabled && !authBlocked ? 2000 : false,
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

  const tabs: { id: SideTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: "camera", label: "Camera", icon: "videocam-outline" },
    { id: "chat", label: "Chat", icon: "chatbubbles-outline" },
    { id: "poll", label: "Poll / Quiz", icon: "stats-chart-outline" },
    { id: "students", label: "Students", icon: "people-outline" },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={tab.icon}
                size={15}
                color={active ? Colors.light.primary : Colors.light.textMuted}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.tabContent}>
        {/* Keep camera mounted always — hiding (not unmounting) preserves LiveKit publish. */}
        <View
          style={[styles.tabPanelFill, activeTab !== "camera" && styles.panelHidden]}
          pointerEvents={activeTab === "camera" ? "auto" : "none"}
          accessibilityElementsHidden={activeTab !== "camera"}
          importantForAccessibility={activeTab === "camera" ? "yes" : "no-hide-descendants"}
        >
          {cameraPanel}
        </View>

        {activeTab === "chat" ? (
          <LiveChatPanel
            liveClassId={liveClassId}
            chatMode={chatMode}
            isAdmin
            enabled={engagementEnabled}
            raisedHands={raisedHands}
            onResolveHand={(userId) => resolveHandMutation.mutate(userId)}
          />
        ) : null}

        {activeTab === "poll" ? (
          <View style={styles.tabPanelFill}>
            <ClassroomEngagementPanel liveClassId={liveClassId} enabled={engagementEnabled} />
          </View>
        ) : null}

        {activeTab === "students" ? (
          <LiveStudentsPanel
            liveClassId={liveClassId}
            showViewerCount={showViewerCount}
            parentViewers={parentViewers}
          />
        ) : null}
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
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 10, fontWeight: "600", color: Colors.light.textMuted },
  tabTextActive: { color: Colors.light.primary },
  tabContent: { flex: 1, minHeight: 0, position: "relative" },
  tabPanelFill: { flex: 1, minHeight: 0 },
  // Keep layout out of the way without unmounting (LiveKit must stay alive).
  panelHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
    left: 0,
    top: 0,
  },
});
