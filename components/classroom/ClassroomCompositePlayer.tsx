import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Platform, ActivityIndicator, Pressable, Text } from "react-native";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import ClassroomStudentStage from "@/components/classroom/ClassroomStudentStage";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
};

/** Full-area LiveKit player for students (board + responsive teacher PiP + audio). */
export default function ClassroomCompositePlayer({ liveClassId, enabled = true }: Props) {
  const { data: tokenPayload, isLoading } = useClassroomToken(liveClassId, enabled);
  const { setRemoteBoardEl, setRemoteCameraEl, setRemoteAudioEl, connected, error } = useLiveKitRoom(
    tokenPayload,
    enabled && Platform.OS === "web"
  );
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

  return (
    <View style={styles.wrap}>
      <View style={styles.frame}>
        {isLoading || !connected ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
          </View>
        ) : null}
        {error ? null : (
          <>
            <ClassroomStudentStage boardVideoRef={boardRef} cameraVideoRef={cameraRef} />
            <audio ref={audioRef as React.RefObject<HTMLAudioElement>} autoPlay playsInline />
            {audioBlocked ? (
              <Pressable style={styles.unmuteBtn} onPress={enableAudio}>
                <Text style={styles.unmuteText}>Tap to enable sound</Text>
              </Pressable>
            ) : null}
          </>
        )}
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
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
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
