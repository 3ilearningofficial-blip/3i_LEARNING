import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import WebrtcSetupPreview from "./WebrtcSetupPreview";
import Colors from "@/constants/colors";

type Props = {
  livekitConfigured: boolean;
};

export default function ClassroomSetupPreview({ livekitConfigured }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.boardStrip}>
        <Ionicons name="easel-outline" size={20} color="#FBBF24" />
        <Text style={styles.boardText}>
          Whiteboard preview opens in the live classroom. Test your camera below.
        </Text>
      </View>
      {!livekitConfigured && (
        <View style={styles.warn}>
          <Ionicons name="warning-outline" size={18} color="#B45309" />
          <Text style={styles.warnText}>
            LiveKit is not configured on the server. Classroom video will not work until LIVEKIT_* env vars are set.
          </Text>
        </View>
      )}
      <View style={styles.camArea}>
        <WebrtcSetupPreview />
      </View>
      {Platform.OS !== "web" && (
        <Text style={styles.note}>Teaching in Classroom mode requires the admin web app.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0a0a0a" },
  boardStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  boardText: { flex: 1, fontSize: 13, color: "#D1D5DB", lineHeight: 18 },
  warn: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    backgroundColor: "#FFFBEB",
    borderBottomWidth: 1,
    borderBottomColor: "#FDE68A",
  },
  warnText: { flex: 1, fontSize: 12, color: "#92400E", lineHeight: 17 },
  camArea: { flex: 1, minHeight: 200 },
  note: {
    padding: 10,
    fontSize: 12,
    color: Colors.light.textMuted,
    textAlign: "center",
    backgroundColor: "#111",
  },
});
