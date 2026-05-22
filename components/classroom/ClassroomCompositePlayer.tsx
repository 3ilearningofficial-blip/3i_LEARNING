import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
};

const videoStyle = { width: "100%", height: "100%", objectFit: "contain" as const, backgroundColor: "#000" };

/** Full-area LiveKit player for students (composite board + teacher PiP + audio). */
export default function ClassroomCompositePlayer({ liveClassId, enabled = true }: Props) {
  const { data: tokenPayload, isLoading } = useClassroomToken(liveClassId, enabled);
  const { setRemoteVideoEl, setRemoteAudioEl, connected, error } = useLiveKitRoom(
    tokenPayload,
    enabled && Platform.OS === "web"
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (videoRef.current) setRemoteVideoEl(videoRef.current);
    if (audioRef.current) setRemoteAudioEl(audioRef.current);
  }, [setRemoteVideoEl, setRemoteAudioEl, connected]);

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
            <video ref={videoRef as any} autoPlay playsInline style={videoStyle} />
            <audio ref={audioRef as any} autoPlay />
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
});
