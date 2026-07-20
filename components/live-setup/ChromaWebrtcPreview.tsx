import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator } from "react-native";
import type { UseWebRTCStreamReturn } from "@/lib/useWebRTCStream";
import { attachChromaPreviewToVideo } from "@/lib/classroom/chromaPreviewStream";
import Colors from "@/constants/colors";

const videoStyle = { width: "100%", height: "100%", objectFit: "cover" as const, transform: "scaleX(-1)" };

type Props = {
  webrtc: UseWebRTCStreamReturn;
  greenScreen: boolean;
  compact?: boolean;
};

export default function ChromaWebrtcPreview({ webrtc, greenScreen, compact = false }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || !webrtc.stream || !videoRef.current) return;
    const cleanup = attachChromaPreviewToVideo(webrtc.stream, videoRef.current, greenScreen);
    return cleanup;
  }, [webrtc.stream, greenScreen]);

  if (Platform.OS !== "web") return null;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {webrtc.stream ? (
        <video ref={videoRef as React.RefObject<HTMLVideoElement>} autoPlay muted playsInline style={videoStyle} />
      ) : (
        <View style={[styles.placeholder, compact && styles.placeholderCompact]}>
          {webrtc.error ? (
            <Text style={styles.errorText}>{webrtc.error}</Text>
          ) : (
            <>
              <ActivityIndicator size="small" color={Colors.light.primary} />
              <Text style={styles.placeholderText}>Starting camera…</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  wrapCompact: {
    height: 108,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 8,
    backgroundColor: "#000",
  },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0D1B2A",
    gap: 8,
    padding: 12,
  },
  placeholderCompact: { height: 108 },
  placeholderText: { fontSize: 12, color: Colors.light.textMuted, textAlign: "center" },
  errorText: { fontSize: 12, color: Colors.light.error, textAlign: "center" },
});
