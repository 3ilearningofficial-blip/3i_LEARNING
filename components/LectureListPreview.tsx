import React, { useEffect, useMemo, useState } from "react";
import { View, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { getLectureListPreviewSpec } from "@/lib/lecture-list-preview";
import { SecuredVideoListThumbnail } from "@/components/SecuredVideoListThumbnail";

/** Wider than tall so video stills (16:9) read clearly in course lecture lists. */
const PREVIEW_WIDTH = 128;
const PREVIEW_HEIGHT = 72;

const PREVIEW_SURFACE = "#FFFFFF";
const PREVIEW_BORDER = "#E2EAFF";
const VIDEO_ICON_RED = "#DC2626";
const VIDEO_CIRCLE_BG = "#FEE2E2";

type Props = {
  videoUrl?: string | null;
  pdfUrl?: string | null;
  /** 0-100 watch progress; renders a thin bar at the bottom of the thumbnail. */
  progressPercent?: number;
  /** When true the bar is full + green (lecture completed). */
  completed?: boolean;
};

/** YouTube-style watch-progress bar pinned to the bottom of the thumbnail. */
function ProgressBar({ progressPercent, completed }: { progressPercent?: number; completed?: boolean }) {
  const pct = completed ? 100 : Math.max(0, Math.min(100, Math.round(progressPercent || 0)));
  if (!completed && pct <= 0) return null;
  return (
    <View style={styles.progressTrack} pointerEvents="none">
      <View
        style={[
          styles.progressFill,
          { width: `${pct}%`, backgroundColor: completed ? "#22C55E" : VIDEO_ICON_RED },
        ]}
      />
    </View>
  );
}

export function LectureListPreview({ videoUrl, pdfUrl, progressPercent, completed }: Props) {
  const spec = useMemo(() => getLectureListPreviewSpec(videoUrl, pdfUrl), [videoUrl, pdfUrl]);
  const [imageFailed, setImageFailed] = useState(false);

  const imageUri = spec.kind === "image" ? spec.uri : "";

  useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  let content: React.ReactNode;
  if (spec.kind === "image" && !imageFailed) {
    content = (
      <View style={styles.wrapSurface} accessibilityLabel="Video preview">
        <Image
          source={{ uri: spec.uri }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      </View>
    );
  } else if (spec.kind === "securedVideo") {
    content = <SecuredVideoListThumbnail fileKey={spec.fileKey} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />;
  } else {
    const isPdf = spec.kind === "pdf";
    content = (
      <View
        style={[styles.wrapSurface, styles.fallback]}
        accessibilityLabel={isPdf ? "PDF lecture" : "Video lecture"}
      >
        <View style={[styles.iconCircle, isPdf ? styles.iconCirclePdf : null]}>
          <Ionicons
            name={isPdf ? "document-text" : "videocam"}
            size={22}
            color={isPdf ? Colors.light.primary : VIDEO_ICON_RED}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.outer}>
      {content}
      <ProgressBar progressPercent={progressPercent} completed={completed} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    position: "relative",
  },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderBottomLeftRadius: 8,
  },
  wrapSurface: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: PREVIEW_SURFACE,
    borderWidth: 1,
    borderColor: PREVIEW_BORDER,
  },
  image: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: VIDEO_CIRCLE_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCirclePdf: {
    backgroundColor: "#EEF2FF",
  },
});
