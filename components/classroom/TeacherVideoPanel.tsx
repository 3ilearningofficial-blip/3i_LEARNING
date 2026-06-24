import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import { primeHandRaiseAudio } from "@/lib/playHandRaiseChime";
import Colors from "@/constants/colors";

import type { Room } from "livekit-client";
import type { Editor } from "tldraw";

type Props = {
  liveClassId: string;
  enabled?: boolean;
  boardEl?: HTMLElement | null;
  editor?: Editor | null;
  onRoomReady?: (room: Room | null) => void;
  onCompositeStream?: (stream: MediaStream | null) => void;
  onBoardStreamingChange?: (streaming: boolean) => void;
};

// "contain" shows the full teacher (not cropped) in the admin preview panel.
// This matches what students receive: a full-body view or a full-board green-screen overlay.
const videoStyle = { width: "100%", height: "100%", objectFit: "contain" as const, backgroundColor: "#000" };

export default function TeacherVideoPanel({
  liveClassId,
  enabled = true,
  boardEl = null,
  editor = null,
  onRoomReady,
  onCompositeStream,
  onBoardStreamingChange,
}: Props) {
  const { data: tokenPayload, isLoading, error: tokenError } = useClassroomToken(liveClassId, enabled);
  const {
    error,
    connected,
    micEnabled,
    camEnabled,
    compositeStream,
    boardStreaming,
    setLocalVideoEl,
    toggleMic,
    toggleCam,
    room,
  } = useLiveKitRoom(tokenPayload, enabled && Platform.OS === "web", boardEl, editor);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" && videoRef.current && connected && camEnabled) {
      setLocalVideoEl(videoRef.current);
    }
  }, [setLocalVideoEl, connected, camEnabled, boardStreaming]);

  useEffect(() => {
    onRoomReady?.(connected ? room.current : null);
    return () => onRoomReady?.(null);
  }, [connected, room, onRoomReady]);

  useEffect(() => {
    onCompositeStream?.(compositeStream);
  }, [compositeStream, onCompositeStream]);

  useEffect(() => {
    onBoardStreamingChange?.(boardStreaming);
  }, [boardStreaming, onBoardStreamingChange]);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.wrap}>
        <Text style={styles.muted}>Camera panel (web only)</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.cameraLabel}>Camera</Text>
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
        <Pressable
          style={[styles.ctrlBtn, !micEnabled && styles.ctrlBtnOff]}
          onPress={() => {
            primeHandRaiseAudio();
            void toggleMic();
          }}
        >
          <Ionicons name={micEnabled ? "mic" : "mic-off"} size={18} color={micEnabled ? "#fff" : "#FCA5A5"} />
        </Pressable>
        <Pressable
          style={[styles.ctrlBtn, !camEnabled && styles.ctrlBtnOff]}
          onPress={() => {
            primeHandRaiseAudio();
            void toggleCam();
          }}
        >
          <Ionicons
            name={camEnabled ? "videocam" : "videocam-off"}
            size={18}
            color={camEnabled ? "#fff" : "#FCA5A5"}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Increased from 176px → 260px so full-body teacher is visible in admin preview.
  wrap: { height: 260, backgroundColor: "#111827", borderRadius: 10, overflow: "hidden", marginBottom: 8 },
  cameraLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 10,
    paddingTop: 6,
  },
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
  ctrlBtnOff: {
    backgroundColor: "rgba(220,38,38,0.35)",
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.6)",
  },
});
