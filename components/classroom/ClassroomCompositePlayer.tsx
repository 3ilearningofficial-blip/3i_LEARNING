import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Platform, ActivityIndicator, Pressable, Text } from "react-native";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import ClassroomStudentStage from "@/components/classroom/ClassroomStudentStage";
import { normalizePipPosition } from "@/lib/classroom/mediaDevices";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
  /** Teacher PiP corner chosen by the admin; defaults to top-right. */
  pipPosition?: string;
  /** portraitTop fills a fixed 16:9 slot; default centers in flex stage. */
  layout?: "default" | "portraitTop";
};

/** Full-area LiveKit player for students (board + responsive teacher PiP + audio). */
export default function ClassroomCompositePlayer({
  liveClassId,
  enabled = true,
  pipPosition,
  layout = "default",
}: Props) {
  const { data: tokenPayload, isLoading } = useClassroomToken(liveClassId, enabled);
  const { setRemoteBoardEl, setRemoteCameraEl, setRemoteAudioEl, connected, reconnecting, error } =
    useLiveKitRoom(tokenPayload, enabled && Platform.OS === "web");
  const boardRef = useRef<HTMLVideoElement | null>(null);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (boardRef.current) setRemoteBoardEl(boardRef.current);
    if (cameraRef.current) setRemoteCameraEl(cameraRef.current);
    if (audioRef.current) setRemoteAudioEl(audioRef.current);
  }, [setRemoteBoardEl, setRemoteCameraEl, setRemoteAudioEl, connected]);

  useEffect(() => {
    if (Platform.OS !== "web" || !connected || !audioRef.current) return;
    const audio = audioRef.current;
    const tryPlay = () => {
      void audio.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    };
    tryPlay();
    audio.addEventListener("canplay", tryPlay);
    return () => audio.removeEventListener("canplay", tryPlay);
  }, [connected]);

  const enableAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = false;
    void audio.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
  };

  if (Platform.OS !== "web") return null;

  const isPortraitTop = layout === "portraitTop";

  return (
    <View style={[styles.wrap, isPortraitTop && styles.wrapPortraitTop]}>
      <View style={[styles.frame, isPortraitTop && styles.framePortraitTop]}>
        <ClassroomStudentStage
          boardVideoRef={boardRef}
          cameraVideoRef={cameraRef}
          pipPosition={normalizePipPosition(pipPosition)}
          controlsOnVideo={!isPortraitTop}
        />
        <audio ref={audioRef as React.RefObject<HTMLAudioElement>} autoPlay />

        {isLoading || !connected || reconnecting ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>
              {reconnecting && !isLoading ? "Reconnecting…" : "Connecting…"}
            </Text>
          </View>
        ) : null}

        {audioBlocked ? (
          <Pressable style={styles.unmuteBtn} onPress={enableAudio}>
            <Text style={styles.unmuteText}>Tap to enable sound</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 0,
  },
  frame: {
    width: "100%",
    maxHeight: "100%",
    aspectRatio: 16 / 9,
    maxWidth: "100%",
    position: "relative",
    backgroundColor: "#000",
  },
  wrapPortraitTop: {
    flex: 1,
    width: "100%",
    height: "100%",
    minHeight: 0,
  },
  framePortraitTop: {
    width: "100%",
    height: "100%",
    maxHeight: "100%",
    aspectRatio: undefined,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    zIndex: 2,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  loadingText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  unmuteBtn: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    left: "50%",
    transform: [{ translateX: -80 }],
    zIndex: 10,
    backgroundColor: "rgba(30,58,138,0.95)",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  unmuteText: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
