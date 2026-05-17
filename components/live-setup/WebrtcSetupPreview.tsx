import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useWebRTCStream, type UseWebRTCStreamReturn } from "@/lib/useWebRTCStream";
import Colors from "@/constants/colors";

const videoStyle = { width: "100%", height: "100%", objectFit: "cover" as const };

type Props = {
  webrtc?: UseWebRTCStreamReturn;
  /** Smaller preview for setup sidebar */
  compact?: boolean;
};

export default function WebrtcSetupPreview({ webrtc: webrtcProp, compact = false }: Props) {
  const webrtcInternal = useWebRTCStream(!webrtcProp);
  const webrtc = webrtcProp ?? webrtcInternal;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" && videoRef.current && webrtc.stream) {
      videoRef.current.srcObject = webrtc.stream;
    }
  }, [webrtc.stream]);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="videocam-off-outline" size={48} color="#666" />
        <Text style={styles.placeholderText}>Camera preview is available on web only</Text>
      </View>
    );
  }

  if (webrtc.error) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.errorText}>{webrtc.error}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {webrtc.stream ? (
        <video
          ref={videoRef as any}
          autoPlay
          muted
          playsInline
          style={compact ? videoStyleCompact : videoStyle}
        />
      ) : (
        <View style={[styles.placeholder, compact && styles.placeholderCompact]}>
          <ActivityIndicator size={compact ? "small" : "large"} color={Colors.light.primary} />
          <Text style={styles.placeholderText}>
            {compact ? "Allow camera access" : "Allow camera access to preview"}
          </Text>
        </View>
      )}
    </View>
  );
}

const videoStyleCompact = {
  width: "100%",
  height: "100%",
  objectFit: "cover" as const,
  transform: "scaleX(-1)",
};

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  wrapCompact: {
    flex: undefined,
    height: 108,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 8,
  },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0D1B2A",
    gap: 12,
    padding: 24,
  },
  placeholderCompact: {
    flex: undefined,
    height: 108,
    gap: 6,
    padding: 12,
  },
  placeholderText: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center" },
  errorText: { fontSize: 14, color: Colors.light.error, textAlign: "center" },
});
