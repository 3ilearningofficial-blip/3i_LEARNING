import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import { primeHandRaiseAudio } from "@/lib/playHandRaiseChime";
import {
  loadClassroomMediaDevices,
  saveClassroomMediaDevices,
  normalizePipPosition,
  type ClassroomPipPosition,
} from "@/lib/classroom/mediaDevices";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

import type { Room } from "livekit-client";
import type { Editor } from "tldraw";

type Props = {
  liveClassId: string;
  enabled?: boolean;
  boardEl?: HTMLElement | null;
  editor?: Editor | null;
  liveClassPipPosition?: string;
  onRoomReady?: (room: Room | null) => void;
  onCompositeStream?: (stream: MediaStream | null) => void;
  onBoardStreamingChange?: (streaming: boolean) => void;
};

const PIP_CORNERS: { pos: ClassroomPipPosition; label: string }[] = [
  { pos: "top-left", label: "TL" },
  { pos: "top-right", label: "TR" },
  { pos: "bottom-left", label: "BL" },
  { pos: "bottom-right", label: "BR" },
];

// "contain" + a 4:3 box shows the full teacher (not cropped) in the admin
// preview panel. Webcams stream landscape 16:9, so the CSS box mirrors that
// and object-fit contain guarantees no cropping regardless of camera aspect.
const videoStyle = {
  width: "100%",
  height: "100%",
  objectFit: "contain" as const,
  backgroundColor: "#000",
};

export default function TeacherVideoPanel({
  liveClassId,
  enabled = true,
  boardEl = null,
  editor = null,
  liveClassPipPosition,
  onRoomReady,
  onCompositeStream,
  onBoardStreamingChange,
}: Props) {
  const { data: tokenPayload, isLoading, error: tokenError } = useClassroomToken(liveClassId, enabled);
  const {
    error,
    streamWarning,
    connected,
    micEnabled,
    camEnabled,
    compositeStream,
    boardStreaming,
    setLocalVideoEl,
    toggleMic,
    toggleCam,
    republishTeacherStreamMeta,
    room,
  } = useLiveKitRoom(
    tokenPayload,
    enabled && Platform.OS === "web",
    boardEl,
    editor,
    liveClassPipPosition
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [pipPosition, setPipPosition] = useState<ClassroomPipPosition>("bottom-left");

  useEffect(() => {
    const prefs = loadClassroomMediaDevices();
    setPipPosition(normalizePipPosition(prefs.pipPosition ?? liveClassPipPosition));
  }, [liveClassPipPosition]);

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

  const selectPipPosition = (next: ClassroomPipPosition) => {
    setPipPosition(next);
    const prefs = loadClassroomMediaDevices();
    saveClassroomMediaDevices({ ...prefs, pipPosition: next });
    void apiRequest("PUT", `/api/admin/live-classes/${liveClassId}`, { pipPosition: next }).catch(
      () => {}
    );
    void republishTeacherStreamMeta(next);
  };

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
      {streamWarning && !error && !tokenError ? (
        <Text style={styles.warning}>{streamWarning}</Text>
      ) : null}
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
      <View style={styles.pipBlock}>
        <Text style={styles.pipLabel}>Student PiP corner</Text>
        <View style={styles.segment}>
          {PIP_CORNERS.map(({ pos, label }) => (
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "#111827",
    borderRadius: 10,
    overflow: "hidden",
  },
  cameraLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  videoBox: {
    flex: 1,
    minHeight: 180,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  muted: { color: "#9CA3AF", fontSize: 12, padding: 12 },
  error: { color: "#FCA5A5", fontSize: 11, padding: 8, textAlign: "center" },
  warning: { color: "#FCD34D", fontSize: 10, paddingHorizontal: 8, paddingBottom: 4, textAlign: "center" },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
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
  pipBlock: { paddingHorizontal: 10, paddingBottom: 10, gap: 6 },
  pipLabel: { fontSize: 10, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase" },
  segment: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: "#1F2937",
    borderRadius: 8,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 6,
  },
  segmentBtnOn: { backgroundColor: Colors.light.primary },
  segmentText: { fontSize: 11, fontWeight: "700", color: "#9CA3AF" },
  segmentTextOn: { color: "#fff" },
});
