import React, { useEffect, useState } from "react";
import { View, Image, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as VideoThumbnails from "expo-video-thumbnails";
import { fetchMediaToken, getApiUrl } from "@/lib/query-client";
import { buildMediaUrlWithToken } from "@/lib/media-playback-url";
import { captureVideoPosterWeb } from "@/lib/web-video-poster-capture";

const PREVIEW_SURFACE = "#FFFFFF";
const PREVIEW_BORDER = "#E2EAFF";
const VIDEO_ICON_RED = "#DC2626";
const VIDEO_CIRCLE_BG = "#FEE2E2";

type Props = {
  fileKey: string;
  width: number;
  height: number;
};

/**
 * List preview for `/api/media/` lecture videos: mints a read token, decodes one frame
 * (expo-video-thumbnails on native; video + canvas on web).
 */
export function SecuredVideoListThumbnail({ fileKey, width, height }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        setFailed(false);
        setUri(null);
        const tok = await fetchMediaToken(fileKey);
        if (cancelled) return;
        if (!tok.ok) {
          setFailed(true);
          return;
        }
        const playUrl = tok.readUrl ?? buildMediaUrlWithToken(getApiUrl(), fileKey, tok.token);
        const maxSide = Math.max(320, Math.round(Math.max(width, height) * (Platform.OS === "web" ? 2.5 : 2)));

        if (Platform.OS === "web") {
          try {
            objectUrl = await captureVideoPosterWeb(playUrl, maxSide);
            if (cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setUri(objectUrl);
          } catch {
            if (objectUrl) {
              URL.revokeObjectURL(objectUrl);
              objectUrl = null;
            }
            if (!cancelled) setFailed(true);
          }
          return;
        }

        const { uri: nativeUri } = await VideoThumbnails.getThumbnailAsync(playUrl, {
          time: 1500,
        });
        if (cancelled) return;
        setUri(nativeUri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileKey, width, height]);

  if (uri) {
    return (
      <View style={[styles.wrapSurface, { width, height }]} accessibilityLabel="Video preview">
        <Image source={{ uri }} style={[styles.image, { width, height }]} resizeMode="cover" />
      </View>
    );
  }

  if (failed) {
    return (
      <View style={[styles.wrapSurface, styles.centered, { width, height }]} accessibilityLabel="Video lecture">
        <View style={styles.iconCircle}>
          <Ionicons name="videocam" size={22} color={VIDEO_ICON_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrapSurface, styles.centered, { width, height }]} accessibilityLabel="Loading video preview">
      <View style={styles.iconCircle}>
        <Ionicons name="videocam" size={22} color={VIDEO_ICON_RED} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapSurface: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: PREVIEW_SURFACE,
    borderWidth: 1,
    borderColor: PREVIEW_BORDER,
  },
  image: {
    borderRadius: 8,
  },
  centered: {
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
});
