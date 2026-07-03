import React, { useEffect } from "react";
import { View, StyleSheet, ActivityIndicator, Text, Pressable } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  useTracks,
  AudioSession,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
};

function CompositeVideoView() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });

  return (
    <View style={styles.videoWrap}>
      {tracks.map((trackRef, index) =>
        isTrackReference(trackRef) ? (
          <VideoTrack
            key={`classroom-composite-${index}`}
            trackRef={trackRef}
            style={styles.video}
            objectFit="contain"
          />
        ) : null
      )}
    </View>
  );
}

function RoomContent({
  isLoading,
  reconnecting,
}: {
  isLoading: boolean;
  reconnecting: boolean;
}) {
  if (isLoading || reconnecting) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
        <Text style={styles.loadingText}>{reconnecting ? "Reconnecting…" : "Connecting…"}</Text>
      </View>
    );
  }
  return <CompositeVideoView />;
}

/** Native in-app LiveKit viewer for pre-composited classroom video (board + teacher). */
export default function NativeClassroomPlayer({ liveClassId, enabled = true }: Props) {
  const { data: tokenPayload, isLoading, error, refetch } = useClassroomToken(liveClassId, enabled);

  useEffect(() => {
    if (!enabled) return;
    void activateKeepAwakeAsync(`classroom-${liveClassId}`);
    void AudioSession.startAudioSession();
    return () => {
      deactivateKeepAwake(`classroom-${liveClassId}`);
      void AudioSession.stopAudioSession();
    };
  }, [enabled, liveClassId]);

  if (!enabled) return null;

  if (error && !tokenPayload) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error.message || "Failed to connect"}</Text>
        <Pressable style={styles.retryBtn} onPress={() => void refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!tokenPayload?.token || !tokenPayload.url) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
        <Text style={styles.loadingText}>Preparing live stream…</Text>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={tokenPayload.url}
      token={tokenPayload.token}
      connect={enabled}
      audio
      video={false}
    >
      <RoomContent isLoading={isLoading} reconnecting={false} />
    </LiveKitRoom>
  );
}

const styles = StyleSheet.create({
  videoWrap: {
    flex: 1,
    backgroundColor: "#000",
    minHeight: 0,
  },
  video: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#000",
    zIndex: 2,
  },
  loadingText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#000",
    padding: 20,
  },
  errorText: { color: "#FCA5A5", fontSize: 14, textAlign: "center" },
  retryBtn: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: "#fff", fontWeight: "700" },
});
