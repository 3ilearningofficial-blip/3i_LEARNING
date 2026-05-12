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
};

export function LectureListPreview({ videoUrl, pdfUrl }: Props) {
  const spec = useMemo(() => getLectureListPreviewSpec(videoUrl, pdfUrl), [videoUrl, pdfUrl]);
  const [imageFailed, setImageFailed] = useState(false);

  const imageUri = spec.kind === "image" ? spec.uri : "";

  useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  if (spec.kind === "image" && !imageFailed) {
    return (
      <View style={styles.wrapSurface} accessibilityLabel="Video preview">
        <Image
          source={{ uri: spec.uri }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      </View>
    );
  }

  if (spec.kind === "securedVideo") {
    return <SecuredVideoListThumbnail fileKey={spec.fileKey} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />;
  }

  const isPdf = spec.kind === "pdf";
  return (
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

const styles = StyleSheet.create({
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
