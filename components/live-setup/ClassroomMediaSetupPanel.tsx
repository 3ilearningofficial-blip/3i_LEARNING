import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { UseWebRTCStreamReturn } from "@/lib/useWebRTCStream";
import WebrtcSetupPreview from "./WebrtcSetupPreview";
import MicLevelPreview from "./MicLevelPreview";
import MediaDeviceDropdown from "./MediaDeviceDropdown";
import {
  loadClassroomMediaDevices,
  saveClassroomMediaDevices,
} from "@/lib/classroom/mediaDevices";
import Colors from "@/constants/colors";

type Props = {
  webrtc: UseWebRTCStreamReturn;
  livekitConfigured: boolean;
};

export default function ClassroomMediaSetupPanel({ webrtc, livekitConfigured }: Props) {
  const [greenScreen, setGreenScreen] = useState(false);

  useEffect(() => {
    setGreenScreen(!!loadClassroomMediaDevices().greenScreenEnabled);
  }, []);

  const toggleGreenScreen = () => {
    const next = !greenScreen;
    setGreenScreen(next);
    const prefs = loadClassroomMediaDevices();
    saveClassroomMediaDevices({ ...prefs, greenScreenEnabled: next });
  };

  if (Platform.OS !== "web") {
    return (
      <Text style={styles.note}>Camera, microphone, and board preview require the admin web app.</Text>
    );
  }

  const { cameras, microphones } = webrtc.devices;

  return (
    <View style={styles.wrap}>
      {!livekitConfigured && (
        <View style={styles.warn}>
          <Ionicons name="warning-outline" size={16} color="#B45309" />
          <Text style={styles.warnText}>LiveKit not configured — video will not work in class.</Text>
        </View>
      )}

      {webrtc.error ? <Text style={styles.error}>{webrtc.error}</Text> : null}

      <WebrtcSetupPreview webrtc={webrtc} compact />

      <MediaDeviceDropdown
        label="Select Camera"
        devices={cameras}
        selectedId={webrtc.selectedCamera}
        onSelect={webrtc.setSelectedCamera}
        fallback="Camera"
        emptyText="No camera found — allow camera access in your browser."
      />

      <MicLevelPreview stream={webrtc.stream} isAudioEnabled={webrtc.isAudioEnabled} />

      <MediaDeviceDropdown
        label="Select Mic"
        devices={microphones}
        selectedId={webrtc.selectedMicrophone}
        onSelect={webrtc.setSelectedMicrophone}
        fallback="Microphone"
        emptyText="No microphone found — allow microphone access."
      />

      <Pressable style={styles.toggleRow} onPress={toggleGreenScreen}>
        <View style={styles.toggleLabelWrap}>
          <Ionicons name="color-wand-outline" size={18} color={Colors.light.primary} />
          <Text style={styles.toggleLabel}>Green screen (hide background)</Text>
        </View>
        <View style={[styles.toggle, greenScreen && styles.toggleOn]}>
          <View style={[styles.knob, greenScreen && styles.knobOn]} />
        </View>
      </Pressable>
      <Text style={styles.hint}>
        Use a physical green backdrop behind you. Preview in setup; students see the keyed video when live.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  error: { fontSize: 12, color: Colors.light.error, marginBottom: 8 },
  warn: {
    flexDirection: "row",
    gap: 6,
    padding: 8,
    backgroundColor: "#FFFBEB",
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  warnText: { flex: 1, fontSize: 11, color: "#92400E", lineHeight: 15 },
  note: { fontSize: 12, color: Colors.light.textMuted, marginBottom: 12 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    gap: 12,
  },
  toggleLabelWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  toggleLabel: { fontSize: 13, fontWeight: "600", color: Colors.light.text, flex: 1 },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#E5E7EB",
    padding: 3,
    justifyContent: "center",
  },
  toggleOn: { backgroundColor: Colors.light.primary },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
  },
  knobOn: { alignSelf: "flex-end" },
  hint: { fontSize: 11, color: Colors.light.textMuted, marginTop: 6, lineHeight: 15 },
});
