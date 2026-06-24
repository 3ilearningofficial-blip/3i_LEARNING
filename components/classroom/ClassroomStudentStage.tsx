import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { DEFAULT_PIP_POSITION, normalizePipPosition, type ClassroomPipPosition } from "@/lib/classroom/mediaDevices";
import { startStudentChromaOverlay } from "@/lib/classroom/studentChromaOverlay";

type Props = {
  boardVideoRef: React.RefObject<HTMLVideoElement | null>;
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Corner where the teacher PiP sits; matches the recording composite. */
  pipPosition?: ClassroomPipPosition;
  /** From LiveKit teacher metadata — student re-keys raw camera locally. */
  greenScreen?: boolean;
  /** When false, PiP uses minimal bottom inset (portrait shell has controls below video). */
  controlsOnVideo?: boolean;
};

const boardStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  backgroundColor: "#000",
};

const hiddenVideoStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
};

const pipBaseStyle: React.CSSProperties = {
  position: "absolute",
  width: "22%",
  maxWidth: 180,
  minWidth: 96,
  aspectRatio: "3 / 4",
  objectFit: "cover",
  borderRadius: 8,
  zIndex: 5,
  backgroundColor: "transparent",
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  zIndex: 5,
  backgroundColor: "transparent",
  pointerEvents: "none",
};

function getPipStyleFor(
  position: ClassroomPipPosition,
  opts?: { controlsOnVideo?: boolean },
): React.CSSProperties {
  const narrow =
    Platform.OS === "web" && typeof window !== "undefined" && window.innerWidth < 768;
  const bottomInset = opts?.controlsOnVideo !== false && narrow ? 72 : 12;
  const onLeft = position === "top-left" || position === "bottom-left";
  const onBottom = position === "bottom-right" || position === "bottom-left";
  return {
    ...pipBaseStyle,
    ...(onLeft ? { left: 12 } : { right: 12 }),
    ...(onBottom ? { bottom: bottomInset } : { top: 12 }),
  };
}

function isFullBoardAspect(video: HTMLVideoElement): boolean {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return false;
  const aspect = video.videoWidth / video.videoHeight;
  return aspect > 1.6 && aspect < 1.9;
}

/**
 * Student live stage: board full-bleed + teacher overlay.
 * Green screen: raw camera is keyed on a canvas (alpha preserved over the board).
 */
export default function ClassroomStudentStage({
  boardVideoRef,
  cameraVideoRef,
  pipPosition = DEFAULT_PIP_POSITION,
  greenScreen = false,
  controlsOnVideo = true,
}: Props) {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pipStyle, setPipStyle] = useState<React.CSSProperties>(() =>
    getPipStyleFor(normalizePipPosition(pipPosition), { controlsOnVideo }),
  );
  const [useChromaOverlay, setUseChromaOverlay] = useState(greenScreen);
  const [fullOverlay, setFullOverlay] = useState(greenScreen);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      setPipStyle(getPipStyleFor(normalizePipPosition(pipPosition), { controlsOnVideo }));
      return;
    }

    const update = () =>
      setPipStyle(getPipStyleFor(normalizePipPosition(pipPosition), { controlsOnVideo }));
    update();
    window.addEventListener("resize", update);
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      mq.removeEventListener("change", update);
    };
  }, [pipPosition, controlsOnVideo]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = cameraVideoRef.current;
    if (!el) return;

    const check = () => {
      const gs = greenScreen || isFullBoardAspect(el);
      setUseChromaOverlay(gs);
      setFullOverlay(gs);
    };
    el.addEventListener("loadedmetadata", check);
    if (el.readyState >= 1) check();
    return () => el.removeEventListener("loadedmetadata", check);
  }, [cameraVideoRef, greenScreen]);

  useEffect(() => {
    if (Platform.OS !== "web" || !useChromaOverlay) return;
    const source = cameraVideoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!source || !canvas) return;
    return startStudentChromaOverlay(source, canvas, { fullOverlay: fullOverlay });
  }, [cameraVideoRef, useChromaOverlay, fullOverlay]);

  if (Platform.OS !== "web") return null;

  return (
    <View style={styles.wrap}>
      <video
        ref={boardVideoRef as React.RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        style={boardStyle}
      />
      <video
        ref={cameraVideoRef as React.RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        style={useChromaOverlay ? hiddenVideoStyle : fullOverlay ? overlayStyle : pipStyle}
      />
      {useChromaOverlay ? (
        <canvas
          ref={overlayCanvasRef as React.RefObject<HTMLCanvasElement>}
          style={fullOverlay ? overlayStyle : pipStyle}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    height: "100%",
    position: "relative",
    backgroundColor: "#000",
  },
});
