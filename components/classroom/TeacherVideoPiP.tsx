import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
  /** Lift PiP when portrait chat panel is open so video stays visible above chat */
  chatOpen?: boolean;
  isWideLayout?: boolean;
};

const videoStyle = { width: "100%", height: "100%", objectFit: "cover" as const };

export default function TeacherVideoPiP({
  liveClassId,
  enabled = true,
  chatOpen = false,
  isWideLayout = false,
}: Props) {
  const { data: tokenPayload, isLoading } = useClassroomToken(liveClassId, enabled);
  const { setRemoteVideoEl, connected } = useLiveKitRoom(tokenPayload, enabled && Platform.OS === "web");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" && videoRef.current) {
      setRemoteVideoEl(videoRef.current);
    }
  }, [setRemoteVideoEl, connected]);

  if (Platform.OS !== "web") return null;

  const pipBottom = chatOpen && !isWideLayout ? "46%" : 72;

  return (
    <View style={[styles.pip, { bottom: pipBottom }]} pointerEvents="none">
      {isLoading || !connected ? (
        <ActivityIndicator color={Colors.light.primary} />
      ) : (
        <video ref={videoRef as any} autoPlay playsInline style={videoStyle} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pip: {
    position: "absolute",
    right: 12,
    bottom: 72,
    width: 120,
    height: 160,
    borderRadius: 8,
    overflow: "hidden",
    // No border — green-screen overlay should feel seamless, no visible frame.
    backgroundColor: "transparent",
    zIndex: 20,
    justifyContent: "center",
    alignItems: "center",
  },
});
