import React from "react";
import { View, Text, StyleSheet, Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { UseWebRTCStreamReturn } from "@/lib/useWebRTCStream";
import WebrtcSetupPreview from "./WebrtcSetupPreview";
import MicLevelPreview from "./MicLevelPreview";
import Colors from "@/constants/colors";

type Props = {
  webrtc: UseWebRTCStreamReturn;
  livekitConfigured: boolean;
};

function deviceLabel(device: MediaDeviceInfo, fallback: string): string {
  const label = device.label?.trim();
  if (label) return label;
  return `${fallback} ${device.deviceId.slice(0, 6)}…`;
}

function DeviceOptions({
  devices,
  selectedId,
  onSelect,
  fallback,
}: {
  devices: MediaDeviceInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
  fallback: string;
}) {
  if (devices.length === 0) {
    return <Text style={styles.empty}>No devices found — allow browser access.</Text>;
  }
  return devices.map((device) => {
    const active = selectedId === device.deviceId;
    return (
      <Pressable
        key={device.deviceId}
        style={[styles.option, active && styles.optionActive]}
        onPress={() => onSelect(device.deviceId)}
      >
        <Ionicons
          name={active ? "radio-button-on" : "radio-button-off"}
          size={14}
          color={active ? Colors.light.primary : Colors.light.textMuted}
        />
        <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={2}>
          {deviceLabel(device, fallback)}
        </Text>
      </Pressable>
    );
  });
}

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

      <Text style={styles.sectionTitle}>Camera</Text>
      <WebrtcSetupPreview webrtc={webrtc} compact />
      <DeviceOptions
        devices={cameras}
        selectedId={webrtc.selectedCamera}
        onSelect={webrtc.setSelectedCamera}
        fallback="Camera"
      />

      <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Microphone</Text>
      <MicLevelPreview stream={webrtc.stream} isAudioEnabled={webrtc.isAudioEnabled} />
      <DeviceOptions
        devices={microphones}
        selectedId={webrtc.selectedMicrophone}
        onSelect={webrtc.setSelectedMicrophone}
        fallback="Mic"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.light.textMuted,
    textTransform: "uppercase",
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  sectionSpaced: { marginTop: 14 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 5,
    backgroundColor: "#fff",
  },
  optionActive: { borderColor: Colors.light.primary, backgroundColor: "#EFF6FF" },
  optionText: { flex: 1, fontSize: 12, color: Colors.light.text },
  optionTextActive: { fontWeight: "600", color: Colors.light.primary },
  empty: { fontSize: 11, color: Colors.light.textMuted, marginBottom: 6, lineHeight: 16 },
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
