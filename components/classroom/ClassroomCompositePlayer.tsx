import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, Platform, ActivityIndicator, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useClassroomToken } from "@/lib/classroom/useClassroomToken";
import { useLiveKitRoom } from "@/lib/classroom/useLiveKitRoom";
import {
  lockLandscapeForPlayback,
  restorePortraitAfterPlayback,
} from "@/lib/video-playback-orientation";
import StudentActivePollPanel from "@/components/classroom/StudentActivePollPanel";
import StudentPollStatsOverlay from "@/components/classroom/StudentPollStatsOverlay";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  enabled?: boolean;
  /** portraitTop fills a fixed 16:9 slot; default centers in flex stage. */
  layout?: "default" | "portraitTop";
  /** Fired when element/CSS immersive mode changes — parent should hide under-video poll/chat. */
  onImmersiveChange?: (immersive: boolean) => void;
};

function resolveFrameDomNode(liveClassId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(`classroom-player-frame-${liveClassId}`) as HTMLElement | null;
}

/** Full-area LiveKit player for students (single pre-composited board + teacher video). */
export default function ClassroomCompositePlayer({
  liveClassId,
  enabled = true,
  layout = "default",
  onImmersiveChange,
}: Props) {
  const { data: tokenPayload, isLoading } = useClassroomToken(liveClassId, enabled);
  const {
    setRemoteVideoEl,
    setRemoteAudioEl,
    connected,
    reconnecting,
    error,
    attachRemoteTeacher,
  } = useLiveKitRoom(tokenPayload, enabled);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameDomRef = useRef<HTMLElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [docFullscreen, setDocFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const immersive = docFullscreen || cssFullscreen;

  const bindFrameDom = useCallback((el: HTMLElement | null) => {
    frameDomRef.current = el;
  }, []);

  const onVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (el) setRemoteVideoEl(el);
    },
    [setRemoteVideoEl]
  );

  const getFullscreenElement = useCallback((): Element | null => {
    if (typeof document === "undefined") return null;
    const doc = document as Document & { webkitFullscreenElement?: Element };
    return doc.fullscreenElement || doc.webkitFullscreenElement || null;
  }, []);

  const enterCssFullscreen = useCallback(() => {
    // Prefer CSS immersive over iOS `webkitEnterFullscreen` on <video>:
    // native video FS cannot host poll/quiz overlays (siblings are excluded).
    setCssFullscreen(true);
    void lockLandscapeForPlayback();
    attachRemoteTeacher();
  }, [attachRemoteTeacher]);

  const exitCssFullscreen = useCallback(() => {
    setCssFullscreen(false);
    void restorePortraitAfterPlayback();
    attachRemoteTeacher();
  }, [attachRemoteTeacher]);

  const toggleFullscreen = useCallback(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    if (cssFullscreen) {
      exitCssFullscreen();
      return;
    }

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
      (videoRef.current?.parentElement as HTMLElement | null);
    if (!frame) {
      enterCssFullscreen();
      return;
    }

    const req =
      frame.requestFullscreen?.bind(frame) ||
      (frame as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.bind(
        frame
      );
    if (!req) {
      enterCssFullscreen();
      return;
    }

    try {
      const result = req();
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>)
          .then(() => void lockLandscapeForPlayback())
          .catch(() => enterCssFullscreen());
      } else {
        void lockLandscapeForPlayback();
      }
    } catch {
      enterCssFullscreen();
    }
  }, [cssFullscreen, exitCssFullscreen, getFullscreenElement, enterCssFullscreen, liveClassId]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onFs = () => {
      const active = !!getFullscreenElement();
      setDocFullscreen(active);
      if (active) {
        setCssFullscreen(false);
        void lockLandscapeForPlayback();
        attachRemoteTeacher();
      } else if (!cssFullscreen) {
        void restorePortraitAfterPlayback();
        attachRemoteTeacher();
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs as EventListener);
    };
  }, [getFullscreenElement, attachRemoteTeacher, cssFullscreen]);

  useEffect(() => {
    onImmersiveChange?.(immersive);
  }, [immersive, onImmersiveChange]);

  useEffect(() => {
    if (!cssFullscreen || Platform.OS !== "web" || typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitCssFullscreen();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cssFullscreen, exitCssFullscreen]);

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

  const frameContent = (
    <>
      <video
        ref={onVideoEl as React.Ref<HTMLVideoElement>}
        playsInline
        autoPlay
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          backgroundColor: "#000",
          display: "block",
        }}
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

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
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
        accessibilityLabel={immersive ? "Exit fullscreen" : "Enter fullscreen"}
      >
        <Ionicons name={immersive ? "contract-outline" : "scan-outline"} size={20} color="#fff" />
      </Pressable>

      {/* Overlays only in immersive mode. Outside FS the under-video / chat
          panels own poll UI — mounting both caused duplicates above & below title. */}
      {immersive ? (
        <>
          <View pointerEvents="box-none" style={styles.pollOverlay}>
            <StudentActivePollPanel liveClassId={liveClassId} enabled={enabled} compact />
          </View>
          <View pointerEvents="box-none" style={styles.pollOverlay}>
            <StudentPollStatsOverlay liveClassId={liveClassId} enabled={enabled} compact />
          </View>
        </>
      ) : null}
    </>
  );

  return (
    <View style={[styles.wrap, isPortraitTop && styles.wrapPortraitTop]}>
      <div
        id={`classroom-player-frame-${liveClassId}`}
        ref={bindFrameDom}
        style={
          cssFullscreen
            ? {
                position: "fixed",
                inset: 0,
                zIndex: 100000,
                width: "100vw",
                height: "100vh",
                maxWidth: "100vw",
                maxHeight: "100vh",
                backgroundColor: "#000",
              }
            : {
                width: "100%",
                height: isPortraitTop ? "100%" : undefined,
                maxHeight: "100%",
                aspectRatio: isPortraitTop ? undefined : "16 / 9",
                maxWidth: "100%",
                position: "relative",
                backgroundColor: "#000",
              }
        }
      >
        {frameContent}
      </div>
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
  wrapPortraitTop: {
    flex: 1,
    width: "100%",
    height: "100%",
    minHeight: 0,
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
  errorBanner: {
    position: "absolute",
    bottom: 56,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: "rgba(220,38,38,0.9)",
    padding: 10,
    borderRadius: 8,
  },
  errorText: { color: "#fff", fontSize: 12, textAlign: "center" },
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
  pollOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 20,
    maxHeight: "80%",
  },
});
