import React, { useEffect, useState } from "react";
import { View, Image, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as VideoThumbnails from "expo-video-thumbnails";
import Colors from "@/constants/colors";
import { fetchMediaToken, getApiUrl } from "@/lib/query-client";
import { buildMediaUrlWithToken } from "@/lib/media-playback-url";
import { captureVideoPosterWeb } from "@/lib/web-video-poster-capture";

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
      <View style={[styles.wrap, { width, height }]} accessibilityLabel="Video preview">
        <Image source={{ uri }} style={[styles.image, { width, height }]} resizeMode="cover" />
      </View>
    );
  }

  if (failed) {
    return (
      <View style={[styles.wrap, styles.fallback, { width, height }]} accessibilityLabel="Video lecture">
        <Ionicons name="videocam" size={26} color="rgba(255,255,255,0.9)" />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, styles.loading, { width, height }]} accessibilityLabel="Loading video preview">
      <ActivityIndicator size="small" color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: Colors.light.primary,
  },
  image: {
    borderRadius: 8,
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#64748B",
  },
});
