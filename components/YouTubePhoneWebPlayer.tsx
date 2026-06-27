import React, { useMemo } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { buildYouTubeEmbedHtml } from "@/lib/buildYouTubePhoneWebSrcDoc";

const YOUTUBE_NOCOOKIE_BASE = "https://www.youtube-nocookie.com";

type Props = {
  videoId: string;
  resumeAt?: number;
  style?: StyleProp<ViewStyle>;
  onLoad?: () => void;
  onError?: () => void;
  onMessage?: (event: WebViewMessageEvent) => void;
  injectedJavaScript?: string;
};

/** Native Android/iOS: same masked YouTube player as phone web (not IFrame API). */
export function YouTubePhoneWebPlayer({
  videoId,
  resumeAt = 0,
  style,
  onLoad,
  onError,
  onMessage,
  injectedJavaScript,
}: Props) {
  const html = useMemo(
    () => buildYouTubeEmbedHtml(videoId, resumeAt),
    [videoId, resumeAt],
  );

  return (
    <WebView
      source={{ html, baseUrl: YOUTUBE_NOCOOKIE_BASE }}
      style={style}
      onLoad={onLoad}
      onError={onError}
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
