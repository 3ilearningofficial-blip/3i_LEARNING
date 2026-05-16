import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
};

const videoStyle = { width: "100%", height: "100%", objectFit: "cover" as const, transform: "scaleX(-1)" };

export default function TeacherVideoPanel({ liveClassId, enabled = true }: Props) {
  const { data: tokenPayload, isLoading, error: tokenError } = useClassroomToken(liveClassId, enabled);
  const { error, connected, setLocalVideoEl, toggleMic, toggleCam } = useLiveKitRoom(
    tokenPayload,
    enabled && Platform.OS === "web"
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" && videoRef.current) {
      setLocalVideoEl(videoRef.current);
    }
  }, [setLocalVideoEl, connected]);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.wrap}>
        <Text style={styles.muted}>Camera panel (web only)</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.videoBox}>
        {isLoading ? (
          <ActivityIndicator color={Colors.light.primary} />
        ) : tokenError || error ? (
          <Text style={styles.error}>{tokenError?.message || error}</Text>
        ) : (
          <video ref={videoRef as any} autoPlay playsInline muted style={videoStyle} />
        )}
      </View>
      <View style={styles.controls}>
        <Pressable style={styles.ctrlBtn} onPress={() => void toggleMic()}>
          <Ionicons name="mic" size={18} color="#fff" />
        </Pressable>
        <Pressable style={styles.ctrlBtn} onPress={() => void toggleCam()}>
          <Ionicons name="videocam" size={18} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 160, backgroundColor: "#111827", borderRadius: 10, overflow: "hidden", marginBottom: 8 },
  videoBox: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#000" },
  muted: { color: "#9CA3AF", fontSize: 12, padding: 12 },
  error: { color: "#FCA5A5", fontSize: 11, padding: 8, textAlign: "center" },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  ctrlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
});
