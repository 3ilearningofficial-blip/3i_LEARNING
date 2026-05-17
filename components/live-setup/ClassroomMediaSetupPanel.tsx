import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { UseWebRTCStreamReturn } from "@/lib/useWebRTCStream";
import WebrtcSetupPreview from "./WebrtcSetupPreview";
import MicLevelPreview from "./MicLevelPreview";
import MediaDeviceDropdown from "./MediaDeviceDropdown";
import Colors from "@/constants/colors";

type Props = {
  webrtc: UseWebRTCStreamReturn;
  livekitConfigured: boolean;
};

export default function ClassroomMediaSetupPanel({ webrtc, livekitConfigured }: Props) {
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
});
