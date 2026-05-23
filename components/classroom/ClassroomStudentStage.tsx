import React, { useEffect, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";

type Props = {
  boardVideoRef: React.RefObject<HTMLVideoElement | null>;
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>;
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
  borderRadius: 10,
  border: "2px solid rgba(255,255,255,0.28)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
  zIndex: 5,
  backgroundColor: "transparent",
};

/** Student live stage: board full-bleed + responsive teacher PiP overlay. */
export default function ClassroomStudentStage({ boardVideoRef, cameraVideoRef }: Props) {
  const [pipStyle, setPipStyle] = useState<React.CSSProperties>(pipBaseStyle);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const update = () => {
      const landscape = window.matchMedia("(orientation: landscape)").matches;
      const wide = window.innerWidth >= 768;
      const topRight = wide || landscape;
      setPipStyle({
        ...pipBaseStyle,
        top: topRight ? 12 : undefined,
        right: 12,
        bottom: topRight ? undefined : 72,
      });
    };

    update();
    window.addEventListener("resize", update);
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      mq.removeEventListener("change", update);
    };
  }, []);

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
