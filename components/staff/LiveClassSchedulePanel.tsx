import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Platform, Alert } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

type Props = {
  courseId: number;
  assignment: any;
  liveClasses: any[];
  onScheduled: () => void;
};

export function LiveClassSchedulePanel({ courseId, assignment, liveClasses, onScheduled }: Props) {
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [expanded, setExpanded] = useState(false);
  const canStartLiveWeb = Platform.OS === "web";

  const upcoming = liveClasses.filter((lc) => !lc.is_completed).slice(0, 5);

  const schedule = async () => {
    if (!title.trim()) return Alert.alert("Title required");
    const ts = scheduledAt ? new Date(scheduledAt).getTime() : Date.now() + 3600000;
    try {
      await apiRequest("POST", "/api/staff/live-classes", {
        title: title.trim(),
        courseId,
        scheduledAt: ts,
        subjectKey: assignment?.subject_key || null,
        isLive: false,
      });
      setTitle("");
      setScheduledAt("");
      onScheduled();
      Alert.alert("Scheduled", "Live class scheduled.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to schedule");
    }
  };

  return (
    <View style={styles.panel}>
      <Pressable style={styles.panelHeader} onPress={() => setExpanded(!expanded)}>
        <Text style={styles.panelTitle}>Upcoming / Schedule Classes</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={Colors.light.primary} />
      </Pressable>

      {upcoming.map((lc) => (
        <View key={lc.id} style={styles.liveRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.liveTitle}>{lc.title}</Text>
            <Text style={styles.liveMeta}>
              {lc.scheduled_at ? new Date(Number(lc.scheduled_at)).toLocaleString() : "TBD"}
              {lc.subject_key ? ` · ${lc.subject_key}` : ""}
            </Text>
          </View>
          {canStartLiveWeb ? (
            <Pressable
              style={styles.startBtn}
              onPress={() => router.push(`/staff/live/${lc.id}/setup` as any)}
            >
              <Text style={styles.startBtnText}>Start</Text>
            </Pressable>
          ) : (
            <Text style={styles.webHint}>Start on web</Text>
          )}
        </View>
      ))}

      {expanded && (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Class title" value={title} onChangeText={setTitle} />
          {Platform.OS === "web" && (
            <TextInput
              style={styles.input}
              placeholder="Schedule (ISO datetime)"
              value={scheduledAt}
              onChangeText={setScheduledAt}
            />
          )}
          <Pressable style={styles.scheduleBtn} onPress={schedule}>
            <Text style={styles.scheduleBtnText}>Schedule Class</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "rgba(0,0,0,0.03)", borderRadius: 12, padding: 12, marginBottom: 12 },
  panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  panelTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.light.text },
  liveRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 },
  liveTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  liveMeta: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.light.textMuted },
  startBtn: { backgroundColor: Colors.light.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  startBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12 },
  webHint: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", maxWidth: 70 },
  form: { marginTop: 12, gap: 8 },
  input: { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === "web" ? 8 : 10, fontFamily: "Inter_400Regular" },
  scheduleBtn: { backgroundColor: Colors.light.primary, borderRadius: 8, padding: 10, alignItems: "center" },
  scheduleBtnText: { color: "#fff", fontFamily: "Inter_700Bold" },
});
