import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform, Image,
  ActivityIndicator, Alert, ScrollView, useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams, usePathname } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { apiRequest, authFetch, fetchMediaToken, getApiUrl, getBaseUrl, toHttpsMediaUrl } from "@/lib/query-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { useVideoScreenProtection } from "@/lib/useVideoScreenProtection";
import { useAuth } from "@/context/AuthContext";
import { DownloadButton } from "@/components/DownloadButton";
import { VideoWatermark } from "@/components/VideoWatermark";
import { buildYouTubePhoneWebSrcDoc } from "@/lib/buildYouTubePhoneWebSrcDoc";
import { buildCfHlsPlayerHtml } from "@/lib/buildCfHlsPlayerHtml";
import { extractMediaFileKey } from "@/lib/media-key";
import { fullscreenLandscapeScript } from "@/lib/fullscreen-landscape-html";
import {
  handlePlaybackFullscreenMessage,
  lockLandscapeForPlayback,
  restorePortraitAfterPlayback,
  useVideoPlaybackOrientation,
} from "@/lib/video-playback-orientation";

const mediaTokenCache = new Map<string, { token: string; expiresAt: number; readUrl?: string }>();
const MEDIA_TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const MEDIA_READ_URL_MIN_TTL_MS = 15 * 1000;

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

function isBoardSnapshotImage(url: string): boolean {
  if (!url) return false;
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
}

function isDirectVideoUrl(url: string): boolean {
  if (!url) return false;
  if (isBoardSnapshotImage(url)) return false;
  const lower = url.toLowerCase();
  if (lower.match(/\.(mp4|mov|mkv|avi|webm)(\?|$)/)) return true;
  if (lower.includes("3ilearning.in")) return true;
  if (lower.includes("r2.cloudflarestorage.com")) return true;
  if (lower.includes("r2.dev")) return true;
  if (lower.includes("cdn.")) return true;
  if (lower.includes("/api/media/")) return true;
  return false;
}

function isCloudflareStreamId(str: string): boolean {
  if (!str) return false;
  // Cloudflare Stream video IDs are 32-character hex strings
  return /^[a-f0-9]{32}$/i.test(str.trim());
}

function isHlsManifestUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (/\.m3u8($|\?)/i.test(lower)) return true;
  if (lower.includes("videodelivery.net/") && lower.includes("/manifest/")) return true;
  return false;
}

function cloudflareStreamHlsUrl(videoId: string): string {
  const id = String(videoId || "").trim();
  if (!isCloudflareStreamId(id)) return "";
  const playbackBase = String(process.env.EXPO_PUBLIC_CF_STREAM_DOWNLOAD_BASE_URL || "").trim().replace(/\/+$/, "");
  if (playbackBase) return `${playbackBase}/${id}/manifest/video.m3u8`;
  const accountId = String(process.env.EXPO_PUBLIC_CLOUDFLARE_ACCOUNT_ID || "").trim();
  return accountId ? `https://customer-${accountId}.cloudflarestream.com/${id}/manifest/video.m3u8` : "";
}

function buildCloudflareStreamHtml(videoId: string, signedUrl?: string, startAt = 0): string {
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
  controlslist="nodownload noremoteplayback"
  disablepictureinpicture
  ${signedUrl ? `signed-url="${signedUrl}"` : ''}
></stream>
<script>
// Disable right-click and context menu
document.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; });

// Disable text selection
document.addEventListener('selectstart', function(e) { e.preventDefault(); return false; });

var cfStartAt = ${startAt > 5 ? startAt - 2 : startAt};
var cfLastSaved = 0;
function postHost(payload) {
  try {
    var msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
  } catch (_) {}
}
// Get player instance
const player = document.getElementById('player');
var media = document.querySelector('video');
if (media) {
  media.setAttribute('controlsList', 'nodownload noremoteplayback nopictureinpicture');
  media.setAttribute('disablePictureInPicture', 'true');
  media.setAttribute('disableRemotePlayback', 'true');
  media.setAttribute('x-webkit-airplay', 'deny');
  media.disablePictureInPicture = true;
  media.disableRemotePlayback = true;
}

// Notify React Native when ready
if (player) {
  player.addEventListener('loadstart', function() {
    if (cfStartAt > 0) { try { player.currentTime = cfStartAt; } catch(e) {} }
    postHost('ready');
  });
  player.addEventListener('timeupdate', function() {
    var ct = Math.floor(player.currentTime || 0);
    if (Math.abs(ct - cfLastSaved) >= 10) {
      cfLastSaved = ct; postHost({ event: 'timeupdate', currentTime: ct, duration: Math.floor(player.duration || 0) });
    }
  });
  
  // Track playback for analytics
  player.addEventListener('play', function() {
    postHost({ event: 'play' });
  });
  
  player.addEventListener('pause', function() {
    postHost({ event: 'pause' });
  });
  
  player.addEventListener('ended', function() {
    postHost({ event: 'ended' });
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

function buildDirectVideoHtml(url: string, startAt = 0): string {
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
<video id="v" controls autoplay muted playsinline preload="auto" controlsList="nodownload noremoteplayback nopictureinpicture" disablePictureInPicture disableRemotePlayback x-webkit-airplay="deny"></video>
<script>
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
// Disable long-press save on mobile
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
  var lastBufferAhead = 0;
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
    } catch (_) {
      return 0;
    }
  }
  function rememberGoodTime() {
    var ct = Math.floor(v.currentTime || 0);
    if (ct > 0) lastGoodTime = ct;
    lastBufferAhead = bufferAhead();
  }
  function clearStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
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
      var ct = Math.floor(v.currentTime);
      if (Math.abs(ct - lastSaved) >= 5) {
        lastSaved = ct;
        postHost({ event: 'timeupdate', currentTime: ct, duration: Math.floor(v.duration || 0), bufferAhead: Math.floor(lastBufferAhead || 0) });
      }
    }
  }, 5000);
  function reportNow(eventName) {
    var ct = Math.floor(v.currentTime || 0);
    if (ct > 0) {
      lastSaved = ct;
      postHost({ event: eventName, currentTime: ct, duration: Math.floor(v.duration || 0), bufferAhead: Math.floor(bufferAhead() || 0) });
    }
  }
  v.addEventListener('loadedmetadata', seekToResume);
  v.addEventListener('canplay', function() { clearStallTimer(); seekToResume(); });
  v.addEventListener('playing', function() { clearStallTimer(); retryCount = 0; rememberGoodTime(); postHost({ event: 'play' }); });
  v.addEventListener('progress', rememberGoodTime);
  v.addEventListener('pause', function() { clearStallTimer(); reportNow('pause'); });
  v.addEventListener('waiting', function() { reportNow('waiting'); scheduleStallRetry('waiting'); });
  v.addEventListener('stalled', function() { reportNow('stalled'); scheduleStallRetry('stalled'); });
  v.addEventListener('suspend', function() {
    if (!v.paused && !v.ended && bufferAhead() < 2) scheduleStallRetry('suspend');
  });
  v.addEventListener('error', function() { reportNow('error'); retryAfterStall('direct-video-error'); });
  v.addEventListener('ended', function() { reportNow('ended'); postHost({ event: 'ended', currentTime: Math.floor(v.currentTime || 0), duration: Math.floor(v.duration || 0) }); });
  v.muted = true;
  var tryUnmute = function() { v.muted = false; };
  try { v.load(); } catch (_) {}
  var p = v.play();
  if (p && p.then) p.then(tryUnmute).catch(function() { v.muted = true; v.play().catch(function() {}); });
})();
${fullscreenLandscapeScript()}
</script>
</body>
</html>`;
}

/** Phone-web lecture YouTube — same shell fullscreen + bars as live class narrow web. */
function buildYouTubeHtml(videoId: string, startAt = 0): string {
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
  });
  if (startAt > 5) q.set("start", String(Math.max(0, Math.floor(startAt - 2))));
  return buildYouTubePhoneWebSrcDoc({ videoId, embedQueryWithoutFs: q.toString() });
}

// Native-only: YouTube IFrame API with custom controls (zero YouTube branding)
function buildNativeYouTubeHtml(videoId: string, startAt = 0): string {
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
<button class="cb sm" ontouchend="tfs()"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>
<button class="cb sm" ontouchend="tsp()"><svg viewBox="0 0 24 24"><text x="12" y="17" font-size="12" fill="#fff" text-anchor="middle" font-weight="bold" font-family="sans-serif" id="spt">1x</text></svg></button>
</div></div></div>
<script>
var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);
var p,rdy=0,ht,spds=[0.5,0.75,1,1.25,1.5,2],si=2,isMuted=1;
function onYouTubeIframeAPIReady(){
p=new YT.Player('player',{videoId:'${videoId}',
playerVars:{autoplay:1,mute:1,controls:0,modestbranding:1,rel:0,showinfo:0,iv_load_policy:3,cc_load_policy:0,playsinline:1,disablekb:1,fs:0},
events:{onReady:onRdy,onStateChange:onSt}});}
var startAt=${startAt > 5 ? startAt - 2 : startAt};
var lastSavedTime=0;
function onRdy(e){rdy=1;if(startAt>0){e.target.seekTo(startAt,true);}e.target.playVideo();up();sc();
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('ready');}
function onSt(e){var s=e.data;
document.getElementById('ld').style.display=s===3?'block':'none';
document.getElementById('bp').className=(s===1||s===3)?'bp h':'bp';upi();
if(s===0&&window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({event:'ended'}));}
if(s===1){tickPos();}}
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
function tickPos(){if(!rdy||!p)return;var ct=Math.floor(p.getCurrentTime()||0);
if(Math.abs(ct-lastSavedTime)>=10&&window.ReactNativeWebView){lastSavedTime=ct;window.ReactNativeWebView.postMessage(JSON.stringify({event:'timeupdate',currentTime:ct,duration:Math.floor((p.getDuration&&p.getDuration())||0)}));}
if(p.getPlayerState()===1)setTimeout(tickPos,5000);}
function sc(){document.getElementById('ctl').className='ctl';clearTimeout(ht);
ht=setTimeout(function(){if(p&&p.getPlayerState()===1)document.getElementById('ctl').className='ctl h';},4000);}
function tfs(){
  var pw=document.getElementById('pw');
  if(!pw)return;
  var fn=pw.requestFullscreen||pw.webkitRequestFullscreen||pw.webkitRequestFullScreen;
  if(fn){var pr=fn.call(pw);if(pr&&pr.then)pr.then(function(){try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({event:'fullscreen',active:true}));}catch(_){}}).catch(function(){try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({event:'fullscreen',active:true}));}catch(_){}});}
  else{try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({event:'fullscreen',active:true}));}catch(_){}}
}
document.addEventListener('contextmenu',function(e){e.preventDefault();});
${fullscreenLandscapeScript()}
</script>
</body>
</html>`;
}

function WebYouTubePlayer({ videoId, resumeAt = 0, onReady }: { videoId: string; resumeAt?: number; onReady: () => void }) {
  return (
    <iframe
      srcDoc={buildYouTubeHtml(videoId, resumeAt)}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      onLoad={onReady}
    />
  );
}

function WebCloudflareStreamPlayer({ videoId, resumeAt = 0, onReady }: { videoId: string; resumeAt?: number; onReady: () => void }) {
  return (
    <iframe
      srcDoc={buildCloudflareStreamHtml(videoId, undefined, resumeAt)}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      onLoad={onReady}
    />
  );
}

function WebDirectVideoPlayer({
  url,
  resumeAt = 0,
  onReady,
  onError,
  onPosition,
}: {
  url: string;
  resumeAt?: number;
  onReady: () => void;
  onError: () => void;
  /** Reports playback position so the parent can persist resume + watch percent. */
  onPosition?: (currentTime: number, duration: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const calledRef = useRef(false);
  const didAutoplay = useRef(false);
  const didSeekRef = useRef(false);
  const lastReportRef = useRef(0);
  useEffect(() => {
    didAutoplay.current = false;
    didSeekRef.current = false;
  }, [url]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const v = videoRef.current;
    if (!v) return;
    const onFs = () => {
      const active =
        document.fullscreenElement === v ||
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement === v;
      if (active) void lockLandscapeForPlayback();
      else void restorePortraitAfterPlayback();
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs as EventListener);
    };
  }, [url]);
  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      onReady();
    }
  }, [onReady]);
  const seekToResume = (v: HTMLVideoElement) => {
    if (didSeekRef.current) return;
    didSeekRef.current = true;
    const target = resumeAt > 5 ? resumeAt - 2 : resumeAt;
    if (target > 0 && Number.isFinite(v.duration) && target < v.duration) {
      try {
        v.currentTime = target;
      } catch {
        /* seek not ready */
      }
    }
  };
  return (
    <video
      ref={videoRef as any}
      src={url}
      controls
      playsInline
      controlsList="nodownload noremoteplayback nopictureinpicture"
      disablePictureInPicture
      disableRemotePlayback
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } as any}
      onContextMenu={(e: any) => e.preventDefault()}
      onLoadedMetadata={(e) => {
        seekToResume(e.currentTarget);
        if (!calledRef.current) {
          calledRef.current = true;
          onReady();
        }
      }}
      onCanPlay={(e) => {
        seekToResume(e.currentTarget);
        if (didAutoplay.current) return;
        didAutoplay.current = true;
        const v = e.currentTarget;
        v.muted = true;
        v.play()
          .then(() => {
            v.muted = false;
          })
          .catch(() => {
            v.muted = true;
            v.play().catch(() => {});
          });
      }}
      onTimeUpdate={(e) => {
        if (!onPosition) return;
        const v = e.currentTarget;
        if (v.paused || v.ended) return;
        const ct = Math.floor(v.currentTime || 0);
        if (ct > 0 && Math.abs(ct - lastReportRef.current) >= 5) {
          lastReportRef.current = ct;
          onPosition(ct, Math.floor(v.duration || 0));
        }
      }}
      onError={() => onError()}
      onEnded={() => {
        // Bubble to React so completed playback can be auto-marked.
        window.dispatchEvent(new CustomEvent("lecture-ended"));
      }}
    />
  );
}

export default function LectureScreen() {
  useScreenProtection(true);
  useVideoPlaybackOrientation();
  const { colors } = useAppTheme();
  // Apply enhanced video protection only for local video playback
  const { id, courseId, videoUrl: paramVideoUrl, title: paramTitle, isLocal } = useLocalSearchParams<{
    id: string; courseId: string; videoUrl: string; title: string; isLocal?: string;
  }>();
  const isPlayingLocalVideo = isLocal === 'true';
  useVideoScreenProtection(isPlayingLocalVideo);
  
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { width: windowWidth } = useWindowDimensions();
  const isWebWide = Platform.OS === "web" && windowWidth >= 960;
  const isNarrowWeb = Platform.OS === "web" && !isWebWide;
  const qc = useQueryClient();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [playerRetryTick, setPlayerRetryTick] = useState(0);
  const autoCompleteSentRef = useRef(false);
  const autoPlaybackRetryRef = useRef(false);
  const lastSavedPositionRef = useRef(0);
  const latestPlaybackPositionRef = useRef(0);
  // Resume position is frozen once (when progress first loads) so the injected
  // WebView HTML never changes mid-playback and forces a full document reload.
  const initialResumeRef = useRef<number | null>(null);
  const [mediaTokenError, setMediaTokenError] = useState<string | null>(null);
  const [mediaTokenRetryTick, setMediaTokenRetryTick] = useState(0);

  const { data: lectureData, error: lectureError, refetch: refetchLecture } = useQuery<{
    video_url: string;
    pdf_url?: string;
    title: string;
    is_completed?: boolean;
    download_allowed?: boolean;
    course_id?: number;
    live_class_id?: number | null;
  }>({
    queryKey: ["/api/lectures", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/lectures/${id}`, baseUrl);
      let res = await authFetch(url.toString());
      if (res.status === 401) {
        // Session cookies can briefly desync on web; verify auth and retry once before locking UI.
        const meRes = await authFetch(new URL("/api/auth/me", baseUrl).toString()).catch(() => null);
        if (meRes && meRes.ok) {
          res = await authFetch(url.toString());
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load lecture");
      }
      return res.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: (query) => {
      const cached = query.state.data as { video_url?: string } | undefined;
      return !cached?.video_url;
    },
  });

  const { data: progressData, refetch: refetchProgress } = useQuery<{ is_completed: boolean; watch_percent?: number; playback_sessions?: number; last_position_seconds?: number }>({
    queryKey: [`/api/lectures/${id}/progress`],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/lectures/${id}/progress`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return { is_completed: false, last_position_seconds: 0 };
      return res.json();
    },
    enabled: !!id,
  });

  useEffect(() => {
    const savedPos = Math.floor(Number(progressData?.last_position_seconds) || 0);
    if (savedPos > latestPlaybackPositionRef.current) {
      latestPlaybackPositionRef.current = savedPos;
    }
  }, [progressData?.last_position_seconds]);

  // Debounced "opened player" for admin replay stats (~8 min server-side debounce between bumps).
  useEffect(() => {
    if (!id || !lectureData) return;
    const tid = setTimeout(() => {
      apiRequest("POST", `/api/lectures/${id}/progress/session`, {}).catch(() => {});
    }, 2800);
    return () => clearTimeout(tid);
  }, [id, lectureData?.course_id]);

  useEffect(() => {
    const cid = lectureData?.course_id || (courseId ? Number(courseId) : null);
    if (!cid || !Number.isFinite(cid)) return;
    const baseUrl = getApiUrl();
    const uidSeg = String(user?.id ?? "guest");
    const url = new URL(`/api/courses/${cid}`, baseUrl);
    if (user?.id) url.searchParams.set("_uid", String(user.id));
    qc.prefetchQuery({
      queryKey: ["/api/courses", String(cid), uidSeg],
      queryFn: async () => {
        const res = await authFetch(url.toString());
        if (!res.ok) throw new Error("prefetch course failed");
        return res.json();
      },
      staleTime: 30000,
    });
  }, [lectureData?.course_id, courseId, qc, user?.id]);

  const isCompleted = progressData?.is_completed || lectureData?.is_completed || false;

  const needsBoardFallback =
    !!lectureData?.live_class_id &&
    !String(lectureData?.video_url || "").trim() &&
    !String(paramVideoUrl || "").trim();

  const { data: classroomBoardSnapshot } = useQuery<{ boardSnapshotUrl: string | null }>({
    queryKey: ["/api/live-classes", lectureData?.live_class_id, "classroom/board-snapshot"],
    queryFn: async () => {
      const lcId = lectureData!.live_class_id!;
      const res = await authFetch(
        `${getApiUrl()}/live-classes/${encodeURIComponent(String(lcId))}/classroom/board-snapshot`
      );
      if (!res.ok) throw new Error("Failed to load board snapshot");
      return res.json();
    },
    enabled: needsBoardFallback,
    staleTime: 5 * 60 * 1000,
  });

  const rawVideoUrl =
    lectureData?.video_url ||
    paramVideoUrl ||
    (needsBoardFallback ? classroomBoardSnapshot?.boardSnapshotUrl || "" : "");
  const baseUrl = getBaseUrl();
  const [mediaToken, setMediaToken] = useState<string | null>(null);
  const [mediaReadUrl, setMediaReadUrl] = useState<string | null>(null);
  let videoUrl = rawVideoUrl;

  if (!rawVideoUrl.startsWith('file://')) {
    if (rawVideoUrl.startsWith("https://cdn.3ilearning.in/") ||
        rawVideoUrl.includes("r2.cloudflarestorage.com") ||
        rawVideoUrl.includes("youtube.com") ||
        rawVideoUrl.includes("youtu.be")) {
      videoUrl = rawVideoUrl;
    } else if (rawVideoUrl.includes("/api/media/")) {
      const path = rawVideoUrl.startsWith("/") ? rawVideoUrl : rawVideoUrl.replace(/^https?:\/\/[^/]+/, "");
      // Videos use direct API URL (video tags support cross-origin, no iframe restriction)
      videoUrl = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    }
  }
  videoUrl = toHttpsMediaUrl(videoUrl);
  const fileKey = extractMediaFileKey(rawVideoUrl);
  const userScopedMediaKey = fileKey ? `${String(user?.id || 0)}:${fileKey}` : null;
  useEffect(() => {
    if (!fileKey || !userScopedMediaKey) {
      setMediaToken(null);
      setMediaReadUrl(null);
      setMediaTokenError(null);
      return;
    }
    const cached = mediaTokenCache.get(userScopedMediaKey);
    if (cached && cached.expiresAt > Date.now()) {
      setMediaToken(cached.token);
      // Prefer direct R2 reads; fall back to the API proxy only when the URL is about to expire.
      const readUrlSafe = cached.readUrl && cached.expiresAt > Date.now() + MEDIA_READ_URL_MIN_TTL_MS
        ? cached.readUrl
        : null;
      setMediaReadUrl(readUrlSafe);
      setMediaTokenError(null);
      return;
    }
    let cancelled = false;
    setMediaTokenError(null);
    void (async () => {
      let r = await fetchMediaToken(fileKey);
      if (!r.ok && (r.status === 401 || r.status === 500 || r.status === 504)) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        r = await fetchMediaToken(fileKey);
      }
      if (!r.ok && r.status === 401) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        r = await fetchMediaToken(fileKey);
      }
      if (cancelled) return;
      if (r.ok) {
        setMediaToken(r.token);
        setMediaReadUrl(r.readUrl ?? null);
        mediaTokenCache.set(userScopedMediaKey, {
          token: r.token,
          expiresAt: r.expiresAt,
          ...(r.readUrl ? { readUrl: r.readUrl } : {}),
        });
        return;
      }
      setMediaReadUrl(null);
      const msg =
        r.status === 401
          ? "Secure playback could not refresh. Tap Retry; if it still fails, sign in again."
          : r.status === 403
            ? "You do not have access to this file. If you are enrolled, pull to refresh the course page and retry."
            : r.message || `Could not unlock playback (${r.status}).`;
      setMediaReadUrl(null);
      setMediaTokenError(msg);
    })();
    return () => {
      cancelled = true;
    };
  }, [fileKey, userScopedMediaKey, mediaTokenRetryTick]);
  useEffect(() => {
    if (!userScopedMediaKey || !fileKey) return;
    const cached = mediaTokenCache.get(userScopedMediaKey);
    if (!cached?.expiresAt) return;
    const msUntilRefresh = Math.max(0, cached.expiresAt - Date.now() - MEDIA_TOKEN_REFRESH_SKEW_MS);
    const tid = setTimeout(() => setMediaTokenRetryTick((t) => t + 1), msUntilRefresh);
    return () => clearTimeout(tid);
  }, [fileKey, userScopedMediaKey, mediaToken]);
  const authenticatedVideoUrl = toHttpsMediaUrl(
    fileKey && mediaToken
      ? mediaReadUrl || `${baseUrl}/api/media/${fileKey}?token=${mediaToken}`
      : videoUrl,
  ) || videoUrl;
  const isSecuringPlayback = !!fileKey && !mediaToken && !mediaTokenError;
  const canMountPlayer = !fileKey || !!mediaToken;

  const title = lectureData?.title || paramTitle || "Lecture";

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? Math.max(34, insets.bottom) : insets.bottom;

  const handleBack = useCallback(() => {
    const fallback = () => {
      const cid = lectureData?.course_id || (courseId ? Number(courseId) : null);
      if (cid && Number.isFinite(cid)) {
        router.replace({ pathname: "/course/[id]", params: { id: String(cid) } } as any);
      } else {
        router.replace("/(tabs)" as any);
      }
    };

    if (router.canGoBack()) {
      router.back();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const before = pathname;
        setTimeout(() => {
          if (window.location.pathname === before) fallback();
        }, 350);
      }
      return;
    }
    fallback();
  }, [courseId, lectureData?.course_id, pathname]);

  // Determine video type and prepare appropriate HTML
  const playbackUrl = authenticatedVideoUrl || videoUrl;
  const videoId = getYouTubeVideoId(playbackUrl);
  const isStreamId = !videoId && isCloudflareStreamId(playbackUrl);
  const isCfHls = !videoId && !isStreamId && isHlsManifestUrl(playbackUrl);
  const isBoardImage = !videoId && !isStreamId && !isCfHls && isBoardSnapshotImage(playbackUrl);
  const isDirect = !videoId && !isStreamId && !isBoardImage && isDirectVideoUrl(playbackUrl);
  
  // Freeze the resume position the first time progress resolves. After this,
  // playback progress updates never feed back into the injected HTML, so the
  // WebView document stays stable and does not reload every ~5s.
  if (initialResumeRef.current === null && progressData !== undefined) {
    initialResumeRef.current = Math.max(
      Math.floor(Number(progressData?.last_position_seconds) || 0),
      latestPlaybackPositionRef.current,
    );
  }
  const frozenResumeAt = initialResumeRef.current ?? 0;
  // Stable identity for the player document — independent of token refreshes
  // (fileKey stays constant while the presigned/proxied URL rotates).
  const mediaIdentity = fileKey || playbackUrl;

  const youtubeHtml = useMemo(() => (videoId ? buildYouTubeHtml(videoId) : ""), [videoId]);
  const nativeYouTubeHtml = useMemo(
    () => (videoId ? buildNativeYouTubeHtml(videoId, frozenResumeAt) : ""),
    [videoId, frozenResumeAt],
  );
  const nativeStreamHlsUrl = useMemo(
    () => (isStreamId ? cloudflareStreamHlsUrl(playbackUrl) : ""),
    [isStreamId, playbackUrl],
  );
  const streamHtml = useMemo(
    () => (isStreamId ? buildCloudflareStreamHtml(playbackUrl, undefined, frozenResumeAt) : ""),
    [isStreamId, playbackUrl, frozenResumeAt],
  );
  const directVideoHtml = useMemo(
    () => (isDirect ? buildDirectVideoHtml(playbackUrl, frozenResumeAt) : ""),
    [isDirect, playbackUrl, frozenResumeAt],
  );
  const cfHlsNativeHtml = useMemo(
    () =>
      isStreamId && nativeStreamHlsUrl
        ? buildCfHlsPlayerHtml(nativeStreamHlsUrl, { startAt: frozenResumeAt })
        : "",
    [isStreamId, nativeStreamHlsUrl, frozenResumeAt],
  );
  const cfHlsHtml = useMemo(
    () => (isCfHls ? buildCfHlsPlayerHtml(playbackUrl, { startAt: frozenResumeAt }) : ""),
    [isCfHls, playbackUrl, frozenResumeAt],
  );

  useEffect(() => {
    if (!isCfHls || Platform.OS !== "web" || !playbackUrl) return;
    const t = setTimeout(() => setIsLoading(false), 1200);
    return () => clearTimeout(t);
  }, [isCfHls, playbackUrl, playerRetryTick]);

  const markComplete = async (opts?: { auto?: boolean }) => {
    const auto = !!opts?.auto;
    try {
      await apiRequest("POST", `/api/lectures/${id}/progress`, {
        courseId: courseId ? parseInt(courseId) : undefined,
        watchPercent: 100,
        isCompleted: true,
      });
      // Invalidate queries to refresh the UI
      qc.invalidateQueries({ queryKey: [`/api/lectures/${id}/progress`] });
      if (courseId) {
        qc.invalidateQueries({ queryKey: ["/api/courses", String(courseId)] });
      }
      if (!auto) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Lecture Completed!", "Your progress has been saved.", [
          { text: "Continue", onPress: () => router.back() },
        ]);
      }
    } catch (err: any) {
      console.error("Mark complete error:", err);
      if (!auto) {
        Alert.alert("Error", `Failed to save progress: ${err?.message || "Unknown error"}`);
      }
    }
  };

  const triggerAutoComplete = () => {
    if (isCompleted || autoCompleteSentRef.current) return;
    autoCompleteSentRef.current = true;
    void markComplete({ auto: true });
  };

  // Persist resume position + a real watch percent (never marks complete here).
  const persistPlaybackPosition = useCallback(
    (pos: number, duration: number) => {
      if (!(pos > 0)) return;
      const normalizedPos = Math.floor(pos);
      if (normalizedPos > latestPlaybackPositionRef.current) {
        latestPlaybackPositionRef.current = normalizedPos;
      }
      if (Math.abs(normalizedPos - lastSavedPositionRef.current) < 5) return;
      lastSavedPositionRef.current = normalizedPos;
      const watchPercent =
        duration > 0 ? Math.max(0, Math.min(100, Math.round((normalizedPos / duration) * 100))) : 0;
      // NOTE: do NOT write into the [`/api/lectures/${id}/progress`] cache here.
      // The player reads its resume position from that query; mutating it mid-play
      // would rebuild the injected WebView HTML and reload the document (black
      // screen + 0:00 + buffering loop). Persist to the backend only; the latest
      // position is kept in latestPlaybackPositionRef and re-read on next mount.
      apiRequest("POST", `/api/lectures/${id}/progress`, {
        watchPercent,
        isCompleted: false,
        lastPositionSeconds: normalizedPos,
      }).catch(() => {});
    },
    [id],
  );

  const triggerPlayerRetry = useCallback((auto = false) => {
    const latestPos = latestPlaybackPositionRef.current;
    if (latestPos > 0) {
      persistPlaybackPosition(latestPos, 0);
    }
    setHasError(false);
    setIsLoading(true);
    if (fileKey) {
      setMediaTokenError(null);
      setMediaTokenRetryTick((t) => t + 1);
    }
    void refetchProgress().finally(() => {
      setPlayerRetryTick((t) => t + 1);
    });
    if (!auto) autoPlaybackRetryRef.current = false;
  }, [fileKey, persistPlaybackPosition, refetchProgress]);

  const handlePlaybackError = useCallback(() => {
    if (!autoPlaybackRetryRef.current) {
      autoPlaybackRetryRef.current = true;
      triggerPlayerRetry(true);
      return;
    }
    setIsLoading(false);
    setHasError(true);
    setIsVideoPlaying(false);
  }, [triggerPlayerRetry]);

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
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'ended' }));
        });
      });
    })();
    true;
  `;

  const handlePlaybackHostMessage = useCallback((rawData: unknown) => {
    if (typeof rawData === "string" && handlePlaybackFullscreenMessage(rawData)) return;
    try {
      const data: any = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      if (!data || typeof data !== "object") return;
      if (data.event === 'play') {
        autoPlaybackRetryRef.current = false;
        setIsLoading(false);
        setIsVideoPlaying(true);
      } else if (data.event === 'ready') {
        autoPlaybackRetryRef.current = false;
        setIsLoading(false);
        setIsVideoPlaying(true);
      } else if (data.event === 'error') {
        if (typeof data.currentTime === 'number') {
          const pos = Math.floor(data.currentTime);
          const duration = Math.floor(Number(data.duration) || 0);
          persistPlaybackPosition(pos, duration);
        }
        handlePlaybackError();
      } else if (data.event === 'timeupdate' && typeof data.currentTime === 'number') {
        const pos = Math.floor(data.currentTime);
        const duration = Math.floor(Number(data.duration) || 0);
        persistPlaybackPosition(pos, duration);
      } else if (data.event === 'pause' || data.event === 'ended' || data.event === 'waiting' || data.event === 'stalled') {
        if (typeof data.currentTime === 'number') {
          const pos = Math.floor(data.currentTime);
          const duration = Math.floor(Number(data.duration) || 0);
          persistPlaybackPosition(pos, duration);
        }
        setIsVideoPlaying(false);
        if (data.event === 'ended') {
          triggerAutoComplete();
        }
      }
    } catch (e) {
      // Ignore non-JSON messages
      if (rawData === 'ready') {
        autoPlaybackRetryRef.current = false;
        setIsLoading(false);
        setIsVideoPlaying(true); // Assume playing when ready
      }
    }
  }, [handlePlaybackError, persistPlaybackPosition, triggerAutoComplete]);

  const handleWebViewMessage = (event: any) => {
    handlePlaybackHostMessage(event.nativeEvent.data);
  };

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      handlePlaybackHostMessage(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handlePlaybackHostMessage]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onLectureEnded = () => triggerAutoComplete();
    window.addEventListener("lecture-ended", onLectureEnded as EventListener);
    return () => window.removeEventListener("lecture-ended", onLectureEnded as EventListener);
  }, [isCompleted, id]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={handleBack}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.headerTitle}>
            <Text style={styles.lectureTitleText} numberOfLines={1}>{title || "Lecture"}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {isCompleted && (
              <View style={styles.completedBadge}>
                <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Enrollment gate */}
      {lectureError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
          <Ionicons name="lock-closed" size={48} color={Colors.light.primary} />
          <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text, textAlign: "center" }}>
            {(lectureError as any)?.message || "Access Denied"}
          </Text>
          <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, textAlign: "center" }}>
            {String((lectureError as any)?.message || "").toLowerCase().includes("enroll")
              ? "You need to enroll in this course to watch lectures."
              : "We could not validate your session for this lecture. Please retry."}
          </Text>
          <Pressable
            onPress={() => {
              const msg = String((lectureError as any)?.message || "").toLowerCase();
              if (msg.includes("enroll")) {
                handleBack();
                return;
              }
              void refetchLecture();
            }}
            style={{ backgroundColor: Colors.light.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
              {String((lectureError as any)?.message || "").toLowerCase().includes("enroll") ? "Go Back" : "Retry"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
      <View
        style={[
          styles.playerContainer,
          Platform.OS === "web" && isWebWide && { height: 450, maxHeight: "60%" as any },
          isNarrowWeb && { aspectRatio: 16 / 9, flexGrow: 0, width: "100%" as const },
          Platform.OS !== "web" && { flex: 1, maxHeight: "56%" as any },
        ]}
      >
        {/* Video Watermark Overlay */}
        <VideoWatermark isPlaying={isVideoPlaying} />

        {fileKey && mediaTokenError && (
          <View style={[styles.loadingOverlay, { zIndex: 25, backgroundColor: "rgba(0,0,0,0.92)" }]}>
            <Ionicons name="lock-closed-outline" size={40} color="#fff" />
            <Text style={[styles.loadingText, { marginTop: 12, paddingHorizontal: 20, textAlign: "center" }]}>{mediaTokenError}</Text>
            <Pressable
              style={[styles.retryBtn, { marginTop: 16 }]}
              onPress={() => {
                setMediaTokenError(null);
                setMediaTokenRetryTick((t) => t + 1);
              }}
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        )}
        
        {((isLoading && !hasError) || isSecuringPlayback) && !mediaTokenError && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>{fileKey && !mediaToken ? "Securing playback…" : "Loading video..."}</Text>
          </View>
        )}
        {hasError && (
          <View style={styles.errorOverlay}>
            <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
            <Text style={styles.errorTitle}>Video unavailable</Text>
            <Text style={styles.errorSub}>Check your internet connection and try again.</Text>
            <Pressable style={styles.retryBtn} onPress={() => triggerPlayerRetry()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        )}
        {!hasError && canMountPlayer && videoId && Platform.OS === "web" ? (
          <WebYouTubePlayer key={`yt-web-${playerRetryTick}-${mediaIdentity}`} videoId={videoId} resumeAt={frozenResumeAt} onReady={() => setIsLoading(false)} />
        ) : !hasError && canMountPlayer && isStreamId && Platform.OS === "web" ? (
          <WebCloudflareStreamPlayer key={`cf-web-${playerRetryTick}-${mediaIdentity}`} videoId={playbackUrl} resumeAt={frozenResumeAt} onReady={() => setIsLoading(false)} />
        ) : !hasError && canMountPlayer && isCfHls && Platform.OS === "web" ? (
          <iframe
            key={`hls-web-${playerRetryTick}-${mediaIdentity}`}
            srcDoc={cfHlsHtml}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
            allow="autoplay; fullscreen"
            onLoad={() => { setIsLoading(false); }}
          />
        ) : !hasError && canMountPlayer && videoId && nativeYouTubeHtml && Platform.OS !== "web" ? (
          <WebView
            key={`yt-native-${playerRetryTick}-${mediaIdentity}`}
            source={{ html: nativeYouTubeHtml, baseUrl: "https://www.youtube.com" }}
            style={styles.webView}
            onLoad={() => { setIsLoading(false); setIsVideoPlaying(true); }}
            onError={handlePlaybackError}
            onMessage={handleWebViewMessage}
            allowsFullscreenVideo
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
        ) : !hasError && canMountPlayer && isStreamId && nativeStreamHlsUrl && Platform.OS !== "web" ? (
          <WebView
            key={`cf-hls-native-${playerRetryTick}-${mediaIdentity}`}
            source={{ html: cfHlsNativeHtml }}
            style={styles.webView}
            onLoad={() => { setIsLoading(false); setIsVideoPlaying(true); }}
            onError={handlePlaybackError}
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
        ) : !hasError && canMountPlayer && isStreamId && streamHtml ? (
          <WebView
            key={`cf-native-${playerRetryTick}-${mediaIdentity}`}
            source={{ html: streamHtml, baseUrl: "https://cloudflarestream.com" }}
            style={styles.webView}
            onLoad={() => { setIsLoading(false); setIsVideoPlaying(true); }}
            onError={handlePlaybackError}
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
        ) : !hasError && canMountPlayer && isCfHls && Platform.OS !== "web" ? (
          <WebView
            key={`hls-native-${playerRetryTick}-${mediaIdentity}`}
            source={{ html: cfHlsHtml }}
            style={styles.webView}
            onLoad={() => { setIsLoading(false); setIsVideoPlaying(true); }}
            onError={handlePlaybackError}
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
        ) : !hasError && canMountPlayer && isDirect && Platform.OS === "web" ? (
          <WebDirectVideoPlayer
            key={`direct-web-${playerRetryTick}-${mediaIdentity}`}
            url={playbackUrl}
            resumeAt={frozenResumeAt}
            onReady={() => setIsLoading(false)}
            onError={handlePlaybackError}
            onPosition={persistPlaybackPosition}
          />
        ) : !hasError && canMountPlayer && isDirect && Platform.OS !== "web" ? (
          <WebView
            key={`direct-native-${playerRetryTick}-${mediaIdentity}`}
            source={{ html: directVideoHtml }}
            style={styles.webView}
            onLoad={() => { setIsLoading(false); setIsVideoPlaying(true); }}
            onError={handlePlaybackError}
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
        ) : !hasError && isBoardImage && playbackUrl ? (
          <View style={styles.boardSnapshotWrap}>
            <Image
              source={{ uri: playbackUrl }}
              style={styles.boardSnapshotImage}
              resizeMode="contain"
              onLoad={() => setIsLoading(false)}
              onError={handlePlaybackError}
            />
            <View style={styles.boardSnapshotBadge}>
              <Ionicons name="easel-outline" size={14} color="#fff" />
              <Text style={styles.boardSnapshotBadgeText}>Classroom board snapshot</Text>
            </View>
          </View>
        ) : !hasError && canMountPlayer && !videoId && !isDirect && !isStreamId && !isCfHls && !isBoardImage ? (
          <View style={styles.errorOverlay}>
            <Ionicons name="videocam-off-outline" size={40} color={Colors.light.textMuted} />
            <Text style={styles.errorTitle}>No video available</Text>
            {lectureData && !lectureData.video_url && !paramVideoUrl ? (
              <Text style={styles.errorHint}>
                This recording has no video yet. If you ended a classroom session before the board loaded, try
                re-opening from Live Class Recordings after a new session is saved with a snapshot.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <ScrollView
        style={[styles.infoSection, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.infoContent, { paddingBottom: bottomPadding + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lectureInfoTitle, { color: colors.text }]}>{title || "Lecture"}</Text>

        <View style={styles.actionRow}>
          {lectureData && (
            <DownloadButton
              itemType="lecture"
              itemId={parseInt(id)}
              downloadAllowed={lectureData.download_allowed || false}
              isEnrolled={true}
              title={lectureData.title || title || "Lecture"}
              fileType={lectureData.pdf_url && !lectureData.video_url ? "pdf" : "video"}
            />
          )}

          <Pressable
            style={({ pressed }) => [styles.missionsBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/(tabs)/daily-mission" as any)}
          >
            <Ionicons name="flag" size={18} color={Colors.light.primary} />
            <Text style={styles.missionsBtnText}>Missions</Text>
          </Pressable>

          {!isCompleted ? (
            <Pressable
              style={({ pressed }) => [styles.completeBtn, { flex: 1 }, pressed && { opacity: 0.9 }]}
              onPress={() => void markComplete()}
            >
              <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.completeBtnGradient}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.completeBtnText}>Mark as Complete</Text>
              </LinearGradient>
            </Pressable>
          ) : (
            <View style={[styles.completedBanner, { flex: 1 }]}>
              <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
              <Text style={styles.completedBannerText}>Lecture completed!</Text>
            </View>
          )}
        </View>
      </ScrollView>
        </>
      )}
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
  errorHint: {
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
    marginTop: 4,
  },
  boardSnapshotWrap: { flex: 1, backgroundColor: "#111", position: "relative" },
  boardSnapshotImage: { width: "100%", height: "100%" },
  boardSnapshotBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  boardSnapshotBadgeText: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" },
  errorSub: { fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { backgroundColor: Colors.light.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  infoSection: { flex: 1, backgroundColor: Colors.light.background },
  infoContent: { padding: 20, gap: 14 },
  lectureInfoTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  missionsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#fff",
  },
  missionsBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  completeBtn: { borderRadius: 14, overflow: "hidden" },
  completeBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 8 },
  completeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  completedBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#DCFCE7", borderRadius: 12, padding: 14,
  },
  completedBannerText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#15803D", flex: 1 },
});
