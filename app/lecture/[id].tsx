import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator, Alert, ScrollView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { useVideoScreenProtection } from "@/lib/useVideoScreenProtection";
import { isAndroidWeb } from "@/lib/useAndroidWebGate";
import AndroidWebGate from "@/components/AndroidWebGate";
import { DownloadButton } from "@/components/DownloadButton";
import { VideoWatermark } from "@/components/VideoWatermark";

function getYouTubeVideoId(url: string): string {
  if (!url) return "";
  let decoded = url;
  try { decoded = decodeURIComponent(decodeURIComponent(url)); } catch (_e) { try { decoded = decodeURIComponent(url); } catch (_e2) {} }
  decoded = decoded.trim();
  try {
    const parsed = new URL(decoded);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1).split("?")[0].split("/")[0];
    }
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtube-nocookie.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v")!;
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "embed" || pathParts[0] === "shorts" || pathParts[0] === "live") {
        return pathParts[1] || "";
      }
      if (pathParts.length >= 2 && pathParts[pathParts.length - 2] === "live") {
        return pathParts[pathParts.length - 1] || "";
      }
      for (const part of pathParts) {
        if (/^[A-Za-z0-9_-]{11}$/.test(part) && part !== "watch" && part !== "channel" && !part.startsWith("@")) {
          return part;
        }
      }
    }
  } catch (_e) {}
  const match = decoded.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  if (match?.[1]) return match[1];
  const simpleMatch = decoded.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (simpleMatch?.[1]) return simpleMatch[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(decoded)) return decoded;
  return "";
}

function isDirectVideoUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.match(/\.(mp4|mov|mkv|avi|webm)(\?|$)/)) return true;
  if (lower.includes("3ilearning.in")) return true;
  if (lower.includes("r2.cloudflarestorage.com")) return true;
  if (lower.includes("/api/media/")) return true;
  return false;
}

function isCloudflareStreamId(str: string): boolean {
  if (!str) return false;
  // Cloudflare Stream video IDs are 32-character hex strings
  return /^[a-f0-9]{32}$/i.test(str.trim());
}

function buildCloudflareStreamHtml(videoId: string, signedUrl?: string): string {
  const streamUrl = signedUrl || `https://customer-${process.env.EXPO_PUBLIC_CLOUDFLARE_ACCOUNT_ID || ''}.cloudflarestream.com/${videoId}/manifest/video.m3u8`;
  
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
  ${signedUrl ? `signed-url="${signedUrl}"` : ''}
></stream>
<script>
// Disable right-click and context menu
document.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; });

// Disable text selection
document.addEventListener('selectstart', function(e) { e.preventDefault(); return false; });

// Get player instance
const player = document.getElementById('player');

// Notify React Native when ready
if (player) {
  player.addEventListener('loadstart', function() {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage('ready');
    }
  });
  
  // Track playback for analytics
  player.addEventListener('play', function() {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'play' }));
    }
  });
  
  player.addEventListener('pause', function() {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'pause' }));
    }
  });
  
  player.addEventListener('ended', function() {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'ended' }));
    }
  });
}

// Additional security: prevent screenshots on Android (best effort)
if (navigator.userAgent.includes('Android')) {
  document.body.style.webkitUserSelect = 'none';
  document.body.style.userSelect = 'none';
}
</script>
</body>
</html>`;
}

function buildDirectVideoHtml(url: string): string {
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
<video controls autoplay playsinline controlsList="nodownload noplaybackrate" disablePictureInPicture>
  <source src="${url}" type="video/mp4">
</video>
<script>
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
// Disable long-press save on mobile
document.querySelector('video').addEventListener('contextmenu', function(e) { e.preventDefault(); return false; });
</script>
</body>
</html>`;
}

/*
 * Rectangle overlay approach — hides YouTube branding while keeping native controls working.
 * Covers: tl=25%×56px, tr=130×56px, bl=70×60px, fs=90×35px@bottom:78px, br=280×60px@right:50px
 */
function buildYouTubeHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; -webkit-user-select: none; user-select: none; }
.wrapper { position: relative; width: 100%; height: 100%; overflow: hidden; }
iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; }
.cover-tl { position: absolute; top: 0; left: 0; width: 25%; height: 56px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
.cover-tr { position: absolute; top: 0; right: 0; width: 130px; height: 56px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
.cover-bl { position: absolute; bottom: 0; left: 0; width: 70px; height: 60px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
.cover-fs { position: absolute; bottom: 78px; right: 0; width: 90px; height: 50px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
.cover-br { position: absolute; bottom: 0; right: 50px; width: 280px; height: 60px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
@media (max-width: 600px) {
  .cover-tl { width: 55%; }
  .cover-tr { display: none; }
  .cover-fs { display: none; }
  .cover-br { width: 100%; right: 0; }
}
@media print { body { display: none !important; } }
</style>
</head>
<body>
<div class="wrapper">
<div class="cover-tl"></div>
<div class="cover-tr"></div>
<iframe
  src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&showinfo=0&iv_load_policy=3&cc_load_policy=0&fs=1&disablekb=0&controls=1"
  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  allowfullscreen
></iframe>
<div class="cover-bl"></div>
<div class="cover-fs"></div>
<div class="cover-br"></div>
</div>
<script>document.addEventListener('contextmenu', function(e) { e.preventDefault(); });</script>
</body>
</html>`;
}

// Native-only: YouTube IFrame API with custom controls (zero YouTube branding)
function buildNativeYouTubeHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#000;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#pw{position:relative;width:100%;height:100%}
#player{position:absolute;top:0;left:0;width:100%;height:100%}
.ctl{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.9));padding:10px 14px 14px;z-index:100;display:flex;flex-direction:column;gap:8px;transition:opacity 0.3s}
.ctl.h{opacity:0;pointer-events:none}
.pr{display:flex;align-items:center;gap:10px}
.pb{flex:1;height:5px;background:rgba(255,255,255,0.25);border-radius:3px;position:relative;overflow:visible}
.pf{height:100%;background:#EF4444;border-radius:3px;position:relative}
.pf::after{content:'';position:absolute;right:-6px;top:-4px;width:13px;height:13px;background:#EF4444;border-radius:50%}
.bf{position:absolute;top:0;left:0;height:100%;background:rgba(255,255,255,0.15);border-radius:3px}
.tt{font-size:12px;color:rgba(255,255,255,0.85);font-family:-apple-system,sans-serif;min-width:80px;text-align:center}
.br{display:flex;align-items:center;gap:6px}
.cb{background:none;border:none;color:#fff;padding:8px;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
.cb svg{width:26px;height:26px;fill:#fff}
.cb.sm svg{width:22px;height:22px}
.sp{flex:1}
.bp{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:70px;height:70px;background:rgba(0,0,0,0.5);border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:50;transition:opacity 0.2s;-webkit-tap-highlight-color:transparent}
.bp.h{opacity:0;pointer-events:none}
.bp svg{width:36px;height:36px;fill:#fff;margin-left:4px}
.ld{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border:3px solid rgba(255,255,255,0.2);border-top:3px solid #fff;border-radius:50%;animation:sp 0.8s linear infinite;z-index:50;display:none}
@keyframes sp{to{transform:translate(-50%,-50%) rotate(360deg)}}
</style>
</head>
<body>
<div id="pw" ontouchstart="sc()">
<div id="player"></div>
<div class="ld" id="ld"></div>
<div class="bp" id="bp" ontouchend="tp()"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
<div class="ctl" id="ctl">
<div class="pr"><div class="pb" id="pb" ontouchend="skT(event)"><div class="bf" id="bf"></div><div class="pf" id="pf"></div></div><span class="tt" id="tt">0:00 / 0:00</span></div>
<div class="br">
<button class="cb" ontouchend="tp()"><svg viewBox="0 0 24 24" id="pli"><path d="M8 5v14l11-7z"/></svg></button>
<button class="cb sm" ontouchend="fwd(-10)"><svg viewBox="0 0 24 24"><path d="M12.5 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg></button>
<button class="cb sm" ontouchend="fwd(10)"><svg viewBox="0 0 24 24"><path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8V1l-5 5 5 5V7c3.31 0 6 2.69 6 6z"/></svg></button>
<button class="cb sm" id="vb" ontouchend="tm()"><svg viewBox="0 0 24 24" id="vi"><path d="M16.5 12A4.5 4.5 0 0014 8v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg></button>
<div class="sp"></div>
<button class="cb sm" ontouchend="tsp()"><svg viewBox="0 0 24 24"><text x="12" y="17" font-size="12" fill="#fff" text-anchor="middle" font-weight="bold" font-family="sans-serif" id="spt">1x</text></svg></button>
</div></div></div>
<script>
var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);
var p,rdy=0,ht,spds=[0.5,0.75,1,1.25,1.5,2],si=2,isMuted=1;
function onYouTubeIframeAPIReady(){
p=new YT.Player('player',{videoId:'${videoId}',
playerVars:{autoplay:1,mute:1,controls:0,modestbranding:1,rel:0,showinfo:0,iv_load_policy:3,cc_load_policy:0,playsinline:1,disablekb:1,fs:0},
events:{onReady:onRdy,onStateChange:onSt}});}
function onRdy(e){rdy=1;e.target.playVideo();up();sc();
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('ready');}
function onSt(e){var s=e.data;
document.getElementById('ld').style.display=s===3?'block':'none';
document.getElementById('bp').className=(s===1||s===3)?'bp h':'bp';upi();}
function tp(){if(!rdy)return;p.getPlayerState()===1?p.pauseVideo():p.playVideo();}
function upi(){var pl=p&&p.getPlayerState()===1;
document.getElementById('pli').innerHTML=pl?'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>':'<path d="M8 5v14l11-7z"/>';}
function fwd(s){if(!rdy)return;p.seekTo(Math.max(0,p.getCurrentTime()+s),true);}
function tm(){if(!rdy)return;if(isMuted){p.unMute();p.setVolume(100);isMuted=0;}else{p.mute();isMuted=1;}uvi();}
function uvi(){document.getElementById('vi').innerHTML=isMuted?'<path d="M16.5 12A4.5 4.5 0 0014 8v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>':'<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8v8.05A4.49 4.49 0 0016.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';}
function tsp(){si=(si+1)%spds.length;p.setPlaybackRate(spds[si]);document.getElementById('spt').textContent=spds[si]+'x';}
function skT(e){if(!rdy)return;e.preventDefault();var b=document.getElementById('pb'),r=b.getBoundingClientRect();
var t=e.changedTouches?e.changedTouches[0]:e;var pc=Math.max(0,Math.min(1,(t.clientX-r.left)/r.width));
p.seekTo(pc*p.getDuration(),true);}
function fm(s){s=Math.floor(s);var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;
return h>0?h+':'+(m<10?'0':'')+m+':'+(sc<10?'0':'')+sc:m+':'+(sc<10?'0':'')+sc;}
function up(){if(rdy&&p.getDuration){var c=p.getCurrentTime()||0,d=p.getDuration()||1;
document.getElementById('pf').style.width=(c/d*100)+'%';
document.getElementById('tt').textContent=fm(c)+' / '+fm(d);
var l=p.getVideoLoadedFraction?p.getVideoLoadedFraction():0;
document.getElementById('bf').style.width=(l*100)+'%';}requestAnimationFrame(up);}
function sc(){document.getElementById('ctl').className='ctl';clearTimeout(ht);
ht=setTimeout(function(){if(p&&p.getPlayerState()===1)document.getElementById('ctl').className='ctl h';},4000);}
document.addEventListener('contextmenu',function(e){e.preventDefault();});
</script>
</body>
</html>`;
}

function WebYouTubePlayer({ videoId, onReady }: { videoId: string; onReady: () => void }) {
  const calledRef = useRef(false);
  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      onReady();
    }
  }, []);
  return (
    <iframe
      srcDoc={buildYouTubeHtml(videoId)}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
    />
  );
}

function WebCloudflareStreamPlayer({ videoId, onReady }: { videoId: string; onReady: () => void }) {
  const calledRef = useRef(false);
  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      onReady();
    }
  }, []);
  return (
    <iframe
      srcDoc={buildCloudflareStreamHtml(videoId)}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
    />
  );
}

function WebDirectVideoPlayer({ url, onReady }: { url: string; onReady: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const calledRef = useRef(false);
  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      onReady();
    }
  }, []);
  return (
    <video
      ref={videoRef as any}
      src={url}
      controls
      autoPlay
      playsInline
      controlsList="nodownload noplaybackrate"
      disablePictureInPicture
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } as any}
      onContextMenu={(e: any) => e.preventDefault()}
    />
  );
}

export default function LectureScreen() {
  useScreenProtection(true);
  // Apply enhanced video protection only for local video playback
  const { id, courseId, videoUrl: paramVideoUrl, title: paramTitle, isLocal } = useLocalSearchParams<{
    id: string; courseId: string; videoUrl: string; title: string; isLocal?: string;
  }>();
  const isPlayingLocalVideo = isLocal === 'true';
  useVideoScreenProtection(isPlayingLocalVideo);
  
  if (isAndroidWeb()) return <AndroidWebGate />;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const { data: lectureData } = useQuery<{ video_url: string; title: string; is_completed?: boolean; download_allowed?: boolean }>({
    queryKey: [`/api/lectures/${id}`],
  });

  const { data: progressData } = useQuery<{ is_completed: boolean }>({
    queryKey: [`/api/lectures/${id}/progress`],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/lectures/${id}/progress`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return { is_completed: false };
      return res.json();
    },
    enabled: !!id,
  });

  const isCompleted = progressData?.is_completed || lectureData?.is_completed || false;

  const rawVideoUrl = lectureData?.video_url || paramVideoUrl || "";
  // Convert stored URLs to use the correct server base URL for current device
  const baseUrl = getApiUrl();
  let videoUrl = rawVideoUrl;
  
  // Skip URL conversion for local file:// URIs
  if (!rawVideoUrl.startsWith('file://')) {
    if (rawVideoUrl.includes("cdn.3ilearning.in")) {
      videoUrl = `${baseUrl}/api/media/${rawVideoUrl.replace("https://cdn.3ilearning.in/", "")}`;
    } else if (rawVideoUrl.includes("3ilearning.in/")) {
      videoUrl = `${baseUrl}/api/media/${rawVideoUrl.replace(/https?:\/\/[^/]*3ilearning\.in\//, "")}`;
    } else if (rawVideoUrl.includes("/api/media/")) {
      // Replace any host (localhost, other IP) with the correct one for this device
      videoUrl = `${baseUrl}/api/media/${rawVideoUrl.replace(/^https?:\/\/[^/]+\/api\/media\//, "")}`;
    }
  }
  
  const title = lectureData?.title || paramTitle || "Lecture";

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  // Determine video type and prepare appropriate HTML
  const videoId = getYouTubeVideoId(videoUrl);
  const isStreamId = !videoId && isCloudflareStreamId(videoUrl);
  const isDirect = !videoId && !isStreamId && isDirectVideoUrl(videoUrl);
  
  const youtubeHtml = videoId ? buildYouTubeHtml(videoId) : "";
  const nativeYouTubeHtml = videoId ? buildNativeYouTubeHtml(videoId) : "";
  const streamHtml = isStreamId ? buildCloudflareStreamHtml(videoUrl) : "";
  const directVideoHtml = isDirect ? buildDirectVideoHtml(videoUrl) : "";

  const handleMarkComplete = async () => {
    try {
      await apiRequest("POST", `/api/lectures/${id}/progress`, {
        courseId: courseId ? parseInt(courseId) : undefined,
        watchPercent: 100,
        isCompleted: true,
      });
      // Invalidate queries to refresh the UI
      qc.invalidateQueries({ queryKey: [`/api/lectures/${id}/progress`] });
      qc.invalidateQueries({ queryKey: ["/api/courses", courseId] });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Lecture Completed!", "Your progress has been saved.", [
        { text: "Continue", onPress: () => router.back() },
      ]);
    } catch (err: any) {
      console.error("Mark complete error:", err);
      Alert.alert("Error", `Failed to save progress: ${err?.message || "Unknown error"}`);
    }
  };

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

  const handleWebViewMessage = (event: any) => {
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
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.headerTitle}>
            <Text style={styles.lectureTitleText} numberOfLines={1}>{title || "Lecture"}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {lectureData && (
              <DownloadButton
                itemType="lecture"
                itemId={parseInt(id)}
                downloadAllowed={lectureData.download_allowed || false}
                isEnrolled={true}
              />
            )}
            {isCompleted && (
              <View style={styles.completedBadge}>
                <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
              </View>
            )}
          </View>
        </View>
      </View>


      <View style={styles.playerContainer}>
        {/* Video Watermark Overlay */}
        <VideoWatermark isPlaying={isVideoPlaying} />
        
        {isLoading && !hasError && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading video...</Text>
          </View>
        )}
        {hasError && (
          <View style={styles.errorOverlay}>
            <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
            <Text style={styles.errorTitle}>Video unavailable</Text>
            <Text style={styles.errorSub}>Check your internet connection and try again.</Text>
            <Pressable style={styles.retryBtn} onPress={() => { setHasError(false); setIsLoading(true); }}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        )}
        {!hasError && videoId && Platform.OS === "web" ? (
          <WebYouTubePlayer videoId={videoId} onReady={() => setIsLoading(false)} />
        ) : !hasError && isStreamId && Platform.OS === "web" ? (
          <WebCloudflareStreamPlayer videoId={videoUrl} onReady={() => setIsLoading(false)} />
        ) : !hasError && videoId && nativeYouTubeHtml && Platform.OS !== "web" ? (
          <WebView
            source={{ html: nativeYouTubeHtml, baseUrl: "https://www.youtube.com" }}
            style={styles.webView}
            onLoad={() => { setIsLoading(false); setIsVideoPlaying(true); }}
            onError={() => { setIsLoading(false); setHasError(true); }}
            onMessage={handleWebViewMessage}
            allowsFullscreenVideo={false}
            mediaPlaybackRequiresUserAction={false}
            injectedJavaScript={preventScreenCapture}
            allowsInlineMediaPlayback
            scrollEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="compatibility"
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
          />
        ) : !hasError && isStreamId && streamHtml ? (
          <WebView
            source={{ html: streamHtml, baseUrl: "https://cloudflarestream.com" }}
            style={styles.webView}
            onLoad={() => { setIsLoading(false); setIsVideoPlaying(true); }}
            onError={() => { setIsLoading(false); setHasError(true); }}
            onMessage={handleWebViewMessage}
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            injectedJavaScript={preventScreenCapture}
            allowsInlineMediaPlayback
            scrollEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="compatibility"
            originWhitelist={["*"]}
          />
        ) : !hasError && isDirect && Platform.OS === "web" ? (
          <WebDirectVideoPlayer url={videoUrl} onReady={() => setIsLoading(false)} />
        ) : !hasError && isDirect && Platform.OS !== "web" ? (
          <WebView
            source={{ html: directVideoHtml }}
            style={styles.webView}
            onLoad={() => { setIsLoading(false); setIsVideoPlaying(true); }}
            onError={() => { setIsLoading(false); setHasError(true); }}
            onMessage={handleWebViewMessage}
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            injectedJavaScript={preventScreenCapture}
            allowsInlineMediaPlayback
            scrollEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="compatibility"
            originWhitelist={["*"]}
          />
        ) : !hasError && !videoId && !isDirect && !isStreamId ? (
          <View style={styles.errorOverlay}>
            <Ionicons name="videocam-off-outline" size={40} color={Colors.light.textMuted} />
            <Text style={styles.errorTitle}>No video available</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        style={styles.infoSection}
        contentContainerStyle={[styles.infoContent, { paddingBottom: bottomPadding + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lectureInfoTitle}>{title || "Lecture"}</Text>

        {!isCompleted && (
          <Pressable
            style={({ pressed }) => [styles.completeBtn, pressed && { opacity: 0.9 }]}
            onPress={handleMarkComplete}
          >
            <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.completeBtnGradient}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.completeBtnText}>Mark as Complete</Text>
            </LinearGradient>
          </Pressable>
        )}

        {isCompleted && (
          <View style={styles.completedBanner}>
            <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
            <Text style={styles.completedBannerText}>Lecture completed!</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: "#000", zIndex: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1 },
  lectureTitleText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  completedBadge: { width: 36, alignItems: "center" },
  playerContainer: {
    width: "100%",
    backgroundColor: "#000",
    position: "relative" as const,
    overflow: "hidden" as const,
    ...Platform.select({
      web: { height: 450, maxHeight: "60%" as any },
      default: { flex: 1, maxHeight: "56%" as any },
    }),
  },
  webView: { flex: 1, backgroundColor: "#000" },
  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#000", alignItems: "center", justifyContent: "center", gap: 12, zIndex: 10,
  },
  loadingText: { color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", fontSize: 13 },
  errorOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, zIndex: 10,
  },
  errorTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff", textAlign: "center" },
  errorSub: { fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { backgroundColor: Colors.light.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  infoSection: { flex: 1, backgroundColor: Colors.light.background },
  infoContent: { padding: 20, gap: 14 },
  lectureInfoTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  completeBtn: { borderRadius: 14, overflow: "hidden" },
  completeBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 8 },
  completeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  completedBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#DCFCE7", borderRadius: 12, padding: 14,
  },
  completedBannerText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#15803D", flex: 1 },
});
