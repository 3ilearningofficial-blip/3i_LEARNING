import React, { useEffect, useMemo, useState } from "react";
import { View, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { getLectureListPreviewSpec } from "@/lib/lecture-list-preview";

const PREVIEW_SIZE = 60;

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
      <View style={styles.wrap} accessibilityLabel="Video preview">
        <Image
          source={{ uri: spec.uri }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      </View>
    );
  }

  const isPdf = spec.kind === "pdf";
  return (
    <View
      style={[styles.wrap, styles.fallback]}
      accessibilityLabel={isPdf ? "PDF lecture" : "Video lecture"}
    >
      <Ionicons
        name={isPdf ? "document-text" : "videocam"}
        size={22}
        color="rgba(255,255,255,0.88)"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: Colors.light.dark,
  },
  image: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e293b",
  },
});
