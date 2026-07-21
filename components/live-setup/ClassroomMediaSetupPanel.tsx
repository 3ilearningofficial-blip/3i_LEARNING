import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { UseWebRTCStreamReturn } from "@/lib/useWebRTCStream";
import ChromaWebrtcPreview from "./ChromaWebrtcPreview";
import MicLevelPreview from "./MicLevelPreview";
import MediaDeviceDropdown from "./MediaDeviceDropdown";
import {
  loadClassroomMediaDevices,
  saveClassroomMediaDevices,
  normalizePipPosition,
  type ClassroomPipPosition,
} from "@/lib/classroom/mediaDevices";
import Colors from "@/constants/colors";

type Props = {
  webrtc: UseWebRTCStreamReturn;
  livekitConfigured: boolean;
};

export default function ClassroomMediaSetupPanel({ webrtc, livekitConfigured }: Props) {
  const [greenScreen, setGreenScreen] = useState(false);
  const [pipPosition, setPipPosition] = useState<ClassroomPipPosition>("bottom-left");

  useEffect(() => {
    const prefs = loadClassroomMediaDevices();
    setGreenScreen(!!prefs.greenScreenEnabled);
    setPipPosition(normalizePipPosition(prefs.pipPosition));
  }, []);

  const toggleGreenScreen = () => {
    const next = !greenScreen;
    setGreenScreen(next);
    const prefs = loadClassroomMediaDevices();
    saveClassroomMediaDevices({ ...prefs, greenScreenEnabled: next });
  };

  const selectPipPosition = (next: ClassroomPipPosition) => {
    setPipPosition(next);
    const prefs = loadClassroomMediaDevices();
    saveClassroomMediaDevices({ ...prefs, pipPosition: next });
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

      <ChromaWebrtcPreview webrtc={webrtc} greenScreen={greenScreen} compact />

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
        Use a physical green backdrop behind you. Preview shows keyed video when this toggle is on.
      </Text>

      <View style={styles.pipBlock}>
        <View style={styles.toggleLabelWrap}>
          <Ionicons name="person-circle-outline" size={18} color={Colors.light.primary} />
          <Text style={styles.toggleLabel}>Teacher video corner</Text>
        </View>
        <View style={[styles.segment, { flexWrap: "wrap" }]}>
          {(
            [
              { pos: "top-left" as const, label: "Top left", icon: "arrow-up-circle-outline" },
              { pos: "top-right" as const, label: "Top right", icon: "arrow-up-circle-outline" },
              { pos: "bottom-left" as const, label: "Bottom left", icon: "arrow-down-circle-outline" },
              { pos: "bottom-right" as const, label: "Bottom right", icon: "arrow-down-circle-outline" },
            ] as const
          ).map(({ pos, label }) => (
            <Pressable
              key={pos}
              style={[styles.segmentBtn, pipPosition === pos && styles.segmentBtnOn]}
              onPress={() => selectPipPosition(pos)}
            >
              <Text style={[styles.segmentText, pipPosition === pos && styles.segmentTextOn]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          Corner where you appear for students. With green screen, your cutout is anchored to this corner (OBS-style).
        </Text>
      </View>
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
  pipBlock: { marginTop: 16, gap: 8 },
  segment: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#F3F4F6",
    borderRadius: 10,
    padding: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  segmentBtnOn: { backgroundColor: Colors.light.primary },
  segmentText: { fontSize: 12, fontWeight: "600", color: Colors.light.textMuted },
  segmentTextOn: { color: "#fff" },
});
