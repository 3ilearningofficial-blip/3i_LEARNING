import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Colors from "@/constants/colors";
import type { ChatMode } from "@/lib/live-stream/types";

type Props = {
  chatMode: ChatMode;
  onChatModeChange: (mode: ChatMode) => void;
  showViewerCount: boolean;
  onShowViewerCountChange: (v: boolean) => void;
};

export default function SharedLiveSettings({
  chatMode,
  onChatModeChange,
  showViewerCount,
  onShowViewerCountChange,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>Chat mode</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.chip, chatMode === "public" && styles.chipActive]}
          onPress={() => onChatModeChange("public")}
        >
          <Text style={[styles.chipText, chatMode === "public" && styles.chipTextActive]}>Public</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, chatMode === "private" && styles.chipActive]}
          onPress={() => onChatModeChange("private")}
        >
          <Text style={[styles.chipText, chatMode === "private" && styles.chipTextActive]}>Private</Text>
        </Pressable>
      </View>

      <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Student count</Text>
      <Pressable style={styles.toggleRow} onPress={() => onShowViewerCountChange(!showViewerCount)}>
        <Text style={styles.toggleLabel}>Show online count to students</Text>
        <View style={[styles.toggle, showViewerCount && styles.toggleOn]}>
          <View style={[styles.knob, showViewerCount && styles.knobOn]} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.light.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  row: { flexDirection: "row", gap: 8 },
  chip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    alignItems: "center",
  },
  chipActive: { borderColor: Colors.light.primary, backgroundColor: "#F0F5FF" },
  chipText: { fontSize: 13, fontWeight: "600", color: Colors.light.textMuted },
  chipTextActive: { color: Colors.light.primary },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  toggleLabel: { flex: 1, fontSize: 14, color: Colors.light.text },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#E5E7EB",
    padding: 3,
  },
  toggleOn: { backgroundColor: Colors.light.primary },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
});
