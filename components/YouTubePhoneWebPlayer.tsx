import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  buildNativeYouTubeFallbackHtml,
  buildNativeYouTubeHtml,
} from "@/lib/buildNativeYouTubeHtml";

const YOUTUBE_BASE = "https://www.youtube.com";

type Props = {
  videoId: string;
  resumeAt?: number;
  /** Clip end seconds (live-class completed recording). */
  endAt?: number;
  style?: StyleProp<ViewStyle>;
  onLoad?: () => void;
  onError?: () => void;
  onMessage?: (event: WebViewMessageEvent) => void;
  injectedJavaScript?: string;
};

/**
 * Native Android/iOS YouTube player via RN WebView.
 * Uses YouTube IFrame API (same approach as live-class); falls back to a
 * simple embed with origin=3ilearning.in if the primary HTML fails to load.
 */
export function YouTubePhoneWebPlayer({
  videoId,
  resumeAt = 0,
  endAt,
  style,
  onLoad,
  onError,
  onMessage,
  injectedJavaScript,
}: Props) {
  const [useFallback, setUseFallback] = useState(false);
  const loadNotifiedRef = useRef(false);

  useEffect(() => {
    setUseFallback(false);
    loadNotifiedRef.current = false;
  }, [videoId, resumeAt, endAt]);

  const html = useMemo(() => {
    const opts = { startAt: resumeAt, endAt };
    return useFallback
      ? buildNativeYouTubeFallbackHtml(videoId, opts)
      : buildNativeYouTubeHtml(videoId, opts);
  }, [videoId, resumeAt, endAt, useFallback]);

  const notifyLoaded = useCallback(() => {
    if (loadNotifiedRef.current) return;
    loadNotifiedRef.current = true;
    onLoad?.();
  }, [onLoad]);

  const triggerFallback = useCallback(() => {
    if (!useFallback) {
      loadNotifiedRef.current = false;
      setUseFallback(true);
      return true;
    }
    onError?.();
    return false;
  }, [onError, useFallback]);

  return (
    <WebView
      source={{ html, baseUrl: YOUTUBE_BASE }}
      style={style}
      onLoad={notifyLoaded}
      onLoadEnd={notifyLoaded}
      onHttpError={() => {
        triggerFallback();
      }}
      onError={() => {
        triggerFallback();
      }}
      onMessage={onMessage}
      injectedJavaScript={injectedJavaScript}
      allowsFullscreenVideo
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      scrollEnabled={false}
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="compatibility"
      setSupportMultipleWindows={false}
      originWhitelist={["*"]}
    />
  );
}
