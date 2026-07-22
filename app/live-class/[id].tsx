import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator, TextInput, FlatList, KeyboardAvoidingView,
  Alert, useWindowDimensions, AppState,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, authFetch, fetchMediaToken, getApiUrl, getBaseUrl, toHttpsMediaUrl } from "@/lib/query-client";
import { liveClassQueryKey } from "@/lib/query-keys";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { useScreenWakeLock } from "@/lib/useScreenWakeLock";
import { VideoWatermark } from "@/components/VideoWatermark";
import LiveStudentsPanel from "@/components/LiveStudentsPanel";
import { filterChatMessages } from "@/lib/chat-utils";
import { normalizeChatMode } from "@/lib/live-stream/types";
import { buildYouTubePhoneWebSrcDoc } from "@/lib/buildYouTubePhoneWebSrcDoc";
import {
  YT_EMBED_ORIGIN,
  buildNativeYouTubeHtml,
  buildNativeYouTubeFallbackHtml,
} from "@/lib/buildNativeYouTubeHtml";
import { buildCfHlsPlayerHtml } from "@/lib/buildCfHlsPlayerHtml";
import ClassroomStudentView from "@/components/classroom/ClassroomStudentView";
import ClassroomLiveOverlays from "@/components/classroom/ClassroomLiveOverlays";
import ClassroomHeaderActivityTimer from "@/components/classroom/ClassroomHeaderActivityTimer";
import { useLiveEngagementSse } from "@/lib/useLiveEngagementSse";
import { useHandRaiseChime } from "@/lib/useHandRaiseChime";
import {
  handlePlaybackFullscreenMessage,
  lockLandscapeForPlayback,
  restorePortraitAfterPlayback,
  useVideoPlaybackOrientation,
} from "@/lib/video-playback-orientation";
import { useVoiceInput } from "@/lib/useVoiceInput";

const mediaTokenCache = new Map<string, { token: string; expiresAt: number; readUrl?: string }>();
const MEDIA_READ_URL_MIN_TTL_MS = 15 * 1000;

function getYouTubeVideoId(url: string): string {
  if (!url) return "";
  let decoded = url;
  try { decoded = decodeURIComponent(decodeURIComponent(url)); } catch (_e) { try { decoded = decodeURIComponent(url); } catch (_e2) {} }
  decoded = decoded.trim();
  try {
    const parsed = new URL(decoded);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1).split("?")[0].split("/")[0];
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtube-nocookie.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v")!;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] || "";
      for (const p of parts) {
        if (/^[A-Za-z0-9_-]{11}$/.test(p) && !["watch", "channel"].includes(p) && !p.startsWith("@")) return p;
      }
    }
  } catch (_e) {}
  const m = decoded.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  if (m?.[1]) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(decoded)) return decoded;
  return "";
}

/** Narrow phone-web YouTube: shell fullscreen keeps black masking bars on Android Chrome. */
function buildYouTubeHtml(videoId: string, clipSeconds?: number): string {
  const q = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    showinfo: "0",
    iv_load_policy: "3",
    cc_load_policy: "0",
    disablekb: "0",
    controls: "1",
    origin: YT_EMBED_ORIGIN,
  });
  if (clipSeconds && clipSeconds > 0) {
    q.set("end", String(Math.max(1, Math.floor(clipSeconds))));
  }
  return buildYouTubePhoneWebSrcDoc({ videoId, embedQueryWithoutFs: q.toString() });
}

/** Laptop / wide web: hide YouTube branding while keeping volume/mute usable. */
function buildYouTubeHtmlWideWeb(videoId: string, clipSeconds?: number): string {
  const q = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    showinfo: "0",
    iv_load_policy: "3",
    cc_load_policy: "0",
    fs: "1",
    disablekb: "0",
    controls: "1",
    origin: YT_EMBED_ORIGIN,
  });
  if (clipSeconds && clipSeconds > 0) {
    q.set("end", String(Math.max(1, Math.floor(clipSeconds))));
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="referrer" content="no-referrer-when-downgrade">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; -webkit-user-select: none; user-select: none; }
.wrapper { position: relative; width: 100%; height: 100%; overflow: hidden; }
iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; }
/* Top overlays hide channel/title/share branding. */
.cover-top-left { position: absolute; top: 0; left: 0; width: 84%; height: 53px; background: #000; z-index: 9999; pointer-events: auto; }
.cover-top-right { position: absolute; top: 0; right: 0; width: 114px; height: 53px; background: #000; z-index: 9999; pointer-events: auto; }
/* Band below top row: from end of top-left pad to start of top-right pad. */
.cover-top-mid-under { position: absolute; top: 45px; left: 84%; right: 114px; height: 8px; background: #000; z-index: 9999; pointer-events: auto; }
/* Bottom overlays hide branding but keep left controls (volume/mute) usable. */
.cover-bottom-rest { position: absolute; bottom: 0; left: 140px; right: 0; height: 62px; background: #000; z-index: 9999; pointer-events: auto; }
.cover-bottom-fs { position: absolute; bottom: 82px; right: 0; width: 80px; height: 45px; background: #000; z-index: 9999; pointer-events: auto; }
/* Hide bottom-left YouTube external link button. */
.cover-bottom-left-link { position: absolute; bottom: 0; left: 0; width: 86px; height: 62px; background: #000; z-index: 9999; pointer-events: auto; }
@media print { body { display: none !important; } }
</style>
</head>
<body>
<div class="wrapper">
  <div class="cover-top-left"></div>
  <div class="cover-top-right"></div>
  <div class="cover-top-mid-under"></div>
  <iframe
    src="https://www.youtube-nocookie.com/embed/${videoId}?${q.toString()}"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  ></iframe>
  <div class="cover-bottom-left-link"></div>
  <div class="cover-bottom-fs"></div>
  <div class="cover-bottom-rest"></div>
</div>
<script>document.addEventListener('contextmenu', function(e) { e.preventDefault(); });</script>
</body>
</html>`;
}

function isCloudflareStreamId(str: string): boolean {
  if (!str) return false;
  // Cloudflare Stream video IDs are 32-character hex strings
  return /^[a-f0-9]{32}$/i.test(str.trim());
}

function cloudflareStreamHlsUrl(videoId: string): string {
  const id = String(videoId || "").trim();
  if (!isCloudflareStreamId(id)) return "";
  const playbackBase = String(process.env.EXPO_PUBLIC_CF_STREAM_DOWNLOAD_BASE_URL || "").trim().replace(/\/+$/, "");
  if (playbackBase) return `${playbackBase}/${id}/manifest/video.m3u8`;
  const accountId = String(process.env.EXPO_PUBLIC_CLOUDFLARE_ACCOUNT_ID || "").trim();
  return accountId ? `https://customer-${accountId}.cloudflarestream.com/${id}/manifest/video.m3u8` : "";
}

function buildCloudflareStreamHtml(videoId: string, _signedUrl?: string, startAt = 0): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; -webkit-user-select: none; user-select: none; }
#player { width: 100%; height: 100%; }
</style>
<script src="https://embed.cloudflarestream.com/embed/sdk.latest.js"></script>
</head>
<body>
<stream 
  id="player"
  src="${videoId}"
  controls
  autoplay
  preload="auto"
  controlslist="nodownload noplaybackrate noremoteplayback"
  disablepictureinpicture
></stream>
<script>
// Disable right-click and context menu
document.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; });
document.addEventListener('selectstart', function(e) { e.preventDefault(); return false; });

const player = document.getElementById('player');
var media = document.querySelector('video');
if (media) {
  media.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback nopictureinpicture');
  media.setAttribute('disablePictureInPicture', 'true');
  media.setAttribute('disableRemotePlayback', 'true');
  media.setAttribute('x-webkit-airplay', 'deny');
  media.disablePictureInPicture = true;
  media.disableRemotePlayback = true;
}
var lcStartAt = ${startAt > 5 ? startAt - 2 : startAt};
var lcLastSaved = 0;
if (player) {
  player.addEventListener('loadstart', function() {
    if (lcStartAt > 0) { try { player.currentTime = lcStartAt; } catch(e) {} }
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('ready');
  });
  player.addEventListener('timeupdate', function() {
    var ct = Math.floor(player.currentTime || 0);
    if (Math.abs(ct - lcLastSaved) >= 10 && window.ReactNativeWebView) {
      lcLastSaved = ct; window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'timeupdate', currentTime: ct }));
    }
  });
}
</script>
</body>
</html>`;
}

function buildDirectRecordingHtml(url: string, startAt = 0): string {
  const safeUrl = JSON.stringify(url);
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
video { width: 100%; height: 100%; object-fit: contain; background: #000; }
</style>
</head>
<body>
<video id="v" controls autoplay muted playsinline preload="auto" controlsList="nodownload noplaybackrate noremoteplayback nopictureinpicture" disablePictureInPicture disableRemotePlayback x-webkit-airplay="deny"></video>
<script>
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
(function(){
  var v = document.getElementById('v');
  if (!v) return;
  var sourceUrl = ${safeUrl};
  var startAt = ${startAt > 5 ? startAt - 2 : startAt};
  var lastSaved = 0;
  var didSeek = false;
  var lastGoodTime = startAt || 0;
  var stallTimer = null;
  var retryCount = 0;
  var maxRetries = 8;
  v.src = sourceUrl;
  v.preload = 'auto';
  v.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; });
  function postHost(payload) {
    try {
      var msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
      if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
    } catch (_) {}
  }
  function seekToResume() {
    if (didSeek || !(startAt > 0)) return;
    try {
      if (isFinite(v.duration) && startAt >= v.duration) return;
      didSeek = true;
      v.currentTime = startAt;
      lastGoodTime = startAt;
    } catch (_) {}
  }
  function bufferAhead() {
    try {
      var b = v.buffered;
      if (!b || !b.length) return 0;
      for (var i = b.length - 1; i >= 0; i--) {
        if (b.start(i) <= v.currentTime && b.end(i) >= v.currentTime) {
          return Math.max(0, b.end(i) - v.currentTime);
        }
      }
      return 0;
    } catch (_) { return 0; }
  }
  function rememberGoodTime() {
    var ct = Math.floor(v.currentTime || 0);
    if (ct > 0) lastGoodTime = ct;
  }
  function clearStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  }
  function reportNow(eventName) {
    var ct = Math.floor(v.currentTime || 0);
    if (ct > 0) {
      lastSaved = ct;
      postHost({ event: eventName, currentTime: ct, duration: Math.floor(v.duration || 0), bufferAhead: Math.floor(bufferAhead() || 0) });
    }
  }
  function retryAfterStall(reason) {
    rememberGoodTime();
    reportNow(reason || 'stalled');
    if (retryCount >= maxRetries) {
      postHost({ event: reason || 'buffering', currentTime: Math.floor(lastGoodTime || 0), duration: Math.floor(v.duration || 0), bufferAhead: Math.floor(bufferAhead() || 0) });
      return;
    }
    retryCount += 1;
    var resumeAt = Math.max(0, Math.floor(lastGoodTime || v.currentTime || 0) - 1);
    try {
      v.pause();
      v.load();
      if (resumeAt > 0) {
        v.addEventListener('loadedmetadata', function once() {
          v.removeEventListener('loadedmetadata', once);
          try { v.currentTime = resumeAt; } catch (_) {}
        });
      }
      v.play().catch(function() {
        v.muted = true;
        v.play().catch(function() {});
      });
    } catch (_) {}
  }
  function scheduleStallRetry(reason) {
    clearStallTimer();
    stallTimer = setTimeout(function() {
      if (!v.paused && !v.ended && v.readyState < 3 && bufferAhead() < 1.5) {
        reportNow(reason || 'buffering');
      }
    }, 45000);
  }
  setInterval(function() {
    if (!v.paused && !v.ended) {
      rememberGoodTime();
      var ct = Math.floor(v.currentTime || 0);
      if (ct > 0 && Math.abs(ct - lastSaved) >= 5) {
        lastSaved = ct;
        postHost({ event: 'timeupdate', currentTime: ct, duration: Math.floor(v.duration || 0), bufferAhead: Math.floor(bufferAhead() || 0) });
      }
    }
  }, 5000);
  v.addEventListener('loadedmetadata', seekToResume);
  v.addEventListener('canplay', function() { clearStallTimer(); seekToResume(); });
  v.addEventListener('playing', function() { clearStallTimer(); retryCount = 0; rememberGoodTime(); postHost({ event: 'play' }); });
  v.addEventListener('progress', rememberGoodTime);
  v.addEventListener('pause', function() { clearStallTimer(); reportNow('pause'); });
  v.addEventListener('waiting', function() { reportNow('waiting'); scheduleStallRetry('waiting'); });
  v.addEventListener('stalled', function() { reportNow('stalled'); scheduleStallRetry('stalled'); });
  v.addEventListener('suspend', function() { if (!v.paused && !v.ended && bufferAhead() < 2) scheduleStallRetry('suspend'); });
  v.addEventListener('error', function() { reportNow('error'); retryAfterStall('direct-recording-error'); });
  v.addEventListener('ended', function() { reportNow('ended'); postHost({ event: 'ended', currentTime: Math.floor(v.currentTime || 0), duration: Math.floor(v.duration || 0) }); });
  try { v.load(); } catch (_) {}
  var p = v.play();
  if (p && p.then) p.then(function(){ v.muted = false; }).catch(function() { v.muted = true; v.play().catch(function() {}); });
})();
</script>
</body>
</html>`;
}

interface ChatMsg {
  id: number; live_class_id: number; user_id: number;
  user_name: string; message: string; is_admin: boolean; created_at: number;
}
interface HandRaise {
  id: number; live_class_id: number; user_id: number; user_name: string; raised_at: number;
}

function WebYouTubePlayer({
  videoId,
  onReady,
  /** Lecture-style 5-rectangle mask — use on narrow (phone) web only. */
  brandingMask = true,
  clipSeconds,
}: {
  videoId: string;
  onReady: () => void;
  brandingMask?: boolean;
  clipSeconds?: number;
}) {
  const calledRef = useRef(false);
  useEffect(() => {
    if (!calledRef.current) { calledRef.current = true; onReady(); }
  }, [onReady]);
  // Phone web: use same lecture-style masked embed logic.
  // Laptop web: keep wide masked embed path.
  const srcDoc = brandingMask
    ? buildYouTubeHtml(videoId, clipSeconds)
    : buildYouTubeHtmlWideWeb(videoId, clipSeconds);
  return (
    <iframe
      srcDoc={srcDoc}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
    />
  );
}

export default function LiveClassScreen() {
  useScreenProtection(true);
  useVideoPlaybackOrientation();
  const { id, videoUrl: paramVideoUrl, title: paramTitle, listIsLive } = useLocalSearchParams<{
    id: string;
    videoUrl?: string;
    title?: string;
    listIsLive?: string;
  }>();
  const listLiveHint = String(listIsLive ?? "") === "1";
  const insets = useSafeAreaInsets();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isWebWide = isWeb && windowWidth >= 960;
  const isNarrowWeb = isWeb && !isWebWide;
  const showNativeAdminSplit = isAdmin && Platform.OS !== "web";
  const [mobileAdminTab, setMobileAdminTab] = useState<"chat" | "students">("chat");
  const [chatMsg, setChatMsg] = useState("");
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  /** Goes true on the first 'play' / onLoad for the current video URL and
   * stays true until the URL changes. We use it to keep the RN spinner from
   * flashing again on any later re-render (e.g. after a heartbeat tick). */
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [isScreenActive, setIsScreenActive] = useState(true);
  const [nativeYoutubeFallback, setNativeYoutubeFallback] = useState(false);
  const chatListRef = useRef<FlatList>(null);
  const lastMsgTimeRef = useRef<number>(0);
  // FPR-03: Track previous AppState so we only fire leave on active→background transitions.
  const prevAppStateRef = useRef<string>(AppState.currentState);
  const forceFullChatRefreshRef = useRef(false);
  const didAutoplayDirectRecording = useRef(false);
  const cfHlsWebViewRef = useRef<WebView>(null);
  const CF_HLS_RESUME_JS =
    "try { if (typeof softResume === 'function') softResume(); } catch(e) {} true;";
  const markPlayed = useCallback(() => {
    setIsVideoLoading(false);
    setIsVideoPlaying(true);
    setHasPlayedOnce(true);
  }, []);
  /** Web: live chat uses SSE when connected; native keeps HTTP polling only. */
  const [chatSseActive, setChatSseActive] = useState(false);
  // FPR-03: Screen active tracking + immediate viewer-leave on background / unmount.
  //
  // Why: The server's online-window query excludes viewers whose last_heartbeat is
  // older than 20 seconds. Without an explicit leave, a viewer who backgrounds the
  // app or navigates away stays in the count for up to 20 s. Sending DELETE immediately
  // sets last_heartbeat = 0, dropping them on the admin's very next viewer-list poll.
  //
  // The delete request is best-effort (catch silences failures). On web we add
  // keepalive: true so the request outlives the page if the tab is closed.
  useEffect(() => {
    const sendLeave = () => {
      if (!id) return;
      const opts: RequestInit = { method: "DELETE" };
      if (Platform.OS === "web") (opts as any).keepalive = true;
      authFetch(`/api/live-classes/${id}/viewers/heartbeat`, opts).catch(() => {});
    };

    if (Platform.OS === "web") {
      const onVisibility = () => {
        const active = !document.hidden;
        setIsScreenActive(active);
        if (!active) sendLeave(); // tab hidden → fire leave immediately
      };
      onVisibility(); // sync initial state
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        sendLeave(); // component unmounts (navigation away while tab still visible)
      };
    }

    const sub = AppState.addEventListener("change", (state) => {
      const wasActive = prevAppStateRef.current === "active";
      prevAppStateRef.current = state;
      setIsScreenActive(state === "active");
      // Only fire leave on the active → inactive/background transition, not the reverse.
      if (wasActive && state !== "active") sendLeave();
    });

    return () => {
      sub.remove();
      // Navigation away: app stays in foreground so AppState never fires. Explicit cleanup needed.
      sendLeave();
    };
  }, [id]); // id is stable from route params — effectively runs once on mount

  const { data: liveClassData } = useQuery<{ youtube_url: string; title: string; is_completed: boolean; is_live: boolean; started_at?: number; show_viewer_count: boolean; cf_playback_hls?: string; stream_type?: string; recording_url?: string; duration_minutes?: number; scheduled_at?: number; has_access?: boolean; is_enrolled?: boolean; course_id?: number; is_public?: boolean; chat_mode?: string; pip_position?: string }>({
    queryKey: liveClassQueryKey(String(id)),
    refetchInterval: (query) => {
      if (!isScreenActive) return false;
      const data = query.state.data as
        | {
            is_live?: boolean;
            is_completed?: boolean;
            scheduled_at?: number;
          }
        | undefined;
      if (!data) return listLiveHint ? 2500 : 3500;
      if (data.is_live || data.is_completed) return 8000;
      const t = Number(data.scheduled_at);
      const now = Date.now();
      if (Number.isFinite(t)) {
        const untilStart = t - now;
        if (untilStart <= 0) return 3000;
        if (untilStart < 30 * 60 * 1000) return 4000;
      }
      return 6000;
    },
    staleTime: 1000,
  });

  const showAsLiveUI = useMemo(() => {
    if (liveClassData?.is_completed) return false;
    if (liveClassData?.is_live) return true;
    return listLiveHint && liveClassData == null;
  }, [liveClassData, listLiveHint]);

  /** Keep the device screen awake while a class is actively playing so the
   * phone / laptop doesn't sleep mid-stream and trigger a forced reconnect. */
  useScreenWakeLock(
    Boolean(liveClassData?.is_live) ||
      Boolean(liveClassData?.is_completed) ||
      (listLiveHint && !liveClassData)
  );

  useEffect(() => {
    if (!liveClassData?.course_id) return;
    const baseUrl = getApiUrl();
    const uidSeg = String(user?.id ?? "guest");
    const url = new URL(`/api/courses/${liveClassData.course_id}`, baseUrl);
    if (user?.id) url.searchParams.set("_uid", String(user.id));
    qc.prefetchQuery({
      queryKey: ["/api/courses", String(liveClassData.course_id), uidSeg],
      queryFn: async () => {
        const res = await authFetch(url.toString());
        if (!res.ok) throw new Error("prefetch course failed");
        return res.json();
      },
      staleTime: 30000,
    });
  }, [liveClassData?.course_id, qc, user?.id]);

  // Countdown timer — counts down to scheduled_at, then shows "Starting soon"
  useEffect(() => {
    if (!isScreenActive || liveClassData?.is_completed || liveClassData?.is_live) {
      setCountdown(null);
      return;
    }
    if (listLiveHint && liveClassData == null) {
      setCountdown(null);
      return;
    }
    if (!liveClassData?.scheduled_at) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const diff = Number(liveClassData.scheduled_at) - Date.now();
      if (diff <= 0) {
        setCountdown(null); // past scheduled time → show "Starting soon"
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setCountdown(`${h}h ${m}m`);
      else if (m > 0) setCountdown(`${m}m ${s}s`);
      else setCountdown(`${s}s`);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isScreenActive, liveClassData?.scheduled_at, liveClassData?.is_live, liveClassData?.is_completed, liveClassData, listLiveHint]);

  // Viewer heartbeat — count only while class is actually live.
  // 15s interval is well inside the server's 60s "online" cutoff so a single
  // dropped request never makes a viewer disappear from the admin's list.
  useEffect(() => {
    if (!id || !isScreenActive || !liveClassData?.is_live || liveClassData?.is_completed) return;
    const sendHeartbeat = () => {
      apiRequest("POST", `/api/live-classes/${id}/viewers/heartbeat`, {}).catch(() => {});
    };
    sendHeartbeat(); // send immediately on mount
    const interval = setInterval(sendHeartbeat, 15000);
    return () => clearInterval(interval);
  }, [id, isScreenActive, liveClassData?.is_live, liveClassData?.is_completed]);

  /** When the screen becomes active again (phone unlocked / tab refocused),
   * force-refresh the viewers + class queries so admin doesn't see "0 viewers"
   * while waiting for the next poll tick. The heartbeat effect above already
   * fires an immediate beat on the same isScreenActive flip. */
  useEffect(() => {
    if (!id || !isScreenActive) return;
    if (!liveClassData?.is_live || liveClassData?.is_completed) return;
    qc.invalidateQueries({ queryKey: [`/api/live-classes/${id}/viewers`] });
    qc.invalidateQueries({ queryKey: liveClassQueryKey(String(id)) });
  }, [id, isScreenActive, liveClassData?.is_live, liveClassData?.is_completed, qc]);

  const title = liveClassData?.title || paramTitle || "Live Class";
  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web"
    ? Math.max(34, insets.bottom)
    : Math.max(insets.bottom, Platform.OS === "android" ? 10 : 0);

  const streamType = String(liveClassData?.stream_type || "").toLowerCase();
  const cfHlsUrl = String(liveClassData?.cf_playback_hls || "").trim();
  const recordingUrl = String(liveClassData?.recording_url || "").trim();
  const liveYoutubeUrl = String(liveClassData?.youtube_url || paramVideoUrl || "").trim();
  const isCompleted = liveClassData?.is_completed;

  // Pick source by class state + declared stream type to avoid opening wrong player.
  const videoUrl = (() => {
    if (isCompleted) {
      if (recordingUrl) return recordingUrl;
      if (liveYoutubeUrl) return liveYoutubeUrl;
      if (cfHlsUrl) return cfHlsUrl;
      return "";
    }
    if (streamType === "youtube") {
      return liveYoutubeUrl || recordingUrl || cfHlsUrl;
    }
    if (streamType === "cloudflare") {
      return cfHlsUrl || recordingUrl || liveYoutubeUrl;
    }
    return recordingUrl || liveYoutubeUrl || cfHlsUrl;
  })();

  // For /api/media/ recording URLs, get a token so mobile web can play them
  const [recordingToken, setRecordingToken] = useState<string | null>(null);
  const [recordingReadUrl, setRecordingReadUrl] = useState<string | null>(null);
  const [recordingTokenError, setRecordingTokenError] = useState<string | null>(null);
  const [recordingTokenRetryTick, setRecordingTokenRetryTick] = useState(0);
  const recordingFileKey = (() => {
    if (!recordingUrl || !recordingUrl.includes("/api/media/")) return null;
    const path = recordingUrl.startsWith("/") ? recordingUrl : recordingUrl.replace(/^https?:\/\/[^/]+/, "");
    return path.replace(/^\/api\/media\//, "");
  })();
  const userScopedRecordingKey = recordingFileKey ? `${String(user?.id || 0)}:${recordingFileKey}` : null;
  useEffect(() => {
    if (!recordingFileKey || !userScopedRecordingKey) {
      setRecordingToken(null);
      setRecordingReadUrl(null);
      setRecordingTokenError(null);
      return;
    }
    const cached = mediaTokenCache.get(userScopedRecordingKey);
    if (cached && cached.expiresAt > Date.now()) {
      setRecordingToken(cached.token);
      // Prefer direct R2 reads; fall back to the API proxy only when the URL is about to expire.
      const readUrlSafe = cached.readUrl && cached.expiresAt > Date.now() + MEDIA_READ_URL_MIN_TTL_MS
        ? cached.readUrl
        : null;
      setRecordingReadUrl(readUrlSafe);
      setRecordingTokenError(null);
      return;
    }
    let cancelled = false;
    setRecordingToken(null);
    setRecordingReadUrl(null);
    setRecordingTokenError(null);
    void (async () => {
      let result = await fetchMediaToken(recordingFileKey);
      if (!result.ok && (result.status === 401 || result.status === 500 || result.status === 504)) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        result = await fetchMediaToken(recordingFileKey);
      }
      if (!result.ok && result.status === 401) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        result = await fetchMediaToken(recordingFileKey);
      }
      if (cancelled) return;
      if (result.ok && result.token) {
        setRecordingToken(result.token);
        setRecordingReadUrl(result.readUrl ?? null);
        mediaTokenCache.set(userScopedRecordingKey, {
          token: result.token,
          expiresAt: result.expiresAt,
          ...(result.readUrl ? { readUrl: result.readUrl } : {}),
        });
        return;
      }
      if (!result.ok) {
        if (result.status === 401) {
          setRecordingTokenError("Your session expired. Sign in again, then tap Retry.");
        } else if (result.status === 403) {
          setRecordingTokenError("You don't have access to this recording.");
        } else {
          setRecordingTokenError(result.message || "Could not unlock recording playback.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingFileKey, userScopedRecordingKey, recordingTokenRetryTick]);

  useEffect(() => {
    if (!recordingFileKey || !userScopedRecordingKey || !recordingToken) return;
    const cached = mediaTokenCache.get(userScopedRecordingKey);
    if (!cached?.expiresAt) return;
    const msUntilRefresh = Math.max(0, cached.expiresAt - Date.now() - 60_000);
    const tid = setTimeout(() => setRecordingTokenRetryTick((t) => t + 1), msUntilRefresh);
    return () => clearTimeout(tid);
  }, [recordingFileKey, recordingToken, userScopedRecordingKey]);

  const authenticatedVideoUrl = (() => {
    if (!recordingFileKey) return toHttpsMediaUrl(videoUrl);
    if (!recordingToken) return toHttpsMediaUrl(videoUrl);
    return toHttpsMediaUrl(
      recordingReadUrl || `${getBaseUrl()}/api/media/${recordingFileKey}?token=${recordingToken}`,
    );
  })();
  const canMountRecordingPlayer = !recordingFileKey || !!recordingToken;
  useEffect(() => {
    didAutoplayDirectRecording.current = false;
    setHasPlayedOnce(false);
    setIsVideoLoading(true);
  }, [authenticatedVideoUrl]);

  const recordingTokenStatusOverlay = useMemo(() => {
    if (!recordingFileKey) return null;
    if (recordingTokenError) {
      return (
        <View style={[styles.loadingOverlay, { justifyContent: "center", alignItems: "center", padding: 20, gap: 14, zIndex: 20 }]}>
          <Text style={{ color: "#fff", textAlign: "center", fontSize: 15 }}>{recordingTokenError}</Text>
          <Pressable
            style={{ backgroundColor: Colors.light.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
            onPress={() => setRecordingTokenRetryTick((t) => t + 1)}
          >
            <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (!recordingToken) {
      return (
        <View style={[styles.loadingOverlay, { justifyContent: "center", alignItems: "center", zIndex: 20 }]}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 10, fontSize: 14 }}>Securing playback…</Text>
        </View>
      );
    }
    return null;
  }, [recordingFileKey, recordingTokenError, recordingToken]);

  /** Count recording replay visits + load resume position. */
  const isRecordingReplay = !!liveClassData?.is_completed && !!(recordingUrl || cfHlsUrl);
  const { data: recordingProgressData } = useQuery<{ watch_percent: number; last_position_seconds: number }>({
    queryKey: [`/api/live-classes/${id}/recording-progress`],
    enabled: !!id && isRecordingReplay,
    staleTime: 0,
  });
  const recordingLastSavedRef = useRef(0);
  const recordingLatestPositionRef = useRef(0);
  // Frozen once recording progress resolves so the injected WebView HTML never
  // changes mid-playback (which would reload the document -> black screen loop).
  const recordingInitialResumeRef = useRef<number | null>(null);

  useEffect(() => {
    const savedPos = Math.floor(Number(recordingProgressData?.last_position_seconds) || 0);
    if (savedPos > recordingLatestPositionRef.current) {
      recordingLatestPositionRef.current = savedPos;
    }
  }, [recordingProgressData?.last_position_seconds]);

  if (recordingInitialResumeRef.current === null && recordingProgressData !== undefined) {
    recordingInitialResumeRef.current = Math.max(
      Math.floor(Number(recordingProgressData?.last_position_seconds) || 0),
      recordingLatestPositionRef.current,
    );
  }
  const recordingResumeAt = recordingInitialResumeRef.current ?? 0;

  const persistRecordingPosition = useCallback((pos: number, duration = 0) => {
    if (!id || !liveClassData?.is_completed || !(pos > 0)) return;
    const normalizedPos = Math.floor(pos);
    if (normalizedPos > recordingLatestPositionRef.current) {
      recordingLatestPositionRef.current = normalizedPos;
    }
    if (Math.abs(normalizedPos - recordingLastSavedRef.current) < 5) return;
    recordingLastSavedRef.current = normalizedPos;
    const watchPercent =
      duration > 0 ? Math.max(0, Math.min(100, Math.round((normalizedPos / duration) * 100))) : 0;
    // NOTE: do NOT write into the [`/api/live-classes/${id}/recording-progress`]
    // cache here. The player reads its resume position from that query; mutating
    // it mid-play would rebuild the injected WebView HTML and reload the document
    // (black screen + 0:00 + buffering loop). Persist to the backend only; the
    // latest position is kept in recordingLatestPositionRef and re-read on next mount.
    void authFetch(`${getApiUrl()}/live-classes/${encodeURIComponent(String(id))}/recording-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchPercent, lastPositionSeconds: normalizedPos }),
    }).catch(() => {});
  }, [id, liveClassData?.is_completed]);

  useEffect(() => {
    if (!id || !isScreenActive || !liveClassData?.is_completed || !recordingUrl.trim()) return;
    const tid = setTimeout(() => {
      apiRequest("POST", `/api/live-classes/${id}/recording-progress`, { openSession: true }).catch(() => {});
    }, 3200);
    return () => clearTimeout(tid);
  }, [id, isScreenActive, liveClassData?.is_completed, recordingUrl]);

  const videoId = getYouTubeVideoId(videoUrl);
  const isStreamId = !videoId && isCloudflareStreamId(videoUrl);
  // Cloudflare HLS live stream or recording (m3u8 URL)
  const isCfHls = !videoId && !isStreamId && (
    videoUrl.includes('.m3u8') ||
    (streamType === "cloudflare" && cfHlsUrl && videoUrl === cfHlsUrl)
  );
  const isCfHlsLive = isCfHls && !!liveClassData?.is_live && !liveClassData?.is_completed;

  useEffect(() => {
    if (!isScreenActive || Platform.OS === "web") return;
    if (!isCfHlsLive) return;
    cfHlsWebViewRef.current?.injectJavaScript(CF_HLS_RESUME_JS);
  }, [isScreenActive, isCfHlsLive, cfHlsUrl]);

  // Fallback sync for YouTube completed classes: clip playback length to app-recorded duration.
  const completedClipSeconds = liveClassData?.is_completed && (liveClassData?.duration_minutes || 0) > 0
    ? Number(liveClassData.duration_minutes) * 60
    : undefined;
  useEffect(() => {
    setNativeYoutubeFallback(false);
  }, [videoUrl]);
  const hasYouTubeId = Boolean(videoId);
  const nativeStreamHlsUrl = isStreamId ? cloudflareStreamHlsUrl(videoUrl) : "";
  // All injected player HTML is memoized on a stable resume position so it does
  // not change on every re-render and force the WebView document to reload.
  const streamHtml = useMemo(
    () => (isStreamId ? buildCloudflareStreamHtml(videoUrl, undefined, recordingResumeAt) : ""),
    [isStreamId, videoUrl, recordingResumeAt],
  );
  const directRecordingHtml = useMemo(
    () => (authenticatedVideoUrl ? buildDirectRecordingHtml(authenticatedVideoUrl, recordingResumeAt) : ""),
    [authenticatedVideoUrl, recordingResumeAt],
  );
  const cfHlsPlayerHtml = useMemo(() => {
    const src = isCfHlsLive ? cfHlsUrl : authenticatedVideoUrl;
    if (!isCfHls || !src) return "";
    return buildCfHlsPlayerHtml(src, isCfHlsLive ? { liveStream: true } : { startAt: recordingResumeAt });
  }, [isCfHls, isCfHlsLive, cfHlsUrl, authenticatedVideoUrl, recordingResumeAt]);
  const cfHlsStreamPlayerHtml = useMemo(
    () =>
      isStreamId && nativeStreamHlsUrl
        ? buildCfHlsPlayerHtml(nativeStreamHlsUrl, { startAt: recordingResumeAt })
        : "",
    [isStreamId, nativeStreamHlsUrl, recordingResumeAt],
  );

  const { data: viewerData } = useQuery<{ count: number; viewers: any[]; visible: boolean }>({
    queryKey: [`/api/live-classes/${id}/viewers`],
    refetchInterval: (!isScreenActive || !liveClassData?.is_live || liveClassData?.is_completed) ? false : 8000,
    staleTime: 3000,
  });

  const parentViewersPayload = useMemo(
    () => ({ viewers: viewerData?.viewers ?? [], count: viewerData?.count ?? 0 }),
    [viewerData]
  );

  const chatListKey = useMemo(() => [`/api/live-classes/${id}/chat`] as const, [id]);

  useEffect(() => {
    if (!isWeb || !id || !isScreenActive || liveClassData?.is_completed || !user?.id) {
      setChatSseActive(false);
      return;
    }
    const base = getApiUrl();
    const url = `${base}/api/live-classes/${encodeURIComponent(String(id))}/chat/stream`;
    const es = new EventSource(url, { withCredentials: true } as EventSourceInit);
    es.onopen = () => setChatSseActive(true);
    es.onmessage = (ev) => {
      try {
        const row = JSON.parse(ev.data) as ChatMsg;
        qc.setQueryData<ChatMsg[]>(chatListKey, (prev = []) => {
          if (prev.some((m) => m.id === row.id)) return prev;
          return [...prev, row].sort((a, b) => Number(a.created_at) - Number(b.created_at));
        });
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      setChatSseActive(false);
      es.close();
    };
    return () => {
      setChatSseActive(false);
      es.close();
    };
  }, [isWeb, id, isScreenActive, liveClassData?.is_completed, user?.id, qc, chatListKey]);

  const { data: chatMessages = [], refetch: refetchChat } = useQuery<ChatMsg[]>({
    queryKey: chatListKey,
    queryFn: async () => {
      const prev = qc.getQueryData<ChatMsg[]>(chatListKey) ?? [];
      const baseUrl = getApiUrl();
      const url = new URL(`/api/live-classes/${id}/chat`, baseUrl);
      if (prev.length > 0 && !forceFullChatRefreshRef.current) {
        const maxTs = Math.max(...prev.map((m) => Number(m.created_at) || 0));
        if (Number.isFinite(maxTs) && maxTs > 0) url.searchParams.set("after", String(maxTs));
      }
      const res = await authFetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch chat");
      const delta = (await res.json()) as ChatMsg[];
      if (forceFullChatRefreshRef.current) {
        forceFullChatRefreshRef.current = false;
      }
      if (!Array.isArray(delta) || delta.length === 0) return prev;
      const seen = new Set(prev.map((m) => m.id));
      const merged: ChatMsg[] = [...prev];
      for (const m of delta) {
        if (!seen.has(m.id)) {
          merged.push(m);
          seen.add(m.id);
        }
      }
      merged.sort((a, b) => Number(a.created_at) - Number(b.created_at));
      return merged;
    },
    refetchInterval:
      !isScreenActive || liveClassData?.is_completed
        ? false
        : isWeb && chatSseActive
          ? 120_000
          : 6000,
    staleTime: 1500,
  });

  const chatMode = normalizeChatMode(liveClassData?.chat_mode);
  const canStudentChat = !!liveClassData?.is_live && !liveClassData?.is_completed;
  const canSendChat =
    !!isAdmin || (canStudentChat && chatMode !== "disabled");
  const chatDisabledForStudent = !isAdmin && chatMode === "disabled";
  const [engagementAuthBlocked, setEngagementAuthBlocked] = useState(false);

  useEffect(() => {
    setEngagementAuthBlocked(false);
  }, [id, isScreenActive, liveClassData?.is_live]);

  const engagementSseActive = useLiveEngagementSse({
    liveClassId: id ? String(id) : undefined,
    enabled: isScreenActive && canStudentChat,
    isAdmin: !!isAdmin,
  });

  const { data: raisedHands = [], refetch: refetchHands } = useQuery<HandRaise[]>({
    queryKey: [`/api/admin/live-classes/${id}/raised-hands`],
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/admin/live-classes/${encodeURIComponent(String(id))}/raised-hands`);
      if (res.status === 401) {
        setEngagementAuthBlocked(true);
        return [] as HandRaise[];
      }
      if (!res.ok) return [] as HandRaise[];
      return (await res.json()) as HandRaise[];
    },
    enabled: isAdmin && !!liveClassData?.is_live && isScreenActive && !engagementAuthBlocked,
    refetchInterval:
      !isScreenActive ? false : engagementSseActive ? 30_000 : 1500,
    staleTime: 0,
  });

  useHandRaiseChime(raisedHands, !!isAdmin && canStudentChat && isScreenActive);

  const displayMessages = useMemo(
    () =>
      filterChatMessages(
        chatMessages as any,
        user?.id ?? 0,
        !!isAdmin,
        chatMode
      ) as ChatMsg[],
    [chatMessages, user?.id, isAdmin, chatMode]
  );

  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    if (displayMessages.length > 0) {
      const latestTime = Number(displayMessages[displayMessages.length - 1].created_at);
      if (latestTime > lastMsgTimeRef.current) {
        lastMsgTimeRef.current = latestTime;
        scrollTimer = setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);
      }
    }
    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, [displayMessages]);

  const sendMsgMutation = useMutation({
    mutationFn: (msg: string) => apiRequest("POST", `/api/live-classes/${id}/chat`, { message: msg }),
    onSuccess: () => { setChatMsg(""); refetchChat(); },
  });

  const deleteMsgMutation = useMutation({
    mutationFn: (msgId: number) => apiRequest("DELETE", `/api/admin/live-classes/${id}/chat/${msgId}`),
    onSuccess: (_resp, msgId) => {
      qc.setQueryData<ChatMsg[]>(chatListKey, (prev = []) => prev.filter((m) => m.id !== msgId));
      forceFullChatRefreshRef.current = true;
      refetchChat();
    },
  });

  const toggleViewerCountMutation = useMutation({
    mutationFn: (show: boolean) => apiRequest("POST", `/api/admin/live-classes/${id}/viewer-count-toggle`, { show }),
    onSuccess: () => qc.invalidateQueries({ queryKey: liveClassQueryKey(String(id)) }),
  });

  const raiseHandMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/live-classes/${id}/raise-hand`, {}),
    onSuccess: () => { setHandRaised(true); refetchHands(); },
  });

  const lowerHandMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/live-classes/${id}/raise-hand`),
    onSuccess: () => { setHandRaised(false); refetchHands(); },
  });

  const resolveHandMutation = useMutation({
    mutationFn: (userId: number) => apiRequest("POST", `/api/admin/live-classes/${id}/raised-hands/${userId}/resolve`, {}),
    onSuccess: () => refetchHands(),
  });

  const handleSend = useCallback(() => {
    if (!canSendChat) return;
    const msg = chatMsg.trim();
    if (!msg) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMsgMutation.mutate(msg);
  }, [chatMsg, canSendChat]);

  const { isListening, startListening, stopListening } = useVoiceInput((text) => {
    setChatMsg((prev) => (prev ? prev + " " + text : text));
  });

  const handleHandRaise = useCallback(() => {
    if (!canSendChat) return;
    if (handRaised) { lowerHandMutation.mutate(); }
    else { raiseHandMutation.mutate(); }
  }, [handRaised, canSendChat]);

  const handleWebViewMessage = useCallback((event: any) => {
    const raw = event.nativeEvent.data;
    if (typeof raw === "string" && handlePlaybackFullscreenMessage(raw)) return;
    try {
      const data = JSON.parse(raw);
      if (data.event === 'play') {
        markPlayed();
      } else if (data.event === 'timeupdate' && typeof data.currentTime === 'number' && liveClassData?.is_completed) {
        const pos = Math.floor(data.currentTime);
        const duration = Math.floor(Number(data.duration) || 0);
        persistRecordingPosition(pos, duration);
      } else if (data.event === 'pause' || data.event === 'ended' || data.event === 'waiting' || data.event === 'stalled' || data.event === 'error') {
        if (typeof data.currentTime === 'number') {
          const pos = Math.floor(data.currentTime);
          const duration = Math.floor(Number(data.duration) || 0);
          persistRecordingPosition(pos, duration);
        }
        setIsVideoPlaying(false);
      }
    } catch (e) {
      // Ignore non-JSON messages
      if (event.nativeEvent.data === 'ready') {
        markPlayed();
      }
    }
  }, [liveClassData?.is_completed, markPlayed, persistRecordingPosition]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onFs = () => {
      const fs = document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      if (fs && fs.tagName === "VIDEO") void lockLandscapeForPlayback();
      else if (!fs) void restorePortraitAfterPlayback();
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs as EventListener);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      handleWebViewMessage({ nativeEvent: { data: event.data } });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleWebViewMessage]);

  const preventScreenCapture = `
    (function() {
      document.addEventListener('contextmenu', function(e){ e.preventDefault(); return false; });
      
      // Notify React Native about video play/pause events
      const videos = document.querySelectorAll('video');
      videos.forEach(function(video) {
        video.addEventListener('play', function() {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'play' }));
        });
        video.addEventListener('pause', function() {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'pause' }));
        });
        video.addEventListener('ended', function() {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'pause' }));
        });
      });
    })();
    true;
  `;

  const renderChatItem = useCallback(({ item }: { item: ChatMsg }) => (
    <View style={[chatStyles.msgRow, item.is_admin && chatStyles.adminMsgRow]}>
      <View style={[chatStyles.avatar, item.is_admin && chatStyles.adminAvatar]}>
        <Text style={chatStyles.avatarText}>{item.is_admin ? "T" : (item.user_name?.charAt(0) || "S").toUpperCase()}</Text>
      </View>
      <View style={[chatStyles.msgBubble, item.is_admin && chatStyles.adminBubble]}>
        <View style={chatStyles.msgHeader}>
          <Text style={[chatStyles.msgName, item.is_admin && chatStyles.adminName]}>
            {item.is_admin ? "Pankaj Sir" : item.user_name}
          </Text>
          {item.is_admin && <View style={chatStyles.teacherBadge}><Text style={chatStyles.teacherBadgeText}>TEACHER</Text></View>}
          <Text style={chatStyles.msgTime}>
            {new Date(Number(item.created_at)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
        <Text style={chatStyles.msgText}>{item.message}</Text>
      </View>
      {isAdmin && (
        <Pressable style={chatStyles.deleteBtn} onPress={() => deleteMsgMutation.mutate(item.id)}>
          <Ionicons name="close" size={14} color="#999" />
        </Pressable>
      )}
    </View>
  ), [isAdmin]);

  if (streamType === "classroom" && !isAdmin) {
    return (
      <View style={styles.container}>
        <ClassroomStudentView
          liveClassId={String(id)}
          title={title}
          showAsLiveUI={showAsLiveUI}
          isLive={!!liveClassData?.is_live}
          startedAt={Number(liveClassData?.started_at || 0) || null}
          isCompleted={!!liveClassData?.is_completed}
          chatMode={liveClassData?.chat_mode}
          pipPosition={liveClassData?.pip_position}
          topPadding={topPadding}
          bottomPadding={bottomPadding}
        />
      </View>
    );
  }

  const screenBody = (
    <>
      <View style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={styles.headerCenter}>
          {liveClassData?.is_completed ? (
            <View style={[styles.liveIndicator, { backgroundColor: "rgba(26,86,219,0.3)" }]}>
              <Ionicons name="play" size={10} color="#93C5FD" />
              <Text style={styles.liveText}>
                Recording{liveClassData.duration_minutes ? ` · ${liveClassData.duration_minutes}m` : ""}
              </Text>
            </View>
          ) : showAsLiveUI ? (
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          ) : !liveClassData ? (
            <View style={[styles.liveIndicator, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Text style={styles.liveText}>…</Text>
            </View>
          ) : (
            <View style={styles.scheduledPill}>
              <Ionicons name="time-outline" size={10} color="#FCD34D" />
              <Text style={styles.scheduledPillText}>SCHEDULED</Text>
            </View>
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>{title || "Live Class"}</Text>
        </View>
        <View style={styles.headerRight}>
          {canStudentChat || (isAdmin && liveClassData?.is_live) ? (
            <ClassroomHeaderActivityTimer
              liveClassId={String(id)}
              isAdmin={!!isAdmin}
              sessionActive={canStudentChat}
            />
          ) : (
            <View style={{ width: 36 }} />
          )}
        </View>
      </View>

      {/* Enrollment gate — show if class requires enrollment and user is not enrolled */}
      {liveClassData && liveClassData.has_access === false && !isAdmin ? (
        <View style={styles.enrollGate}>
          <Ionicons name="lock-closed" size={48} color={Colors.light.primary} />
          <Text style={styles.enrollGateTitle}>Enrollment Required</Text>
          <Text style={styles.enrollGateSubtitle}>
            You need to enroll in this course to watch live classes and recordings.
          </Text>
          <Pressable
            style={styles.enrollGateBtn}
            onPress={() => {
              if (liveClassData.course_id) {
                router.replace(`/course/${liveClassData.course_id}` as any);
              } else {
                router.back();
              }
            }}
          >
            <Text style={styles.enrollGateBtnText}>View Course</Text>
          </Pressable>
        </View>
      ) : isWebWide ? (
        <View style={styles.webDesktopRow}>
          <View style={[styles.playerContainer, styles.webPlayerWide]}>
            <VideoWatermark isPlaying={isVideoPlaying} />
            {recordingTokenStatusOverlay}
            {!showAsLiveUI && !liveClassData?.is_completed && (
              <View style={styles.waitingOverlay}>
                <View style={styles.waitingDot} />
                {countdown ? (
                  <>
                    <Text style={styles.waitingTitle}>Class starts in</Text>
                    <Text style={styles.waitingCountdown}>{countdown}</Text>
                    <Text style={styles.waitingSubtitle}>Get ready! Class will begin shortly.</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.waitingTitle}>Starting Soon</Text>
                    <Text style={styles.waitingSubtitle}>Waiting for teacher to start the class...</Text>
                    <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" style={{ marginTop: 8 }} />
                  </>
                )}
              </View>
            )}
            {isVideoLoading && !hasPlayedOnce && showAsLiveUI && (
              <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
            )}
            {(showAsLiveUI || liveClassData?.is_completed) && videoId && Platform.OS === "web" ? (
              <WebYouTubePlayer
                videoId={videoId}
                brandingMask={false}
                clipSeconds={completedClipSeconds}
                onReady={markPlayed}
              />
            ) : /* Web: do not use RN WebView for YouTube before go-live — it often collapses; show black stage + waiting overlay. */
            Platform.OS === "web" && videoId && !showAsLiveUI && !liveClassData?.is_completed ? (
              <View style={styles.webScheduledVideoSlot} />
            ) : isCfHls && canMountRecordingPlayer && Platform.OS === "web" ? (
              <iframe
                srcDoc={cfHlsPlayerHtml}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                onLoad={markPlayed}
              />
            ) : !videoId && !isCfHls && !isStreamId && authenticatedVideoUrl && canMountRecordingPlayer && Platform.OS === "web" ? (
              // Direct recording / upload — programmatic play for browser autoplay policies
              <video
                src={authenticatedVideoUrl}
                controls
                playsInline
                controlsList="nodownload noplaybackrate noremoteplayback nopictureinpicture"
                disablePictureInPicture
                disableRemotePlayback
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } as any}
                onLoadedData={markPlayed}
                onCanPlay={(e) => {
                  if (didAutoplayDirectRecording.current) return;
                  didAutoplayDirectRecording.current = true;
                  const v = e.currentTarget;
                  v.muted = true;
                  v.play()
                    .then(() => {
                      v.muted = false;
                      setIsVideoPlaying(true);
                    })
                    .catch(() => {
                      v.muted = true;
                      v.play().then(() => setIsVideoPlaying(true)).catch(() => {});
                    });
                }}
                onPlay={() => setIsVideoPlaying(true)}
                onPause={(e) => {
                  const v = e.currentTarget;
                  persistRecordingPosition(Math.floor(v.currentTime || 0), Math.floor(v.duration || 0));
                  setIsVideoPlaying(false);
                }}
                onWaiting={(e) => {
                  const v = e.currentTarget;
                  persistRecordingPosition(Math.floor(v.currentTime || 0), Math.floor(v.duration || 0));
                }}
                onStalled={(e) => {
                  const v = e.currentTarget;
                  persistRecordingPosition(Math.floor(v.currentTime || 0), Math.floor(v.duration || 0));
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.paused || v.ended) return;
                  persistRecordingPosition(Math.floor(v.currentTime || 0), Math.floor(v.duration || 0));
                }}
                onContextMenu={(ev: any) => ev.preventDefault()}
              />
            ) : isCfHls && canMountRecordingPlayer && Platform.OS !== "web" ? (
              <WebView
                ref={cfHlsWebViewRef}
                source={{ html: cfHlsPlayerHtml }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : isStreamId && nativeStreamHlsUrl && Platform.OS !== "web" ? (
              <WebView
                source={{ html: cfHlsStreamPlayerHtml }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : isStreamId && streamHtml ? (
              <WebView
                source={{ html: streamHtml, baseUrl: "https://cloudflarestream.com" }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : !videoId && !isCfHls && !isStreamId && directRecordingHtml && canMountRecordingPlayer && Platform.OS !== "web" ? (
              // Direct video file on native
              <WebView
                source={{ html: directRecordingHtml }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onError={() => handleWebViewMessage({ nativeEvent: { data: JSON.stringify({ event: 'error', reason: 'webview-direct-recording-error' }) } })}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : hasYouTubeId && Platform.OS !== "web" ? (
              <WebView
                source={{
                  html: nativeYoutubeFallback
                    ? buildNativeYouTubeFallbackHtml(videoId, { endAt: completedClipSeconds })
                    : buildNativeYouTubeHtml(videoId, { endAt: completedClipSeconds }),
                  baseUrl: "https://www.youtube.com",
                }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onError={() => {
                  // Fallback to simpler iframe embed for streams where YouTube blocks IFrame API controls.
                  setNativeYoutubeFallback(true);
                }}
                onMessage={handleWebViewMessage}
                injectedJavaScript={preventScreenCapture}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                setSupportMultipleWindows={false} originWhitelist={["*"]}
              />
            ) : (
              <View style={styles.noVideoOverlay}>
                <Ionicons name="videocam-off-outline" size={32} color="#666" />
                <Text style={styles.noVideoText}>No video available</Text>
              </View>
            )}
            {(canStudentChat || (isAdmin && liveClassData?.is_live)) && id ? (
              <ClassroomLiveOverlays
                liveClassId={String(id)}
                isAdmin={!!isAdmin}
                sessionActive={!!(canStudentChat || liveClassData?.is_live)}
              />
            ) : null}
          </View>

          <View style={styles.webSidebar}>
            {/* Wide-web tab bar: Chat | Students (admin only) */}
            {isAdmin && (
              <View style={styles.mobileAdminTabBar}>
                <Pressable
                  style={[styles.mobileAdminTab, mobileAdminTab === "chat" && styles.mobileAdminTabActive]}
                  onPress={() => setMobileAdminTab("chat")}
                >
                  <Ionicons name="chatbubbles" size={16} color={mobileAdminTab === "chat" ? "#fff" : Colors.light.textMuted} />
                  <Text style={[styles.mobileAdminTabText, mobileAdminTab === "chat" && styles.mobileAdminTabTextActive]}>Chat</Text>
                </Pressable>
                <Pressable
                  style={[styles.mobileAdminTab, mobileAdminTab === "students" && styles.mobileAdminTabActive]}
                  onPress={() => setMobileAdminTab("students")}
                >
                  <Ionicons name="people" size={16} color={mobileAdminTab === "students" ? "#fff" : Colors.light.textMuted} />
                  <Text style={[styles.mobileAdminTabText, mobileAdminTab === "students" && styles.mobileAdminTabTextActive]}>Students</Text>
                </Pressable>
              </View>
            )}
            {isAdmin && mobileAdminTab === "students" ? (
              <View style={styles.webChatWrap}>
                <LiveStudentsPanel
                  liveClassId={String(id)}
                  showViewerCount={liveClassData?.show_viewer_count ?? true}
                  parentViewers={parentViewersPayload}
                />
              </View>
            ) : (
            <View style={styles.webChatWrap}>
              <View style={styles.chatContainer}>
                <View style={styles.chatHeader}>
                  <Ionicons name="chatbubbles" size={18} color={Colors.light.primary} />
                  <Text style={styles.chatHeaderText}>
                    {liveClassData?.is_completed ? "Class chat" : "Live Chat"}
                  </Text>
                  {liveClassData?.is_completed && (
                    <View style={styles.recordingPill}>
                      <Text style={styles.recordingPillText}>Recording</Text>
                    </View>
                  )}
                  {viewerData?.visible && (
                    <View style={styles.viewerCountBadge}>
                      <Ionicons name="people" size={13} color={Colors.light.primary} />
                      <Text style={styles.viewerCountText}>{viewerData.count} online</Text>
                    </View>
                  )}
                  {isAdmin && raisedHands.length > 0 && (
                    <View style={styles.raisedHandsBadge}>
                      <Text style={styles.raisedHandsText}>✋ {raisedHands.length}</Text>
                    </View>
                  )}
                  {isAdmin && (
                    <Pressable
                      style={styles.adminToggleBtn}
                      onPress={() => toggleViewerCountMutation.mutate(!(liveClassData?.show_viewer_count ?? true))}
                    >
                      <Ionicons
                        name={(liveClassData?.show_viewer_count ?? true) ? "eye" : "eye-off"}
                        size={16} color={Colors.light.textMuted}
                      />
                    </Pressable>
                  )}
                </View>
                {isAdmin && raisedHands.length > 0 && (
                  <View style={styles.raisedHandsList}>
                    <Text style={styles.raisedHandsTitle}>Raised Hands</Text>
                    {raisedHands.map((h) => (
                      <View key={h.id} style={styles.raisedHandItem}>
                        <Text style={styles.raisedHandName}>✋ {h.user_name}</Text>
                        <Pressable style={styles.resolveBtn} onPress={() => resolveHandMutation.mutate(h.user_id)}>
                          <Text style={styles.resolveBtnText}>Dismiss</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                <FlatList
                  ref={chatListRef}
                  data={displayMessages}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={renderChatItem}
                  style={styles.chatList}
                  contentContainerStyle={styles.chatListContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  ListEmptyComponent={
                    <View style={styles.emptyChat}>
                      <Ionicons name="chatbubble-ellipses-outline" size={28} color="#ccc" />
                      <Text style={styles.emptyChatText}>No messages yet. Say hello!</Text>
                    </View>
                  }
                />
                <View style={[styles.inputRow, { paddingBottom: Math.max(bottomPadding, 8) }]}>
                  <Pressable style={[styles.iconBtn, handRaised && styles.iconBtnActive, !canSendChat && { opacity: 0.5 }]} onPress={handleHandRaise} disabled={!canSendChat}>
                    <Text style={{ fontSize: 18 }}>✋</Text>
                  </Pressable>
                  <TextInput
                    style={styles.chatInput}
                    value={chatMsg}
                    onChangeText={setChatMsg}
                    placeholder={
                      chatDisabledForStudent
                        ? "Live chat disabled by the teacher"
                        : canSendChat
                          ? "Ask a doubt or say hi..."
                          : "Chat opens when class goes live"
                    }
                    placeholderTextColor="#999"
                    maxLength={500}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                    editable={canSendChat}
                  />
                  {Platform.OS === "web" && (
                    <Pressable
                      style={[styles.iconBtn, isListening && styles.iconBtnActive]}
                      onPress={isListening ? stopListening : startListening}
                    >
                      <Ionicons name={isListening ? "mic" : "mic-outline"} size={20} color={isListening ? "#EF4444" : Colors.light.textMuted} />
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.sendBtn, !chatMsg.trim() && styles.sendBtnDisabled]}
                    onPress={handleSend}
                    disabled={!canSendChat || !chatMsg.trim() || sendMsgMutation.isPending}
                  >
                    {sendMsgMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
                  </Pressable>
                </View>
              </View>
            </View>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.mainContent}>
          <View
            style={[
              styles.playerContainer,
              isNarrowWeb && { aspectRatio: 16 / 9, flexGrow: 0, width: "100%" as const },
              Platform.OS !== "web" && { flex: 3, minHeight: 0, flexShrink: 0 },
            ]}
          >
            <VideoWatermark isPlaying={isVideoPlaying} />
            {recordingTokenStatusOverlay}
            {!showAsLiveUI && !liveClassData?.is_completed && (
              <View style={styles.waitingOverlay}>
                <View style={styles.waitingDot} />
                {countdown ? (
                  <>
                    <Text style={styles.waitingTitle}>Class starts in</Text>
                    <Text style={styles.waitingCountdown}>{countdown}</Text>
                    <Text style={styles.waitingSubtitle}>Get ready! Class will begin shortly.</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.waitingTitle}>Starting Soon</Text>
                    <Text style={styles.waitingSubtitle}>Waiting for teacher to start the class...</Text>
                    <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" style={{ marginTop: 8 }} />
                  </>
                )}
              </View>
            )}
            {isVideoLoading && !hasPlayedOnce && showAsLiveUI && (
              <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
            )}
            {(showAsLiveUI || liveClassData?.is_completed) && videoId && Platform.OS === "web" ? (
              <WebYouTubePlayer
                videoId={videoId}
                brandingMask
                clipSeconds={completedClipSeconds}
                onReady={markPlayed}
              />
            ) : Platform.OS === "web" && videoId && !showAsLiveUI && !liveClassData?.is_completed ? (
              <View style={styles.webScheduledVideoSlot} />
            ) : isCfHls && canMountRecordingPlayer && Platform.OS === "web" ? (
              <iframe
                srcDoc={cfHlsPlayerHtml}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                onLoad={markPlayed}
              />
            ) : !videoId && !isCfHls && !isStreamId && authenticatedVideoUrl && canMountRecordingPlayer && Platform.OS === "web" ? (
              <video
                src={authenticatedVideoUrl}
                controls
                playsInline
                controlsList="nodownload noplaybackrate noremoteplayback nopictureinpicture"
                disablePictureInPicture
                disableRemotePlayback
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } as any}
                onLoadedData={markPlayed}
                onCanPlay={(e) => {
                  if (didAutoplayDirectRecording.current) return;
                  didAutoplayDirectRecording.current = true;
                  const v = e.currentTarget;
                  v.muted = true;
                  v.play()
                    .then(() => {
                      v.muted = false;
                      setIsVideoPlaying(true);
                    })
                    .catch(() => {
                      v.muted = true;
                      v.play().then(() => setIsVideoPlaying(true)).catch(() => {});
                    });
                }}
                onPlay={() => setIsVideoPlaying(true)}
                onPause={(e) => {
                  const v = e.currentTarget;
                  persistRecordingPosition(Math.floor(v.currentTime || 0), Math.floor(v.duration || 0));
                  setIsVideoPlaying(false);
                }}
                onWaiting={(e) => {
                  const v = e.currentTarget;
                  persistRecordingPosition(Math.floor(v.currentTime || 0), Math.floor(v.duration || 0));
                }}
                onStalled={(e) => {
                  const v = e.currentTarget;
                  persistRecordingPosition(Math.floor(v.currentTime || 0), Math.floor(v.duration || 0));
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.paused || v.ended) return;
                  persistRecordingPosition(Math.floor(v.currentTime || 0), Math.floor(v.duration || 0));
                }}
                onContextMenu={(ev: any) => ev.preventDefault()}
              />
            ) : isCfHls && canMountRecordingPlayer && Platform.OS !== "web" ? (
              <WebView
                ref={cfHlsWebViewRef}
                source={{ html: cfHlsPlayerHtml }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : isStreamId && nativeStreamHlsUrl && Platform.OS !== "web" ? (
              <WebView
                source={{ html: cfHlsStreamPlayerHtml }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : isStreamId && streamHtml ? (
              <WebView
                source={{ html: streamHtml, baseUrl: "https://cloudflarestream.com" }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : !videoId && !isCfHls && !isStreamId && directRecordingHtml && canMountRecordingPlayer && Platform.OS !== "web" ? (
              <WebView
                source={{ html: directRecordingHtml }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onError={() => handleWebViewMessage({ nativeEvent: { data: JSON.stringify({ event: 'error', reason: 'webview-direct-recording-error' }) } })}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : hasYouTubeId && Platform.OS !== "web" ? (
              <WebView
                source={{
                  html: nativeYoutubeFallback
                    ? buildNativeYouTubeFallbackHtml(videoId, { endAt: completedClipSeconds })
                    : buildNativeYouTubeHtml(videoId, { endAt: completedClipSeconds }),
                  baseUrl: "https://www.youtube.com",
                }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={markPlayed}
                onError={() => {
                  setNativeYoutubeFallback(true);
                }}
                onMessage={handleWebViewMessage}
                injectedJavaScript={preventScreenCapture}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                setSupportMultipleWindows={false} originWhitelist={["*"]}
              />
            ) : (
              <View style={styles.noVideoOverlay}>
                <Ionicons name="videocam-off-outline" size={32} color="#666" />
                <Text style={styles.noVideoText}>No video available</Text>
              </View>
            )}
            {(canStudentChat || (isAdmin && liveClassData?.is_live)) && id ? (
              <ClassroomLiveOverlays
                liveClassId={String(id)}
                isAdmin={!!isAdmin}
                sessionActive={!!(canStudentChat || liveClassData?.is_live)}
              />
            ) : null}
          </View>

          {isAdmin && isNarrowWeb && (
            <View style={styles.mobileAdminTabBar}>
              <Pressable
                style={[styles.mobileAdminTab, mobileAdminTab === "chat" && styles.mobileAdminTabActive]}
                onPress={() => setMobileAdminTab("chat")}
              >
                <Ionicons name="chatbubbles" size={16} color={mobileAdminTab === "chat" ? "#fff" : Colors.light.textMuted} />
                <Text style={[styles.mobileAdminTabText, mobileAdminTab === "chat" && styles.mobileAdminTabTextActive]}>Chat</Text>
              </Pressable>
              <Pressable
                style={[styles.mobileAdminTab, mobileAdminTab === "students" && styles.mobileAdminTabActive]}
                onPress={() => setMobileAdminTab("students")}
              >
                <Ionicons name="people" size={16} color={mobileAdminTab === "students" ? "#fff" : Colors.light.textMuted} />
                <Text style={[styles.mobileAdminTabText, mobileAdminTab === "students" && styles.mobileAdminTabTextActive]}>Students</Text>
              </Pressable>
            </View>
          )}

          {showNativeAdminSplit ? (
            <View style={styles.nativeAdminSplitRow}>
              <View style={styles.nativeAdminSplitPane}>
                <LiveStudentsPanel
                  liveClassId={String(id)}
                  showViewerCount={liveClassData?.show_viewer_count ?? true}
                  parentViewers={parentViewersPayload}
                />
              </View>
              <View style={[styles.chatContainer, styles.nativeAdminSplitPane]}>
                <View style={styles.chatHeader}>
                  <Ionicons name="chatbubbles" size={18} color={Colors.light.primary} />
                  <Text style={styles.chatHeaderText}>
                    {liveClassData?.is_completed ? "Class chat" : "Live Chat"}
                  </Text>
                </View>
                <FlatList
                  ref={chatListRef}
                  data={displayMessages}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={renderChatItem}
                  style={styles.chatList}
                  contentContainerStyle={styles.chatListContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                />
                <View style={[styles.inputRow, { paddingBottom: Math.max(bottomPadding, 8) }]}>
                  <Pressable style={[styles.iconBtn, handRaised && styles.iconBtnActive, !canSendChat && { opacity: 0.5 }]} onPress={handleHandRaise} disabled={!canSendChat}>
                    <Text style={{ fontSize: 18 }}>✋</Text>
                  </Pressable>
                  <TextInput
                    style={styles.chatInput}
                    value={chatMsg}
                    onChangeText={setChatMsg}
                    placeholder={
                      chatDisabledForStudent
                        ? "Live chat disabled by the teacher"
                        : canSendChat
                          ? "Ask a doubt or say hi..."
                          : "Chat opens when class goes live"
                    }
                    placeholderTextColor="#999"
                    maxLength={500}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                    editable={canSendChat}
                  />
                  <Pressable
                    style={[styles.sendBtn, !chatMsg.trim() && styles.sendBtnDisabled]}
                    onPress={handleSend}
                    disabled={!canSendChat || !chatMsg.trim() || sendMsgMutation.isPending}
                  >
                    {sendMsgMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
                  </Pressable>
                </View>
              </View>
            </View>
          ) : isAdmin && isNarrowWeb && mobileAdminTab === "students" ? (
            <View style={[styles.chatContainer, { flex: 1, minHeight: 0, backgroundColor: Colors.light.background }]}>
              <LiveStudentsPanel
                liveClassId={String(id)}
                showViewerCount={liveClassData?.show_viewer_count ?? true}
                parentViewers={parentViewersPayload}
              />
            </View>
          ) : (
            <View
              style={[
                styles.chatContainer,
                isNarrowWeb && styles.phoneWebChatDock,
                Platform.OS !== "web" && { flex: 1, minHeight: 0 },
              ]}
            >
                <View style={styles.chatHeader}>
                  <Ionicons name="chatbubbles" size={18} color={Colors.light.primary} />
                  <Text style={styles.chatHeaderText}>
                    {liveClassData?.is_completed ? "Class chat" : "Live Chat"}
                  </Text>
                  {liveClassData?.is_completed && (
                    <View style={styles.recordingPill}>
                      <Text style={styles.recordingPillText}>Recording</Text>
                    </View>
                  )}
                  {viewerData?.visible && (
                    <View style={styles.viewerCountBadge}>
                      <Ionicons name="people" size={13} color={Colors.light.primary} />
                      <Text style={styles.viewerCountText}>{viewerData.count} online</Text>
                    </View>
                  )}
                  {isAdmin && raisedHands.length > 0 && (
                    <View style={styles.raisedHandsBadge}>
                      <Text style={styles.raisedHandsText}>✋ {raisedHands.length}</Text>
                    </View>
                  )}
                  {isAdmin && (
                    <Pressable
                      style={styles.adminToggleBtn}
                      onPress={() => toggleViewerCountMutation.mutate(!(liveClassData?.show_viewer_count ?? true))}
                    >
                      <Ionicons
                        name={(liveClassData?.show_viewer_count ?? true) ? "eye" : "eye-off"}
                        size={16} color={Colors.light.textMuted}
                      />
                    </Pressable>
                  )}
                </View>
                {isAdmin && raisedHands.length > 0 && (
                  <View style={styles.raisedHandsList}>
                    <Text style={styles.raisedHandsTitle}>Raised Hands</Text>
                    {raisedHands.map((h) => (
                      <View key={h.id} style={styles.raisedHandItem}>
                        <Text style={styles.raisedHandName}>✋ {h.user_name}</Text>
                        <Pressable style={styles.resolveBtn} onPress={() => resolveHandMutation.mutate(h.user_id)}>
                          <Text style={styles.resolveBtnText}>Dismiss</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                <FlatList
                  ref={chatListRef}
                  data={displayMessages}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={renderChatItem}
                  style={styles.chatList}
                  contentContainerStyle={styles.chatListContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  ListEmptyComponent={
                    <View style={styles.emptyChat}>
                      <Ionicons name="chatbubble-ellipses-outline" size={28} color="#ccc" />
                      <Text style={styles.emptyChatText}>No messages yet. Say hello!</Text>
                    </View>
                  }
                />
                <View style={[styles.inputRow, { paddingBottom: isNarrowWeb ? 8 : Math.max(bottomPadding, 8) }]}>
                  <Pressable style={[styles.iconBtn, handRaised && styles.iconBtnActive, !canSendChat && { opacity: 0.5 }]} onPress={handleHandRaise} disabled={!canSendChat}>
                    <Text style={{ fontSize: 18 }}>✋</Text>
                  </Pressable>
                  <TextInput
                    style={styles.chatInput}
                    value={chatMsg}
                    onChangeText={setChatMsg}
                    placeholder={
                      chatDisabledForStudent
                        ? "Live chat disabled by the teacher"
                        : canSendChat
                          ? "Ask a doubt or say hi..."
                          : "Chat opens when class goes live"
                    }
                    placeholderTextColor="#999"
                    maxLength={500}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                    editable={canSendChat}
                  />
                  {Platform.OS === "web" && (
                    <Pressable
                      style={[styles.iconBtn, isListening && styles.iconBtnActive]}
                      onPress={isListening ? stopListening : startListening}
                    >
                      <Ionicons name={isListening ? "mic" : "mic-outline"} size={20} color={isListening ? "#EF4444" : Colors.light.textMuted} />
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.sendBtn, !chatMsg.trim() && styles.sendBtnDisabled]}
                    onPress={handleSend}
                    disabled={!canSendChat || !chatMsg.trim() || sendMsgMutation.isPending}
                  >
                    {sendMsgMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
                  </Pressable>
                </View>
            </View>
          )}
        </View>
      )}
    </>
  );

  if (Platform.OS === "web") {
    return <View style={styles.container}>{screenBody}</View>;
  }
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {screenBody}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 8, backgroundColor: "#0A1628", flexShrink: 0, zIndex: 2 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headerRight: { minWidth: 36, alignItems: "flex-end", justifyContent: "center" },
  liveIndicator: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#DC2626", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  scheduledPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(180, 83, 9, 0.35)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: "rgba(252, 211, 77, 0.4)" },
  scheduledPillText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#FCD34D", letterSpacing: 0.5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 1 },
  headerTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff", flex: 1 },
  mainContent: { flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0, overflow: "hidden" },
  webDesktopRow: { flex: 1, flexDirection: "row", minHeight: 0, minWidth: 0, backgroundColor: "#000" },
  webPlayerWide: { flex: 1.9, minWidth: 0, minHeight: 0 },
  webSidebar: {
    flex: 1,
    minWidth: 280,
    maxWidth: 520,
    backgroundColor: Colors.light.background,
    borderLeftWidth: 1,
    borderLeftColor: Colors.light.border,
    flexDirection: "column",
  },
  webStudentsWrap: { height: 200, minHeight: 100, maxHeight: 240, borderBottomWidth: 1, borderBottomColor: Colors.light.border, overflow: "hidden" },
  webChatWrap: { flex: 1, minHeight: 0 },
  mobileAdminTabBar: {
    flexDirection: "row",
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  mobileAdminTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.light.secondary,
  },
  mobileAdminTabActive: { backgroundColor: Colors.light.primary },
  mobileAdminTabText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  mobileAdminTabTextActive: { color: "#fff" },
  nativeAdminSplitRow: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    backgroundColor: Colors.light.background,
  },
  nativeAdminSplitPane: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: 1,
    borderLeftColor: Colors.light.border,
  },
  recordingPill: {
    backgroundColor: "rgba(26,86,219,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  recordingPillText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#3B82F6" },
  /* Native: flex height share. */
  playerContainer: { width: "100%", backgroundColor: "#000", position: "relative", overflow: "hidden" },
  webScheduledVideoSlot: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000" },
  loadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", alignItems: "center", justifyContent: "center", zIndex: 10 },
  waitingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#0A1628", alignItems: "center", justifyContent: "center", gap: 6, zIndex: 10, padding: 20 },
  waitingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444", marginBottom: 4 },
  waitingTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  waitingCountdown: { fontSize: 32, fontFamily: "Inter_700Bold", color: "#F6821F", letterSpacing: 2 },
  waitingSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)", textAlign: "center" },
  noVideoOverlay: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  noVideoText: { color: "#666", fontFamily: "Inter_400Regular", fontSize: 13 },
  // Enrollment gate
  enrollGate: { flex: 1, backgroundColor: Colors.light.background, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  enrollGateTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text, textAlign: "center" },
  enrollGateSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "center", lineHeight: 22 },
  enrollGateBtn: { backgroundColor: Colors.light.primary, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 },
  enrollGateBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  // Recording info (replaces chat for completed classes)
  recordingInfo: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  recordingInfoTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  recordingInfoSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "center" },
  chatContainer: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: Colors.light.background },
  phoneWebChatDock: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  chatHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  chatHeaderText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text, flex: 1 },
  viewerCountBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.secondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  viewerCountText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.primary },
  raisedHandsBadge: { backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  raisedHandsText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#B45309" },
  adminToggleBtn: { padding: 4 },
  raisedHandsList: { backgroundColor: "#FFFBEB", borderBottomWidth: 1, borderBottomColor: "#FDE68A", paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  raisedHandsTitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#B45309", marginBottom: 4 },
  raisedHandItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  raisedHandName: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text },
  resolveBtn: { backgroundColor: "#F59E0B", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  resolveBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  chatList: { flex: 1 },
  chatListContent: { padding: 12, gap: 8 },
  emptyChat: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  emptyChatText: { fontSize: 13, color: "#999", fontFamily: "Inter_400Regular" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.light.border, backgroundColor: Colors.light.background },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  iconBtnActive: { backgroundColor: "#FEF3C7" },
  chatInput: { flex: 1, backgroundColor: Colors.light.secondary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, maxHeight: 80 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { backgroundColor: "#ccc" },
});

const chatStyles = StyleSheet.create({
  msgRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  adminMsgRow: {},
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  adminAvatar: { backgroundColor: "#FEF3C7" },
  avatarText: { fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.textMuted },
  msgBubble: { flex: 1, backgroundColor: Colors.light.secondary, borderRadius: 12, padding: 10, borderTopLeftRadius: 4 },
  adminBubble: { backgroundColor: "#FEF3C7" },
  msgHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  msgName: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  adminName: { color: "#B45309" },
  teacherBadge: { backgroundColor: "#F59E0B", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  teacherBadgeText: { fontSize: 8, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 0.5 },
  msgTime: { fontSize: 10, color: "#999", fontFamily: "Inter_400Regular", marginLeft: "auto" as any },
  msgText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.text, lineHeight: 18 },
  deleteBtn: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
