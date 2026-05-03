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
import { apiRequest, authFetch, getApiUrl, getBaseUrl, toHttpsMediaUrl } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { VideoWatermark } from "@/components/VideoWatermark";
import LiveStudentsPanel from "@/components/LiveStudentsPanel";
import { filterChatMessages } from "@/lib/chat-utils";
import { buildYouTubePhoneWebSrcDoc } from "@/lib/buildYouTubePhoneWebSrcDoc";
import { buildCfHlsPlayerHtml } from "@/lib/buildCfHlsPlayerHtml";

const mediaTokenCache = new Map<string, { token: string; expiresAt: number }>();
const MEDIA_TOKEN_TTL_MS = 50 * 1000;

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

const YT_EMBED_ORIGIN = "https://3ilearning.in";

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

// Native-only: YouTube IFrame API with custom controls (zero YouTube branding)
function buildNativeYouTubeHtml(videoId: string, clipSeconds?: number, phoneWeb = false): string {
  const clipEnd = clipSeconds && clipSeconds > 0 ? Math.floor(clipSeconds) : null;
  const topGap = phoneWeb ? 40 : 52;
  const bottomGap = phoneWeb ? 58 : 72;
  const topMaskHeight = phoneWeb ? 40 : 52;
  const bottomMaskLeftWidth = phoneWeb ? 70 : 120;
  const bottomMaskRightWidth = phoneWeb ? 190 : 230;
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#000;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#pw{position:relative;width:100%;height:100%}
#player{position:absolute;top:${topGap}px;left:0;width:100%;height:calc(100% - ${topGap + bottomGap}px)}
.yt-gap-top{position:absolute;top:0;left:0;right:0;height:${topGap}px;background:#000;z-index:70;pointer-events:auto}
.yt-gap-bottom{position:absolute;left:0;right:0;bottom:0;height:${bottomGap}px;background:#000;z-index:70;pointer-events:auto}
.yt-mask-top{position:absolute;top:${topGap}px;left:0;right:0;height:${topMaskHeight}px;background:#000;z-index:80;pointer-events:auto}
.yt-mask-bottom-left{position:absolute;bottom:${bottomGap}px;left:0;width:${bottomMaskLeftWidth}px;height:64px;background:#000;z-index:80;pointer-events:auto}
.yt-mask-bottom-right{position:absolute;bottom:${bottomGap}px;right:0;width:${bottomMaskRightWidth}px;height:64px;background:#000;z-index:80;pointer-events:auto}
.ctl{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.9));padding:10px 14px 14px;z-index:100;display:flex;flex-direction:column;gap:8px;transition:opacity 0.3s}
.ctl.h{opacity:0;pointer-events:none}
.pr{display:flex;align-items:center;gap:10px}
.pb{flex:1;height:5px;background:rgba(255,255,255,0.25);border-radius:3px;position:relative}
.pf{height:100%;background:#EF4444;border-radius:3px;position:relative}.pf::after{content:'';position:absolute;right:-6px;top:-4px;width:13px;height:13px;background:#EF4444;border-radius:50%}
.bf{position:absolute;top:0;left:0;height:100%;background:rgba(255,255,255,0.15);border-radius:3px}
.tt{font-size:12px;color:rgba(255,255,255,0.85);font-family:-apple-system,sans-serif;min-width:80px;text-align:center}
.br{display:flex;align-items:center;gap:6px}
.cb{background:none;border:none;color:#fff;padding:8px;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
.cb svg{width:26px;height:26px;fill:#fff}.cb.sm svg{width:22px;height:22px}
.sp{flex:1}
.bp{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:70px;height:70px;background:rgba(0,0,0,0.5);border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:50;transition:opacity 0.2s;-webkit-tap-highlight-color:transparent}
.bp.h{opacity:0;pointer-events:none}.bp svg{width:36px;height:36px;fill:#fff;margin-left:4px}
.ld{position:absolute;top:calc(50% - 10px);left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border:3px solid rgba(255,255,255,0.2);border-top:3px solid #fff;border-radius:50%;animation:sp 0.8s linear infinite;z-index:50;display:none}
@keyframes sp{to{transform:translate(-50%,-50%) rotate(360deg)}}
@media (max-width: 600px){.yt-mask-top{height:${phoneWeb ? 40 : 48}px}.yt-mask-bottom-right{width:${phoneWeb ? 190 : 190}px}}
</style></head><body>
<div id="pw" ontouchstart="sc()">
<div class="yt-gap-top"></div>
<div id="player"></div><div class="ld" id="ld"></div>
<div class="yt-mask-top"></div>
<div class="yt-mask-bottom-left"></div>
<div class="yt-mask-bottom-right"></div>
<div class="yt-gap-bottom"></div>
<div class="bp" id="bp" ontouchend="tp()"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
<div class="ctl" id="ctl">
<div class="pr"><div class="pb" id="pb" ontouchend="skT(event)"><div class="bf" id="bf"></div><div class="pf" id="pf"></div></div><span class="tt" id="tt">0:00 / 0:00</span></div>
<div class="br">
<button class="cb" ontouchend="tp()"><svg viewBox="0 0 24 24" id="pli"><path d="M8 5v14l11-7z"/></svg></button>
<button class="cb sm" ontouchend="fwd(-10)"><svg viewBox="0 0 24 24"><path d="M12.5 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg></button>
<button class="cb sm" ontouchend="fwd(10)"><svg viewBox="0 0 24 24"><path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8V1l-5 5 5 5V7c3.31 0 6 2.69 6 6z"/></svg></button>
<button class="cb sm" ontouchend="tm()"><svg viewBox="0 0 24 24" id="vi"><path d="M16.5 12A4.5 4.5 0 0014 8v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg></button>
<div class="sp"></div>
<button class="cb sm" ontouchend="tsp()"><svg viewBox="0 0 24 24"><text x="12" y="17" font-size="12" fill="#fff" text-anchor="middle" font-weight="bold" font-family="sans-serif" id="spt">1x</text></svg></button>
</div></div></div>
<script>
var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);
var p,rdy=0,ht,spds=[0.5,0.75,1,1.25,1.5,2],si=2,isMuted=1;
function onYouTubeIframeAPIReady(){p=new YT.Player('player',{videoId:'${videoId}',playerVars:{autoplay:1,mute:1,controls:0,modestbranding:1,rel:0,showinfo:0,iv_load_policy:3,cc_load_policy:0,playsinline:1,disablekb:1,fs:0,${clipEnd ? `end:${clipEnd},` : ""}},events:{onReady:function(e){rdy=1;e.target.playVideo();up();sc();},onStateChange:function(e){var s=e.data;document.getElementById('ld').style.display=s===3?'block':'none';document.getElementById('bp').className=(s===1||s===3)?'bp h':'bp';upi();}}});}
function tp(){if(!rdy)return;p.getPlayerState()===1?p.pauseVideo():p.playVideo();}
function upi(){var pl=p&&p.getPlayerState()===1;document.getElementById('pli').innerHTML=pl?'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>':'<path d="M8 5v14l11-7z"/>';}
function fwd(s){if(!rdy)return;p.seekTo(Math.max(0,p.getCurrentTime()+s),true);}
function tm(){if(!rdy)return;if(isMuted){p.unMute();p.setVolume(100);isMuted=0;}else{p.mute();isMuted=1;}uvi();}
function uvi(){document.getElementById('vi').innerHTML=isMuted?'<path d="M16.5 12A4.5 4.5 0 0014 8v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>':'<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8v8.05A4.49 4.49 0 0016.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';}
function tsp(){si=(si+1)%spds.length;p.setPlaybackRate(spds[si]);document.getElementById('spt').textContent=spds[si]+'x';}
function skT(e){if(!rdy)return;e.preventDefault();var b=document.getElementById('pb'),r=b.getBoundingClientRect();var t=e.changedTouches?e.changedTouches[0]:e;var pc=Math.max(0,Math.min(1,(t.clientX-r.left)/r.width));p.seekTo(pc*p.getDuration(),true);}
function fm(s){s=Math.floor(s);var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;return h>0?h+':'+(m<10?'0':'')+m+':'+(sc<10?'0':'')+sc:m+':'+(sc<10?'0':'')+sc;}
function up(){if(rdy&&p.getDuration){var c=p.getCurrentTime()||0,d=p.getDuration()||1;document.getElementById('pf').style.width=(c/d*100)+'%';document.getElementById('tt').textContent=fm(c)+' / '+fm(d);var l=p.getVideoLoadedFraction?p.getVideoLoadedFraction():0;document.getElementById('bf').style.width=(l*100)+'%';}requestAnimationFrame(up);}
function sc(){document.getElementById('ctl').className='ctl';clearTimeout(ht);ht=setTimeout(function(){if(p&&p.getPlayerState()===1)document.getElementById('ctl').className='ctl h';},4000);}
document.addEventListener('contextmenu',function(e){e.preventDefault();});
</script></body></html>`;
}

function buildNativeYouTubeFallbackHtml(videoId: string, clipSeconds?: number): string {
  const q = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
    cc_load_policy: "0",
    fs: "1",
    controls: "1",
    origin: YT_EMBED_ORIGIN,
  });
  if (clipSeconds && clipSeconds > 0) q.set("end", String(Math.max(1, Math.floor(clipSeconds))));
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden}.w{position:relative;width:100%;height:100%}iframe{position:absolute;inset:0;width:100%;height:100%;border:none}</style>
</head><body><div class="w">
<iframe src="https://www.youtube.com/embed/${videoId}?${q.toString()}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"></iframe>
</div><script>document.addEventListener('contextmenu',function(e){e.preventDefault();});</script></body></html>`;
}

function isCloudflareStreamId(str: string): boolean {
  if (!str) return false;
  // Cloudflare Stream video IDs are 32-character hex strings
  return /^[a-f0-9]{32}$/i.test(str.trim());
}

function buildCloudflareStreamHtml(videoId: string): string {
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
if (player && window.ReactNativeWebView) {
  player.addEventListener('loadstart', function() {
    window.ReactNativeWebView.postMessage('ready');
  });
}
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

// Voice input hook — web Speech API only
function useVoiceInput(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    if (Platform.OS !== "web") return; // silently ignore on native
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      window.alert("Voice input not supported in this browser. Use Chrome.");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-IN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (e: any) => {
        const transcript = e.results[0][0].transcript;
        onResult(transcript);
      };
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch (e) {
      setIsListening(false);
    }
  }, [onResult]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, startListening, stopListening };
}

export default function LiveClassScreen() {
  useScreenProtection(true);
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
  const [handRaised, setHandRaised] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [isScreenActive, setIsScreenActive] = useState(true);
  const [nativeYoutubeFallback, setNativeYoutubeFallback] = useState(false);
  const chatListRef = useRef<FlatList>(null);
  const lastMsgTimeRef = useRef<number>(0);
  const didAutoplayDirectRecording = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web") {
      const onVisibility = () => setIsScreenActive(!document.hidden);
      onVisibility();
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    }
    const sub = AppState.addEventListener("change", (state) => {
      setIsScreenActive(state === "active");
    });
    return () => sub.remove();
  }, []);

  const { data: liveClassData } = useQuery<{ youtube_url: string; title: string; is_completed: boolean; is_live: boolean; show_viewer_count: boolean; cf_playback_hls?: string; stream_type?: string; recording_url?: string; duration_minutes?: number; scheduled_at?: number; has_access?: boolean; is_enrolled?: boolean; course_id?: number; is_public?: boolean; chat_mode?: string }>({
    queryKey: [`/api/live-classes/${id}`],
    refetchInterval: (query) => {
      if (!isScreenActive) return false;
      const data = query.state.data as
        | {
            is_live?: boolean;
            is_completed?: boolean;
            scheduled_at?: number;
          }
        | undefined;
      if (!data) return listLiveHint ? 1200 : 2000;
      if (data.is_live || data.is_completed) return 5000;
      const t = Number(data.scheduled_at);
      const now = Date.now();
      if (Number.isFinite(t)) {
        const untilStart = t - now;
        if (untilStart <= 0) return 1200;
        if (untilStart < 30 * 60 * 1000) return 2000;
      }
      return 4000;
    },
    staleTime: 1000,
  });

  const showAsLiveUI = useMemo(() => {
    if (liveClassData?.is_completed) return false;
    if (liveClassData?.is_live) return true;
    return listLiveHint && liveClassData == null;
  }, [liveClassData, listLiveHint]);

  useEffect(() => {
    if (!liveClassData?.course_id) return;
    const baseUrl = getApiUrl();
    qc.prefetchQuery({
      queryKey: ["/api/courses", String(liveClassData.course_id)],
      queryFn: async () => {
        const res = await authFetch(new URL(`/api/courses/${liveClassData.course_id}`, baseUrl).toString());
        if (!res.ok) throw new Error("prefetch course failed");
        return res.json();
      },
      staleTime: 30000,
    });
  }, [liveClassData?.course_id, qc]);

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

  // Student heartbeat — POST every 25 seconds while page is open
  useEffect(() => {
    if (!id || !isScreenActive || liveClassData?.is_completed) return;
    const sendHeartbeat = () => {
      apiRequest("POST", `/api/live-classes/${id}/viewers/heartbeat`, {}).catch(() => {});
    };
    sendHeartbeat(); // send immediately on mount
    const interval = setInterval(sendHeartbeat, 25000);
    return () => clearInterval(interval);
  }, [id, isScreenActive, liveClassData?.is_completed]);

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
  const recordingFileKey = (() => {
    if (!recordingUrl || !recordingUrl.includes("/api/media/")) return null;
    const path = recordingUrl.startsWith("/") ? recordingUrl : recordingUrl.replace(/^https?:\/\/[^/]+/, "");
    return path.replace(/^\/api\/media\//, "");
  })();
  useEffect(() => {
    if (!recordingFileKey) {
      setRecordingToken(null);
      return;
    }
    const cached = mediaTokenCache.get(recordingFileKey);
    if (cached && cached.expiresAt > Date.now()) {
      setRecordingToken(cached.token);
      return;
    }
    let cancelled = false;
    apiRequest("POST", "/api/media-token", { fileKey: recordingFileKey })
      .then(r => r.json())
      .then(d => {
        if (!cancelled && d.token) {
          setRecordingToken(d.token);
          mediaTokenCache.set(recordingFileKey, { token: d.token, expiresAt: Date.now() + MEDIA_TOKEN_TTL_MS });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recordingFileKey]);

  const authenticatedVideoUrl = (() => {
    if (!recordingFileKey) return toHttpsMediaUrl(videoUrl);
    if (!recordingToken) return toHttpsMediaUrl(videoUrl);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return toHttpsMediaUrl(`${getBaseUrl()}/api/media/${recordingFileKey}?token=${recordingToken}`);
    }
    return toHttpsMediaUrl(videoUrl);
  })();
  useEffect(() => {
    didAutoplayDirectRecording.current = false;
  }, [authenticatedVideoUrl]);

  /** Count recording replay visits for admin dashboards (debounced on server ~8 min). */
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
  // Fallback sync for YouTube completed classes: clip playback length to app-recorded duration.
  const completedClipSeconds = liveClassData?.is_completed && (liveClassData?.duration_minutes || 0) > 0
    ? Number(liveClassData.duration_minutes) * 60
    : undefined;
  useEffect(() => {
    setNativeYoutubeFallback(false);
  }, [videoUrl]);
  const hasYouTubeId = Boolean(videoId);
  const streamHtml = isStreamId ? buildCloudflareStreamHtml(videoUrl) : "";

  const { data: chatMessages = [], refetch: refetchChat } = useQuery<ChatMsg[]>({
    queryKey: [`/api/live-classes/${id}/chat`],
    refetchInterval: (!isScreenActive || liveClassData?.is_completed) ? false : 4000,
    staleTime: 1500,
  });

  const chatMode: "public" | "private" =
    liveClassData?.chat_mode === "private" ? "private" : "public";
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

  const { data: viewerData } = useQuery<{ count: number; viewers: any[]; visible: boolean }>({
    queryKey: [`/api/live-classes/${id}/viewers`],
    refetchInterval: (!isScreenActive || liveClassData?.is_completed) ? false : 10000,
    staleTime: 3000,
  });

  const { data: raisedHands = [], refetch: refetchHands } = useQuery<HandRaise[]>({
    queryKey: [`/api/admin/live-classes/${id}/raised-hands`],
    enabled: isAdmin && !!liveClassData?.is_live && isScreenActive,
    refetchInterval: isScreenActive ? 10000 : false,
    staleTime: 3000,
  });

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
    onSuccess: () => refetchChat(),
  });

  const toggleViewerCountMutation = useMutation({
    mutationFn: (show: boolean) => apiRequest("POST", `/api/admin/live-classes/${id}/viewer-count-toggle`, { show }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/live-classes/${id}`] }),
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
    const msg = chatMsg.trim();
    if (!msg) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMsgMutation.mutate(msg);
  }, [chatMsg]);

  const { isListening, startListening, stopListening } = useVoiceInput((text) => {
    setChatMsg((prev) => (prev ? prev + " " + text : text));
  });

  const handleHandRaise = useCallback(() => {
    if (handRaised) { lowerHandMutation.mutate(); }
    else { raiseHandMutation.mutate(); }
  }, [handRaised]);

  const handleWebViewMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.event === 'play') {
        setIsVideoPlaying(true);
      } else if (data.event === 'pause' || data.event === 'ended') {
        setIsVideoPlaying(false);
      }
    } catch (e) {
      // Ignore non-JSON messages
      if (event.nativeEvent.data === 'ready') {
        setIsVideoPlaying(true); // Assume playing when ready
      }
    }
  }, []);

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
        <View style={{ width: 36 }} />
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
            {isVideoLoading && showAsLiveUI && (
              <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
            )}
            {(showAsLiveUI || liveClassData?.is_completed) && videoId && Platform.OS === "web" ? (
              <WebYouTubePlayer
                videoId={videoId}
                brandingMask={false}
                clipSeconds={completedClipSeconds}
                onReady={() => { setIsVideoLoading(false); setIsVideoPlaying(true); }}
              />
            ) : /* Web: do not use RN WebView for YouTube before go-live — it often collapses; show black stage + waiting overlay. */
            Platform.OS === "web" && videoId && !showAsLiveUI && !liveClassData?.is_completed ? (
              <View style={styles.webScheduledVideoSlot} />
            ) : isCfHls && Platform.OS === "web" ? (
              <iframe
                srcDoc={buildCfHlsPlayerHtml(cfHlsUrl, { liveStream: true })}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                onLoad={() => setIsVideoLoading(false)}
              />
            ) : !videoId && !isCfHls && !isStreamId && authenticatedVideoUrl && Platform.OS === "web" ? (
              // Direct recording / upload — programmatic play for browser autoplay policies
              <video
                src={authenticatedVideoUrl}
                controls
                playsInline
                controlsList="nodownload noplaybackrate noremoteplayback nopictureinpicture"
                disablePictureInPicture
                disableRemotePlayback
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } as any}
                onLoadedData={() => setIsVideoLoading(false)}
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
                onPause={() => setIsVideoPlaying(false)}
                onContextMenu={(ev: any) => ev.preventDefault()}
              />
            ) : isCfHls && Platform.OS !== "web" ? (
              <WebView
                source={{ html: buildCfHlsPlayerHtml(cfHlsUrl, { liveStream: true }) }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={() => setIsVideoLoading(false)}
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
                onLoad={() => { setIsVideoLoading(false); setIsVideoPlaying(true); }}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : !videoId && !isCfHls && !isStreamId && videoUrl && Platform.OS !== "web" ? (
              // Direct video file on native
              <WebView
                source={{ uri: videoUrl }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={() => { setIsVideoLoading(false); setIsVideoPlaying(true); }}
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
                    ? buildNativeYouTubeFallbackHtml(videoId, completedClipSeconds)
                    : buildNativeYouTubeHtml(videoId, completedClipSeconds),
                  baseUrl: "https://www.youtube.com",
                }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={() => { setIsVideoLoading(false); setIsVideoPlaying(true); }}
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
          </View>

          <View style={styles.webSidebar}>
            {isAdmin && (
              <View style={styles.webStudentsWrap}>
                <LiveStudentsPanel
                  liveClassId={String(id)}
                  showViewerCount={liveClassData?.show_viewer_count ?? true}
                />
              </View>
            )}
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
                  <Pressable style={[styles.iconBtn, handRaised && styles.iconBtnActive]} onPress={handleHandRaise}>
                    <Text style={{ fontSize: 18 }}>✋</Text>
                  </Pressable>
                  <TextInput
                    style={styles.chatInput}
                    value={chatMsg}
                    onChangeText={setChatMsg}
                    placeholder="Ask a doubt or say hi..."
                    placeholderTextColor="#999"
                    maxLength={500}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
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
                    disabled={!chatMsg.trim() || sendMsgMutation.isPending}
                  >
                    {sendMsgMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
                  </Pressable>
                </View>
              </View>
            </View>
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
            {isVideoLoading && showAsLiveUI && (
              <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
            )}
            {(showAsLiveUI || liveClassData?.is_completed) && videoId && Platform.OS === "web" ? (
              <WebYouTubePlayer
                videoId={videoId}
                brandingMask
                clipSeconds={completedClipSeconds}
                onReady={() => { setIsVideoLoading(false); setIsVideoPlaying(true); }}
              />
            ) : Platform.OS === "web" && videoId && !showAsLiveUI && !liveClassData?.is_completed ? (
              <View style={styles.webScheduledVideoSlot} />
            ) : isCfHls && Platform.OS === "web" ? (
              <iframe
                srcDoc={buildCfHlsPlayerHtml(cfHlsUrl, { liveStream: true })}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                onLoad={() => setIsVideoLoading(false)}
              />
            ) : !videoId && !isCfHls && !isStreamId && authenticatedVideoUrl && Platform.OS === "web" ? (
              <video
                src={authenticatedVideoUrl}
                controls
                playsInline
                controlsList="nodownload noplaybackrate noremoteplayback nopictureinpicture"
                disablePictureInPicture
                disableRemotePlayback
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } as any}
                onLoadedData={() => setIsVideoLoading(false)}
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
                onPause={() => setIsVideoPlaying(false)}
                onContextMenu={(ev: any) => ev.preventDefault()}
              />
            ) : isCfHls && Platform.OS !== "web" ? (
              <WebView
                source={{ html: buildCfHlsPlayerHtml(cfHlsUrl, { liveStream: true }) }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={() => setIsVideoLoading(false)}
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
                onLoad={() => { setIsVideoLoading(false); setIsVideoPlaying(true); }}
                onMessage={handleWebViewMessage}
                allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback scrollEnabled={false}
                javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
                originWhitelist={["*"]}
              />
            ) : !videoId && !isCfHls && !isStreamId && videoUrl && Platform.OS !== "web" ? (
              <WebView
                source={{ uri: videoUrl }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={() => { setIsVideoLoading(false); setIsVideoPlaying(true); }}
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
                    ? buildNativeYouTubeFallbackHtml(videoId, completedClipSeconds)
                    : buildNativeYouTubeHtml(videoId, completedClipSeconds),
                  baseUrl: "https://www.youtube.com",
                }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={() => { setIsVideoLoading(false); setIsVideoPlaying(true); }}
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
                  <Pressable style={[styles.iconBtn, handRaised && styles.iconBtnActive]} onPress={handleHandRaise}>
                    <Text style={{ fontSize: 18 }}>✋</Text>
                  </Pressable>
                  <TextInput
                    style={styles.chatInput}
                    value={chatMsg}
                    onChangeText={setChatMsg}
                    placeholder="Ask a doubt or say hi..."
                    placeholderTextColor="#999"
                    maxLength={500}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                  />
                  <Pressable
                    style={[styles.sendBtn, !chatMsg.trim() && styles.sendBtnDisabled]}
                    onPress={handleSend}
                    disabled={!chatMsg.trim() || sendMsgMutation.isPending}
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
                  <Pressable style={[styles.iconBtn, handRaised && styles.iconBtnActive]} onPress={handleHandRaise}>
                    <Text style={{ fontSize: 18 }}>✋</Text>
                  </Pressable>
                  <TextInput
                    style={styles.chatInput}
                    value={chatMsg}
                    onChangeText={setChatMsg}
                    placeholder="Ask a doubt or say hi..."
                    placeholderTextColor="#999"
                    maxLength={500}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
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
                    disabled={!chatMsg.trim() || sendMsgMutation.isPending}
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
