import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { liveClassQueryKey, liveClassesQueryKey } from "@/lib/query-keys";
import TldrawClassroom from "@/components/classroom/TldrawClassroom";
import type { TldrawClassroomHandle } from "@/components/classroom/TldrawClassroom.types";
import { finalizeClassroomLiveSession } from "@/lib/classroom/finalizeClassroomLive";
import { buildRecordingLectureSectionTitle } from "@/lib/recordingSection";
import TeacherVideoPanel from "@/components/classroom/TeacherVideoPanel";
import LiveChatPanel from "@/components/LiveChatPanel";
import LiveStudentsPanel from "@/components/LiveStudentsPanel";
import Colors from "@/constants/colors";

type SideTab = "chat" | "students";

export default function AdminClassroomPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const liveClassId = String(id || "");
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<SideTab>("chat");
  const [isEnding, setIsEnding] = useState(false);
  const boardRef = useRef<TldrawClassroomHandle>(null);

  const { data: liveClass, isLoading } = useQuery({
    queryKey: liveClassQueryKey(liveClassId),
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}`);
      if (!res.ok) throw new Error("Failed to load");
      const payload = await res.json();
      return payload?.data ?? payload;
    },
    enabled: !!liveClassId,
  });

  const chatMode = (liveClass?.chat_mode as "public" | "private") || "public";
  const showViewerCount = liveClass?.show_viewer_count ?? true;

  const handleEndClass = useCallback(async () => {
    const confirmed =
      Platform.OS === "web"
        ? window.confirm("End this live class?")
        : await new Promise<boolean>((resolve) =>
            Alert.alert("End class", "End this live class?", [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "End", style: "destructive", onPress: () => resolve(true) },
            ])
          );
    if (!confirmed) return;

    setIsEnding(true);
    try {
      const result = await finalizeClassroomLiveSession(
        liveClassId,
        {
          id: liveClassId,
          lecture_section_title: liveClass?.lecture_section_title,
          lecture_subfolder_title: liveClass?.lecture_subfolder_title,
          recording_url: liveClass?.recording_url,
          board_snapshot_url: liveClass?.board_snapshot_url,
        },
        boardRef.current?.getEditor() ?? null
      );
      qc.invalidateQueries({ queryKey: liveClassesQueryKey() });
      qc.invalidateQueries({ queryKey: liveClassQueryKey(liveClassId) });

      const courseId = liveClass?.course_id;
      const sectionLabel = buildRecordingLectureSectionTitle(
        liveClass?.lecture_section_title,
        liveClass?.lecture_subfolder_title
      );
      const msg = result.recordingUrl
        ? `Class ended. Whiteboard saved to Lectures → ${sectionLabel}.`
        : `Class ended. Session saved under Lectures → ${sectionLabel}. Upload a video later from the Live tab if needed.`;
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Class ended", msg);

      if (courseId) {
        router.replace(`/admin/course/${courseId}` as any);
      } else {
        router.replace("/admin" as any);
      }
    } catch (err: any) {
      if (Platform.OS === "web") window.alert(err?.message || "Failed to end class");
      else Alert.alert("Error", err?.message || "Failed to end class");
      setIsEnding(false);
    }
  }, [liveClassId, qc, liveClass]);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.webOnly}>
        <Ionicons name="desktop-outline" size={48} color={Colors.light.primary} />
        <Text style={styles.webOnlyTitle}>Classroom requires web</Text>
        <Text style={styles.webOnlyText}>Open the admin panel in a desktop browser to teach with the whiteboard.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2A4A"]} style={styles.header}>
        <Pressable style={styles.headerBack} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {liveClass?.title || "Live class"}
        </Text>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
        <Pressable style={styles.endBtn} onPress={handleEndClass} disabled={isEnding}>
          {isEnding ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.endBtnText}>End Class</Text>
          )}
        </Pressable>
      </LinearGradient>

      <View style={styles.main}>
        <View style={styles.boardArea}>
          <TldrawClassroom ref={boardRef} liveClassId={liveClassId} readonly={false} />
        </View>

        <View style={styles.sidePanel}>
          <TeacherVideoPanel liveClassId={liveClassId} />

          <View style={styles.tabBar}>
            <Pressable
              style={[styles.tab, activeTab === "chat" && styles.tabActive]}
              onPress={() => setActiveTab("chat")}
            >
              <Text style={[styles.tabText, activeTab === "chat" && styles.tabTextActive]}>Live chat</Text>
            </Pressable>
            <Pressable
              style={[styles.tab, activeTab === "students" && styles.tabActive]}
              onPress={() => setActiveTab("students")}
            >
              <Text style={[styles.tabText, activeTab === "students" && styles.tabTextActive]}>Students</Text>
            </Pressable>
          </View>

          <View style={styles.tabContent}>
            {activeTab === "chat" ? (
              <LiveChatPanel liveClassId={liveClassId} chatMode={chatMode} isAdmin />
            ) : (
              <LiveStudentsPanel liveClassId={liveClassId} showViewerCount={showViewerCount} />
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  webOnly: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 12 },
  webOnlyTitle: { fontSize: 18, fontWeight: "700", color: Colors.light.text },
  webOnlyText: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center" },
  backBtn: {
    marginTop: 16,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backBtnText: { color: "#fff", fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: "#fff" },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#DC2626",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  endBtn: {
    backgroundColor: "#7F1D1D",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 88,
    alignItems: "center",
  },
  endBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  main: { flex: 1, flexDirection: "row" },
  boardArea: {
    flex: 3,
    margin: 8,
    marginRight: 0,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#0a0a0a",
  },
  sidePanel: {
    flex: 1,
    margin: 8,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 10,
    minWidth: 280,
    maxWidth: 360,
  },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 13, fontWeight: "600", color: Colors.light.textMuted },
  tabTextActive: { color: Colors.light.primary },
  tabContent: { flex: 1, minHeight: 200 },
});
