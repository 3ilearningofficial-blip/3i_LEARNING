import React from "react";
import { View, Text, StyleSheet, Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { UseWebRTCStreamReturn } from "@/lib/useWebRTCStream";
import Colors from "@/constants/colors";

type Props = {
  webrtc: Pick<
    UseWebRTCStreamReturn,
    | "devices"
    | "selectedCamera"
    | "selectedMicrophone"
    | "setSelectedCamera"
    | "setSelectedMicrophone"
    | "error"
  >;
};

function deviceLabel(device: MediaDeviceInfo, fallback: string): string {
  const label = device.label?.trim();
  if (label) return label;
  return `${fallback} ${device.deviceId.slice(0, 6)}…`;
}

export default function MediaDeviceSelectors({ webrtc }: Props) {
  if (Platform.OS !== "web") {
    return (
      <Text style={styles.note}>Camera and microphone selection is available on web.</Text>
    );
  }

  const { cameras, microphones } = webrtc.devices;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Camera & microphone</Text>
      {webrtc.error ? <Text style={styles.error}>{webrtc.error}</Text> : null}

      <Text style={styles.label}>Camera</Text>
      {cameras.length === 0 ? (
        <Text style={styles.empty}>No cameras detected — allow access in your browser.</Text>
      ) : (
        cameras.map((cam) => {
          const active = webrtc.selectedCamera === cam.deviceId;
          return (
            <Pressable
              key={cam.deviceId}
              style={[styles.option, active && styles.optionActive]}
              onPress={() => webrtc.setSelectedCamera(cam.deviceId)}
            >
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={16}
                color={active ? Colors.light.primary : Colors.light.textMuted}
              />
              <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={2}>
                {deviceLabel(cam, "Camera")}
              </Text>
            </Pressable>
          );
        })
      )}

      <Text style={[styles.label, styles.labelSpaced]}>Microphone</Text>
      {microphones.length === 0 ? (
        <Text style={styles.empty}>No microphones detected.</Text>
      ) : (
        microphones.map((mic) => {
          const active = webrtc.selectedMicrophone === mic.deviceId;
          return (
            <Pressable
              key={mic.deviceId}
              style={[styles.option, active && styles.optionActive]}
              onPress={() => webrtc.setSelectedMicrophone(mic.deviceId)}
            >
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={16}
                color={active ? Colors.light.primary : Colors.light.textMuted}
              />
              <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={2}>
                {deviceLabel(mic, "Mic")}
              </Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  heading: { fontSize: 13, fontWeight: "700", color: Colors.light.text, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: "600", color: Colors.light.textMuted, marginBottom: 6, textTransform: "uppercase" },
  labelSpaced: { marginTop: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 6,
    backgroundColor: "#fff",
  },
  optionActive: { borderColor: Colors.light.primary, backgroundColor: "#EFF6FF" },
  optionText: { flex: 1, fontSize: 13, color: Colors.light.text },
  optionTextActive: { fontWeight: "600", color: Colors.light.primary },
  empty: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 17, marginBottom: 4 },
  error: { fontSize: 12, color: Colors.light.error, marginBottom: 8 },
  note: { fontSize: 12, color: Colors.light.textMuted, marginBottom: 12 },
});
