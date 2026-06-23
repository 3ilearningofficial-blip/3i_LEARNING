import React, { useEffect, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { DEFAULT_PIP_POSITION, type ClassroomPipPosition } from "@/lib/classroom/mediaDevices";

type Props = {
  boardVideoRef: React.RefObject<HTMLVideoElement | null>;
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Corner where the teacher PiP sits; matches the recording composite. */
  pipPosition?: ClassroomPipPosition;
  /** When false, PiP uses minimal bottom inset (portrait shell has controls below video). */
  controlsOnVideo?: boolean;
};

const boardStyle = {
  width: "100%",
  height: "100%",
  objectFit: "contain" as const,
  backgroundColor: "#000",
};

const pipBaseStyle: React.CSSProperties = {
  position: "absolute",
  width: "22%",
  maxWidth: 160,
  minWidth: 88,
  aspectRatio: "4 / 3",
  objectFit: "cover",
  borderRadius: 0,
  zIndex: 5,
  backgroundColor: "transparent",
};

function getPipStyleFor(
  position: ClassroomPipPosition,
  opts?: { controlsOnVideo?: boolean },
): React.CSSProperties {
  const narrow =
    Platform.OS === "web" && typeof window !== "undefined" && window.innerWidth < 768;
  const bottomInset = opts?.controlsOnVideo !== false && narrow ? 72 : 12;
  if (position === "bottom-right") {
    return { ...pipBaseStyle, right: 12, bottom: bottomInset };
  }
  return { ...pipBaseStyle, right: 12, top: 12 };
}

/** Student live stage: board full-bleed + teacher PiP overlay in the admin-chosen corner. */
export default function ClassroomStudentStage({
  boardVideoRef,
  cameraVideoRef,
  pipPosition = DEFAULT_PIP_POSITION,
  controlsOnVideo = true,
}: Props) {
  const [pipStyle, setPipStyle] = useState<React.CSSProperties>(() =>
    getPipStyleFor(pipPosition, { controlsOnVideo }),
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      setPipStyle(getPipStyleFor(pipPosition, { controlsOnVideo }));
      return;
    }

    const update = () => setPipStyle(getPipStyleFor(pipPosition, { controlsOnVideo }));

    update();
    window.addEventListener("resize", update);
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      mq.removeEventListener("change", update);
    };
  }, [pipPosition, controlsOnVideo]);

  if (Platform.OS !== "web") return null;

  return (
    <View style={styles.wrap}>
      <video ref={boardVideoRef as React.RefObject<HTMLVideoElement>} autoPlay playsInline style={boardStyle} />
      <video
        ref={cameraVideoRef as React.RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        style={pipStyle}
      />
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
