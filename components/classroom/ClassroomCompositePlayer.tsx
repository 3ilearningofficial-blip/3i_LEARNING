import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, Platform, ActivityIndicator, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import ClassroomStudentStage from "@/components/classroom/ClassroomStudentStage";
import { normalizePipPosition } from "@/lib/classroom/mediaDevices";
import {
  lockLandscapeForPlayback,
  restorePortraitAfterPlayback,
} from "@/lib/video-playback-orientation";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
  /** Teacher PiP corner chosen by the admin; defaults to top-right. */
  pipPosition?: string;
  /** portraitTop fills a fixed 16:9 slot; default centers in flex stage. */
  layout?: "default" | "portraitTop";
};

function resolveFrameDomNode(liveClassId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(`classroom-player-frame-${liveClassId}`) as HTMLElement | null;
}

/** Full-area LiveKit player for students (board + responsive teacher PiP + audio). */
export default function ClassroomCompositePlayer({
  liveClassId,
  enabled = true,
  pipPosition,
  layout = "default",
}: Props) {
  const { data: tokenPayload, isLoading } = useClassroomToken(liveClassId, enabled);
  const {
    setRemoteBoardEl,
    setRemoteCameraEl,
    setRemoteAudioEl,
    connected,
    reconnecting,
    error,
    teacherStreamMeta,
    teacherCameraActive,
  } = useLiveKitRoom(tokenPayload, enabled && Platform.OS === "web");
  const boardRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameDomRef = useRef<HTMLElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const onBoardVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      boardRef.current = el;
      if (el) setRemoteBoardEl(el);
    },
    [setRemoteBoardEl]
  );

  const onCameraVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) setRemoteCameraEl(el);
    },
    [setRemoteCameraEl]
  );

  const setFrameRef = useCallback(
    (node: View | null) => {
      if (Platform.OS !== "web") return;
      frameDomRef.current =
        (node as unknown as HTMLElement | null) || resolveFrameDomNode(liveClassId);
    },
    [liveClassId]
  );

  const getFullscreenElement = useCallback((): Element | null => {
    if (typeof document === "undefined") return null;
    const doc = document as Document & { webkitFullscreenElement?: Element };
    return doc.fullscreenElement || doc.webkitFullscreenElement || null;
  }, []);

  const enterIosVideoFullscreen = useCallback(() => {
    const video = boardRef.current;
    const iosFs =
      video && (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen;
    if (iosFs) {
      iosFs.call(video);
      void lockLandscapeForPlayback();
      setIsFullscreen(true);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const fsEl = getFullscreenElement();
    if (fsEl) {
      const exit =
        document.exitFullscreen?.bind(document) ||
        (document as Document & { webkitExitFullscreen?: () => void }).webkitExitFullscreen?.bind(
          document
        );
      void exit?.();
      return;
    }

    const frame =
      frameDomRef.current ||
      resolveFrameDomNode(liveClassId) ||
      (boardRef.current?.parentElement as HTMLElement | null);
    if (!frame) {
      enterIosVideoFullscreen();
      return;
    }

    const req =
      frame.requestFullscreen?.bind(frame) ||
      (frame as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.bind(
        frame
      );
    if (!req) {
      enterIosVideoFullscreen();
      return;
    }

    try {
      const result = req();
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>)
          .then(() => void lockLandscapeForPlayback())
          .catch(() => enterIosVideoFullscreen());
      } else {
        void lockLandscapeForPlayback();
      }
    } catch {
      enterIosVideoFullscreen();
    }
  }, [getFullscreenElement, enterIosVideoFullscreen, liveClassId]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onFs = () => {
      const active = !!getFullscreenElement();
      setIsFullscreen(active);
      if (active) void lockLandscapeForPlayback();
      else void restorePortraitAfterPlayback();
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs as EventListener);
    };
  }, [getFullscreenElement]);

  const setAudioRef = useCallback(
    (el: HTMLAudioElement | null) => {
      audioRef.current = el;
      if (el) setRemoteAudioEl(el);
    },
    [setRemoteAudioEl]
  );

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
  const cameraVisible =
    teacherCameraActive && teacherStreamMeta.cameraEnabled !== false;
  const effectivePipPosition = normalizePipPosition(
    teacherStreamMeta.pipPosition ?? pipPosition
  );

  return (
    <View style={[styles.wrap, isPortraitTop && styles.wrapPortraitTop]}>
      <View
        ref={setFrameRef}
        // @ts-expect-error web nativeID maps to DOM id for fullscreen lookup
        nativeID={`classroom-player-frame-${liveClassId}`}
        style={[styles.frame, isPortraitTop && styles.framePortraitTop]}
      >
        <ClassroomStudentStage
          onBoardVideoEl={onBoardVideoEl}
          onCameraVideoEl={onCameraVideoEl}
          pipPosition={effectivePipPosition}
          greenScreen={teacherStreamMeta.greenScreen === true}
          cameraVisible={cameraVisible}
          controlsOnVideo={!isPortraitTop}
        />
        <audio ref={setAudioRef as React.Ref<HTMLAudioElement>} autoPlay />

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

        <Pressable
          style={styles.fullscreenBtn}
          onPress={toggleFullscreen}
          accessibilityLabel={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          <Ionicons name={isFullscreen ? "contract-outline" : "scan-outline"} size={20} color="#fff" />
        </Pressable>
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
  fullscreenBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 12,
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
});
