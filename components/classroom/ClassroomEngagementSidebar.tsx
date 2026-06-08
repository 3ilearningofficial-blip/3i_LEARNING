import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import LiveChatPanel from "@/components/LiveChatPanel";
import LiveStudentsPanel from "@/components/LiveStudentsPanel";
import ClassroomEngagementPanel from "@/components/classroom/ClassroomEngagementPanel";
import Colors from "@/constants/colors";
import type { ChatMode } from "@/lib/live-stream/types";

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

export default function ClassroomEngagementSidebar({
  liveClassId,
  chatMode,
  showViewerCount = true,
  engagementEnabled = true,
  parentViewers,
}: Props) {
  const [activeTab, setActiveTab] = useState<SideTab>("chat");

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
          <LiveChatPanel liveClassId={liveClassId} chatMode={chatMode} isAdmin />
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
