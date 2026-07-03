import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { DEFAULT_PIP_POSITION, normalizePipPosition, type ClassroomPipPosition } from "@/lib/classroom/mediaDevices";
import { startStudentChromaOverlay } from "@/lib/classroom/studentChromaOverlay";

type Props = {
  onBoardVideoEl?: (el: HTMLVideoElement | null) => void;
  onCameraVideoEl?: (el: HTMLVideoElement | null) => void;
  /** Corner where the teacher PiP sits; matches the recording composite. */
  pipPosition?: ClassroomPipPosition;
  /** From LiveKit teacher metadata — student re-keys raw camera locally. */
  greenScreen?: boolean;
  /** When false, hide teacher PiP/overlay; board stays full-bleed. */
  cameraVisible?: boolean;
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
  zIndex: 5,
  backgroundColor: "transparent",
  border: "none",
  outline: "none",
  boxShadow: "none",
};

/** Green-screen teacher band: lower ~45% of the board so writing stays visible up top. */
const bottomOverlayStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: "45%",
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
    width: narrow ? "27%" : pipBaseStyle.width,
    maxWidth: narrow ? 200 : pipBaseStyle.maxWidth,
    ...(onLeft ? { left: 8 } : { right: 8 }),
    ...(onBottom ? { bottom: bottomInset } : { top: 8 }),
  };
}

/**
 * Student live stage: board full-bleed + teacher overlay.
 * Green screen: raw camera is keyed on a canvas (alpha preserved over the board).
 */
export default function ClassroomStudentStage({
  onBoardVideoEl,
  onCameraVideoEl,
  pipPosition = DEFAULT_PIP_POSITION,
  greenScreen = false,
  cameraVisible = true,
  controlsOnVideo = true,
}: Props) {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraVideoElRef = useRef<HTMLVideoElement | null>(null);
  const normalizedPip = normalizePipPosition(pipPosition);
  const [pipStyle, setPipStyle] = useState<React.CSSProperties>(() =>
    getPipStyleFor(normalizedPip, { controlsOnVideo }),
  );
  const useChromaOverlay = greenScreen === true;
  const fullOverlay = greenScreen === true;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      setPipStyle(getPipStyleFor(normalizedPip, { controlsOnVideo }));
      return;
    }

    const update = () => setPipStyle(getPipStyleFor(normalizedPip, { controlsOnVideo }));
    update();
    window.addEventListener("resize", update);
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      mq.removeEventListener("change", update);
    };
  }, [normalizedPip, controlsOnVideo]);

  useEffect(() => {
    if (Platform.OS !== "web" || !cameraVisible || !useChromaOverlay) return;
    const source = cameraVideoElRef.current;
    const canvas = overlayCanvasRef.current;
    if (!source || !canvas) return;
    return startStudentChromaOverlay(source, canvas, { fullOverlay });
  }, [useChromaOverlay, fullOverlay, cameraVisible]);

  const bindCameraRef = useCallback(
    (el: HTMLVideoElement | null) => {
      cameraVideoElRef.current = el;
      onCameraVideoEl?.(el);
    },
    [onCameraVideoEl]
  );

  if (Platform.OS !== "web") return null;

  const chromaOverlayStyle = fullOverlay ? bottomOverlayStyle : pipStyle;
  const cameraDisplayStyle = !cameraVisible
    ? hiddenVideoStyle
    : useChromaOverlay
      ? hiddenVideoStyle
      : pipStyle;

  return (
    <View style={styles.wrap}>
      <video ref={onBoardVideoEl} autoPlay playsInline style={boardStyle} />
      <video ref={bindCameraRef} autoPlay playsInline style={cameraDisplayStyle} />
      {cameraVisible && useChromaOverlay ? (
        <canvas
          ref={overlayCanvasRef as React.RefObject<HTMLCanvasElement>}
          style={chromaOverlayStyle}
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
