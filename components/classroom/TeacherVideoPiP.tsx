import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
};

const videoStyle = { width: "100%", height: "100%", objectFit: "cover" as const };

export default function TeacherVideoPiP({ liveClassId, enabled = true }: Props) {
  const { data: tokenPayload, isLoading } = useClassroomToken(liveClassId, enabled);
  const { setRemoteVideoEl, connected } = useLiveKitRoom(tokenPayload, enabled && Platform.OS === "web");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" && videoRef.current) {
      setRemoteVideoEl(videoRef.current);
    }
  }, [setRemoteVideoEl, connected]);

  if (Platform.OS !== "web") return null;

  return (
    <View style={styles.pip} pointerEvents="none">
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
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
    zIndex: 20,
    justifyContent: "center",
    alignItems: "center",
  },
});
