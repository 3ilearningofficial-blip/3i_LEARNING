import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator, useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getBaseUrl, apiRequest, fetchMediaToken, toHttpsMediaUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { useVideoScreenProtection } from "@/lib/useVideoScreenProtection";
import { isAndroidWeb } from "@/lib/useAndroidWebGate";
import AndroidWebGate from "@/components/AndroidWebGate";
import { DownloadButton } from "@/components/DownloadButton";
import { extractMediaFileKey } from "@/lib/media-key";
import { YouTubePhoneWebPlayer } from "@/components/YouTubePhoneWebPlayer";
import { buildYouTubeEmbedHtml } from "@/lib/buildYouTubePhoneWebSrcDoc";
import {
  handlePlaybackFullscreenMessage,
  useVideoPlaybackOrientation,
} from "@/lib/video-playback-orientation";

const mediaTokenCache = new Map<string, { token: string; expiresAt: number; readUrl?: string }>();

function getIconName(fileType: string): keyof typeof Ionicons.glyphMap {
  switch (fileType) {
    case "pdf": return "document-text";
    case "video": return "videocam";
    case "doc": return "document";
    default: return "link";
  }
}

function getGoogleDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  return null;
}

function isGoogleDriveUrl(url: string): boolean {
  return url.includes("drive.google.com") || url.includes("docs.google.com");
}

function getYouTubeVideoId(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1).split("?")[0] || null;
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtube-nocookie.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
      const parts = parsed.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex(p => ["embed", "shorts", "live", "v"].includes(p));
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch (_e) {}
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  return m?.[1] || null;
}


function buildGoogleDriveViewerHtml(fileId: string): string {
  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #2a2a2a; overflow: hidden; -webkit-user-select: none; user-select: none; }
.wrapper { position: relative; width: 100%; height: 100%; overflow: hidden; }
iframe { width: 100%; height: 100%; border: none; }
/* Cover Google Drive UI elements: share button, open-in-new-window, download */
.cover-top-right {
  position: absolute; top: 0; right: 0;
  width: 80px; height: 56px;
  background: #2a2a2a; z-index: 100;
  pointer-events: auto; cursor: default;
}
.cover-bottom {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 4px; background: #2a2a2a; z-index: 100;
}
/* Cover the "Open with" / pop-out button area */
.cover-top-left {
  position: absolute; top: 0; left: 0;
  width: 56px; height: 56px;
  background: #2a2a2a; z-index: 100;
  pointer-events: auto; cursor: default;
}
@media print { body { display: none !important; } }
</style>
</head><body>
<div class="wrapper">
  <div class="cover-top-right"></div>
  <div class="cover-top-left"></div>
  <div class="cover-bottom"></div>
  <iframe src="${previewUrl}" allow="autoplay; fullscreen" sandbox="allow-scripts allow-same-origin"></iframe>
</div>
<script>
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
document.addEventListener('keydown', function(e) {
  if (e.key === 'PrintScreen' || (e.ctrlKey && (e.key === 'p' || e.key === 'P' || e.key === 's' || e.key === 'S'))) {
    e.preventDefault();
  }
});
</script>
</body></html>`;
}

function buildPdfViewerHtml(fileUrl: string, proxyBaseUrl: string): string {
  const gviewUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(fileUrl)}`;
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #2a2a2a; overflow: auto; font-family: -apple-system, sans-serif; -webkit-overflow-scrolling: touch; -webkit-user-select: none; user-select: none; }
#viewer { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0; }
.page-canvas { display: block; max-width: 100%; height: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.3); background: #fff; pointer-events: none; }
.loading { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px; color: #ccc; background: #2a2a2a; z-index: 10; }
.spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #1A56DB; border-radius: 50%; animation: spin 0.8s linear infinite; }
@media print { body { display: none !important; } }
@keyframes spin { to { transform: rotate(360deg); } }
.fallback-frame { position: fixed; top: 0; left: 0; width: 100%; height: 100%; border: none; z-index: 5; }
.error { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px; color: #ccc; padding: 32px; text-align: center; background: #2a2a2a; z-index: 20; }
.error h3 { font-size: 18px; color: #fff; }
.error p { font-size: 13px; color: #999; line-height: 1.5; }
.error a { display: inline-block; color: #fff; background: #1A56DB; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 600; margin-top: 4px; }
.page-info { color: #888; font-size: 12px; padding: 4px 0; }
</style>
</head><body>
<div id="loading" class="loading"><div class="spinner"></div><p>Loading PDF...</p></div>
<div id="viewer"></div>
<script>
(function() {
  var directUrl = ${JSON.stringify(fileUrl)};
  var gviewUrl = ${JSON.stringify(gviewUrl)};
  
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function renderWithPdfJs(url) {
    return pdfjsLib.getDocument({
      url: url,
      withCredentials: true,
    }).promise.then(function(pdf) {
      document.getElementById('loading').style.display = 'none';
      var viewer = document.getElementById('viewer');
      viewer.innerHTML = '';
      var numPages = pdf.numPages;

      function renderPage(num) {
        pdf.getPage(num).then(function(page) {
          var containerWidth = Math.min(window.innerWidth - 16, 900);
          var viewport = page.getViewport({ scale: 1 });
          var scale = containerWidth / viewport.width;
          var scaledViewport = page.getViewport({ scale: scale * 2 });

          var canvas = document.createElement('canvas');
          canvas.className = 'page-canvas';
          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          canvas.style.width = (scaledViewport.width / 2) + 'px';
          canvas.style.height = (scaledViewport.height / 2) + 'px';
          viewer.appendChild(canvas);

          var info = document.createElement('div');
          info.className = 'page-info';
          info.textContent = 'Page ' + num + ' of ' + numPages;
          viewer.appendChild(info);

          page.render({ canvasContext: canvas.getContext('2d'), viewport: scaledViewport }).promise.then(function() {
            if (num < numPages) renderPage(num + 1);
          });
        });
      }
      renderPage(1);
    });
  }

  function showGoogleViewer() {
    document.getElementById('loading').style.display = 'none';
    var iframe = document.createElement('iframe');
    iframe.className = 'fallback-frame';
    iframe.src = gviewUrl;
    document.body.appendChild(iframe);
  }

  function showError() {
    document.getElementById('loading').style.display = 'none';
    var d = document.createElement('div');
    d.className = 'error';
    d.innerHTML = '<h3>Unable to preview</h3><p>This PDF cannot be previewed inline.</p><a href="'+directUrl+'" target="_blank">Open PDF Directly</a>';
    document.body.appendChild(d);
  }

  renderWithPdfJs(directUrl)
    .catch(function() {
      showGoogleViewer();
      setTimeout(function() {
        var frames = document.querySelectorAll('.fallback-frame');
        if (frames.length > 0) {
          try {
            var doc = frames[0].contentDocument;
            if (doc && doc.body && doc.body.innerText && doc.body.innerText.indexOf('No preview') >= 0) {
              frames[0].remove();
              showError();
            }
          } catch(e) {}
        }
      }, 10000);
    });
})();
// Security: block right-click, print, save shortcuts
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
document.addEventListener('keydown', function(e) {
  if (e.key === 'PrintScreen' || (e.ctrlKey && (e.key === 'p' || e.key === 'P' || e.key === 's' || e.key === 'S'))) {
    e.preventDefault();
  }
});
</script>
</body></html>`;
}

export default function MaterialViewerScreen() {
  useScreenProtection(true);
  useVideoPlaybackOrientation();
  const { colors } = useAppTheme();
  if (isAndroidWeb()) return <AndroidWebGate />;
  const { id, localUri } = useLocalSearchParams<{ id: string; localUri?: string }>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [mediaToken, setMediaToken] = useState<string | null>(null);
  const [mediaReadUrl, setMediaReadUrl] = useState<string | null>(null);
  const [mediaTokenError, setMediaTokenError] = useState<string | null>(null);
  const [mediaTokenRetryTick, setMediaTokenRetryTick] = useState(0);
  const [youtubePlayerError, setYoutubePlayerError] = useState(false);
  const [youtubePlayerRetryTick, setYoutubePlayerRetryTick] = useState(0);
  const qc = useQueryClient();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const { isAdmin, user } = useAuth();

  // 16:9 video height based on screen width
  const videoHeight = Math.round(screenWidth * 9 / 16);

  const { data: material, isError: fetchError } = useQuery<{
    id: number; title: string; file_url: string; file_type: string;
    description: string; download_allowed: boolean; is_free: boolean;
    section_title: string | null; course_id?: number | null;
  }>({
    queryKey: ["/api/study-materials", id],
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
  });

  useEffect(() => {
    const cid = Number(material?.course_id);
    if (!cid || !Number.isFinite(cid)) return;
    const uidSeg = String(user?.id ?? "guest");
    qc.prefetchQuery({
      queryKey: ["/api/courses", String(cid), uidSeg],
      queryFn: async () => {
        const res = await apiRequest("GET", `/courses/${cid}`);
        if (!res.ok) throw new Error("prefetch course failed");
        return res.json();
      },
      staleTime: 30000,
    });
  }, [material?.course_id, qc, user?.id]);

  // Apply enhanced video protection only for local video playback
  const isPlayingLocalVideo = !!localUri && material?.file_type === 'video';
  useVideoScreenProtection(isPlayingLocalVideo);

  // Convert R2 CDN URLs to server proxy URLs (same as lecture viewer)
  // Skip conversion for local file:// URIs
  const fileUrl = (() => {
    if (localUri) return localUri;
    const raw = material?.file_url || "";
    if (!raw) return "";
    if (raw.startsWith('file://')) return raw;

    // Already a full R2/CDN URL â€” serve directly
    if (raw.startsWith("https://cdn.3ilearning.in/")) return raw;
    if (raw.includes("r2.cloudflarestorage.com")) return raw;
    if (raw.includes("pub-") && raw.includes(".r2.dev")) return raw;

    // /api/media/* always hits the API host (not the web app origin) so auth + HTTPS stay correct.
    if (raw.includes("/api/media/")) {
      const path = raw.startsWith("/") ? raw : raw.replace(/^https?:\/\/[^/]+/, "");
      const normalized = path.startsWith("/") ? path : `/${path}`;
      return toHttpsMediaUrl(`${getBaseUrl()}${normalized}`);
    }

    // Google Drive / Docs â€” use as-is
    if (raw.includes("drive.google.com") || raw.includes("docs.google.com")) return raw;

    // Relative path â€” prepend base
    if (raw.startsWith("/")) return toHttpsMediaUrl(`${getBaseUrl()}${raw}`);

    // Anything else (YouTube, external URLs) â€” use as-is
    return raw;
  })();

  const isPdf = material && (material.file_type === "pdf" || fileUrl?.toLowerCase().endsWith(".pdf"));
  const isGDrive = material && isGoogleDriveUrl(fileUrl || "");
  const gDriveFileId = material ? getGoogleDriveFileId(fileUrl || "") : null;
  const youtubeVideoId = material ? getYouTubeVideoId(fileUrl || "") : null;
  const isYouTube = !!youtubeVideoId;
  const apiBaseUrl = getBaseUrl();

  useEffect(() => {
    if (Platform.OS !== "web" || !isYouTube || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      handlePlaybackFullscreenMessage(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isYouTube]);

  // Extract the R2 file key from the URL for token generation
  const fileKey = extractMediaFileKey(material?.file_url);
  const userScopedFileKey = `${String(user?.id || "guest")}:${fileKey || ""}`;

  // Fetch a short-lived media token for PDF/video viewing (avoids srcDoc cookie issues)
  useEffect(() => {
    if (!fileKey || !material) {
      setMediaToken(null);
      setMediaReadUrl(null);
      setMediaTokenError(null);
      setLoading(false);
      return;
    }
    if (isGDrive || isYouTube) return; // not needed for these

    // Free materials are served by /api/media/* without authentication.
    // The pdf-viewer endpoint also accepts free files without a token.
    // Skipping the token fetch prevents spurious 401s when the session has
    // expired or the user is not logged in (free content should always load).
    if (material.is_free) {
      setMediaToken(null);
      setMediaReadUrl(null);
      setMediaTokenError(null);
      setLoading(false);
      return;
    }

    const cached = mediaTokenCache.get(userScopedFileKey);
    if (cached && cached.expiresAt > Date.now()) {
      setMediaToken(cached.token);
      // Only use the presigned readUrl if it has more than 90 seconds of life left.
      // Presigned R2 URLs share the same ~10-min TTL as the media token, but clocks
      // and round-trip time mean they can expire slightly before expiresAt.  Within
      // the last 90 s we fall back to the /api/media/* proxy URL (token is still
      // valid so it will be accepted) rather than serving an about-to-expire URL.
      const readUrlSafe = cached.readUrl && cached.expiresAt > Date.now() + 90_000
        ? cached.readUrl
        : null;
      setMediaReadUrl(readUrlSafe);
      setMediaTokenError(null);
      return;
    }
    let cancelled = false;
    setMediaToken(null);
    setMediaReadUrl(null);
    setMediaTokenError(null);
    void (async () => {
      const r = await fetchMediaToken(fileKey);
      if (cancelled) return;
      if (r.ok) {
        setMediaToken(r.token);
        setMediaReadUrl(r.readUrl ?? null);
        mediaTokenCache.set(userScopedFileKey, {
          token: r.token,
          expiresAt: r.expiresAt,
          ...(r.readUrl ? { readUrl: r.readUrl } : {}),
        });
        return;
      }
      setMediaReadUrl(null);
      setMediaToken(null);
      const msg =
        r.status === 401
          ? "Sign in again to open this file (session expired)."
          : r.status === 403
            ? "You do not have access to this material."
            : r.message || `Could not unlock file (${r.status}).`;
      setMediaTokenError(msg);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey, material?.id, isGDrive, isYouTube, mediaTokenRetryTick, userScopedFileKey]);

  // Authenticated URL with token (always use API base â€” never the Vercel preview origin on web)
  const tokenizedUrl = toHttpsMediaUrl(
    mediaToken && fileKey
      ? mediaReadUrl || `${apiBaseUrl}/api/media/${fileKey}?token=${mediaToken}`
      : (fileUrl || "")
  ) || fileUrl;

  // PDF viewer URL â€” server-rendered page with pdf.js (no browser PDF controls).
  // For paid materials we include the short-lived media token.
  // For free materials the backend now accepts the request without a token, so
  // we omit it â€” this prevents 401s when the session has expired.
  const pdfViewerUrl = fileKey
    ? (mediaToken
        ? `${apiBaseUrl}/api/pdf-viewer?key=${encodeURIComponent(fileKey)}&token=${mediaToken}`
        : material?.is_free
          ? `${apiBaseUrl}/api/pdf-viewer?key=${encodeURIComponent(fileKey)}`
          : null)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* For YouTube: fullscreen with floating back button only */}
      {isYouTube ? (
        <View style={{ flex: 1, backgroundColor: "#000", overflow: "hidden" as const, justifyContent: "center" }}>
          {/* Back button â€” top-left of screen, above video */}
          <Pressable
            style={[styles.backBtn, {
              position: "absolute",
              top: Platform.OS === "web" ? 12 : insets.top + 8,
              left: 12,
              zIndex: 200,
              backgroundColor: "rgba(255,255,255,0.15)",
            }]}
            onPress={() => {
              if (Platform.OS === "web") {
                window.history.back();
              } else {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.back();
              }
            }}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          {/* 16:9 video container */}
          <View style={styles.playerContainer}>
            {Platform.OS === "web" ? (
              <iframe
                srcDoc={buildYouTubeEmbedHtml(youtubeVideoId!)}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                title={material?.title || "Video"}
                onLoad={() => setLoading(false)}
              />
            ) : !youtubePlayerError ? (
              <YouTubePhoneWebPlayer
                key={`yt-material-${youtubePlayerRetryTick}-${youtubeVideoId}`}
                videoId={youtubeVideoId!}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={() => { setLoading(false); setYoutubePlayerError(false); }}
                onError={() => { setLoading(false); setYoutubePlayerError(true); }}
                onMessage={(event) => handlePlaybackFullscreenMessage(event.nativeEvent.data)}
              />
            ) : (
              <View style={[styles.loadingOverlay, { backgroundColor: "rgba(0,0,0,0.92)" }]}>
                <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
                <Text style={{ color: "#fff", marginTop: 12, fontFamily: "Inter_500Medium", textAlign: "center", paddingHorizontal: 24 }}>
                  Video unavailable. Check your connection and try again.
                </Text>
                <Pressable
                  style={{ marginTop: 16, backgroundColor: Colors.light.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }}
                  onPress={() => {
                    setYoutubePlayerError(false);
                    setLoading(true);
                    setYoutubePlayerRetryTick((t) => t + 1);
                  }}
                >
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>Retry</Text>
                </Pressable>
              </View>
            )}
            {loading && !youtubePlayerError && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
            )}
          </View>
        </View>
      ) : (
        <>
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
            <View style={styles.headerRow}>
              <Pressable
                style={styles.backBtn}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.back();
                }}
              >
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </Pressable>
              <View style={styles.headerInfo}>
                <Text style={styles.headerTitle} numberOfLines={1}>{material?.title || "Study Material"}</Text>
                {material && (
                  <View style={styles.headerMeta}>
                    <Ionicons name={getIconName(material.file_type)} size={12} color="rgba(255,255,255,0.6)" />
                    <Text style={styles.headerMetaText}>{material.file_type?.toUpperCase() || "FILE"}</Text>
                    {material.is_free && (
                      <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>
                    )}
                  </View>
                )}
              </View>
              <View style={styles.headerActions}>
                {material && (
                  <DownloadButton
                    itemType="material"
                    itemId={material.id}
                    downloadAllowed={material.download_allowed}
                    isEnrolled={true}
                    title={material.title || 'Study material'}
                    fileType={material.file_type || 'pdf'}
                  />
                )}
              </View>
            </View>
          </LinearGradient>

          <View style={styles.content}>
            {material && fileKey && mediaTokenError && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#FEF2F2", borderBottomWidth: 1, borderBottomColor: "#FECACA" }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: "#991B1B" }}>{mediaTokenError}</Text>
                <Pressable
                  style={[styles.retryBtn, { marginTop: 10, alignSelf: "flex-start" }]}
                  onPress={() => {
                    setMediaTokenError(null);
                    setMediaTokenRetryTick((t) => t + 1);
                  }}
                >
                  <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
              </View>
            )}
            {fetchError ? (
              <View style={styles.centered}>
                <Ionicons name="alert-circle-outline" size={48} color={Colors.light.accent} />
                <Text style={styles.errorTitle}>Failed to load material</Text>
                <Text style={styles.errorSub}>Please check your connection and try again.</Text>
                <Pressable style={styles.retryBtn} onPress={() => router.back()}>
                  <Ionicons name="arrow-back" size={16} color="#fff" />
                  <Text style={styles.retryBtnText}>Go Back</Text>
                </Pressable>
              </View>
            ) : !material ? (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
                <Text style={styles.loadingText}>Loading material...</Text>
              </View>
            ) : Platform.OS === "web" ? (
              <>
                {isGDrive && gDriveFileId ? (
                  <iframe
                    srcDoc={buildGoogleDriveViewerHtml(gDriveFileId)}
                    style={{ width: "100%", height: "100%", border: "none" } as any}
                    title={material.title}
                    allow="autoplay"
                    onLoad={() => setLoading(false)}
                  />
                ) : isPdf && fileUrl && material ? (
                  mediaTokenError && fileKey ? (
                    <View style={styles.centered}>
                      <Ionicons name="lock-closed-outline" size={44} color={Colors.light.primary} />
                      <Text style={[styles.loadingText, { textAlign: "center", paddingHorizontal: 24 }]}>{mediaTokenError}</Text>
                      <Pressable style={[styles.retryBtn, { marginTop: 16 }]} onPress={() => setMediaTokenRetryTick((t) => t + 1)}>
                        <Text style={styles.retryBtnText}>Retry</Text>
                      </Pressable>
                    </View>
                  ) : (pdfViewerUrl || !fileKey) ? (
                    <iframe
                      src={pdfViewerUrl || fileUrl}
                      style={{ width: "100%", height: "100%", border: "none" } as any}
                      title={material.title}
                      onLoad={() => setLoading(false)}
                    />
                  ) : (
                    <View style={styles.centered}>
                      <ActivityIndicator size="large" color={Colors.light.primary} />
                      <Text style={styles.loadingText}>Loading PDF...</Text>
                    </View>
                  )
                ) : isPdf && !fileUrl ? (
                  <View style={styles.centered}>
                    <Ionicons name="alert-circle-outline" size={48} color={Colors.light.accent} />
                    <Text style={styles.errorTitle}>No file URL</Text>
                    <Text style={styles.errorSub}>This material has no file attached.</Text>
                  </View>
                ) : (
                  material?.file_type === "video" || fileUrl?.match(/\.(mp4|mov|webm|mkv|avi)(\?|$)/i) ? (
                    <video
                      src={tokenizedUrl || fileUrl}
                      controls
                      autoPlay
                      playsInline
                      preload="metadata"
                      controlsList="nodownload noplaybackrate noremoteplayback"
                      disablePictureInPicture
                      style={{ width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } as any}
                      onLoadedData={() => setLoading(false)}
                      onError={() => setLoading(false)}
                      onContextMenu={(e: any) => e.preventDefault()}
                    />
                  ) : (
                    <iframe
                      src={tokenizedUrl || fileUrl}
                      style={{ width: "100%", height: "100%", border: "none" } as any}
                      title={material?.title || "File"}
                      onLoad={() => setLoading(false)}
                    />
                  )
                )}
                {loading && (
                  <View style={styles.webLoadingOverlay}>
                    <ActivityIndicator size="large" color={Colors.light.primary} />
                  </View>
                )}
              </>
            ) : (
              <WebView
                source={
                  isGDrive && gDriveFileId
                    ? { html: buildGoogleDriveViewerHtml(gDriveFileId), baseUrl: "https://drive.google.com" }
                    : isPdf && pdfViewerUrl
                      ? { uri: pdfViewerUrl }
                      : { uri: tokenizedUrl || fileUrl || "about:blank" }
                }
                style={styles.webview}
                onLoadEnd={() => setLoading(false)}
                javaScriptEnabled
                domStorageEnabled
                startInLoadingState
                allowsInlineMediaPlayback
                mixedContentMode="always"
                allowsFullscreenVideo
                setSupportMultipleWindows={false}
                originWhitelist={["*"]}
                renderLoading={() => (
                  <View style={styles.webviewLoading}>
                    <ActivityIndicator size="large" color={Colors.light.primary} />
                  </View>
                )}
              />
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  headerMetaText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  freeBadge: { backgroundColor: "#22C55E30", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  freeBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#22C55E" },
  headerActions: { flexDirection: "row", gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  content: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  loadingText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginTop: 12 },
  errorTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text, marginTop: 16 },
  errorSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 6, textAlign: "center" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.light.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  webview: { flex: 1 },
  webviewLoading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
  webLoadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  playerContainer: {
    width: "100%",
    backgroundColor: "#000",
    position: "relative" as const,
    overflow: "hidden" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    ...Platform.select({
      web: { height: 450, maxHeight: "60%" as any },
      default: { flex: 1, maxHeight: "56%" as any },
    }),
  },
  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#000", alignItems: "center", justifyContent: "center", zIndex: 10,
  },
  floatingBack: {
    position: "absolute", left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
    zIndex: 100,
  },
});
