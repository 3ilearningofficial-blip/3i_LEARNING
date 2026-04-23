import React, { useState } from "react";
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
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl, getBaseUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { useVideoScreenProtection } from "@/lib/useVideoScreenProtection";
import { isAndroidWeb } from "@/lib/useAndroidWebGate";
import AndroidWebGate from "@/components/AndroidWebGate";
import { DownloadButton } from "@/components/DownloadButton";

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

// Native-only: YouTube IFrame API with custom controls
function buildNativeYouTubeHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#000;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#pw{position:relative;width:100%;height:100%}
#player{position:absolute;top:0;left:0;width:100%;height:100%}
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
.ld{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border:3px solid rgba(255,255,255,0.2);border-top:3px solid #fff;border-radius:50%;animation:sp 0.8s linear infinite;z-index:50;display:none}
@keyframes sp{to{transform:translate(-50%,-50%) rotate(360deg)}}
</style></head><body>
<div id="pw" ontouchstart="sc()">
<div id="player"></div><div class="ld" id="ld"></div>
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
function onYouTubeIframeAPIReady(){p=new YT.Player('player',{videoId:'${videoId}',playerVars:{autoplay:1,mute:1,controls:0,modestbranding:1,rel:0,showinfo:0,iv_load_policy:3,cc_load_policy:0,playsinline:1,disablekb:1,fs:0},events:{onReady:function(e){rdy=1;e.target.playVideo();up();sc();},onStateChange:function(e){var s=e.data;document.getElementById('ld').style.display=s===3?'block':'none';document.getElementById('bp').className=(s===1||s===3)?'bp h':'bp';upi();}}});}
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
  <iframe src="${previewUrl}" allow="autoplay" allowfullscreen sandbox="allow-scripts allow-same-origin"></iframe>
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
  if (isAndroidWeb()) return <AndroidWebGate />;
  const { id, localUri } = useLocalSearchParams<{ id: string; localUri?: string }>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [mediaToken, setMediaToken] = useState<string | null>(null);
  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const { isAdmin } = useAuth();

  // 16:9 video height based on screen width
  const videoHeight = Math.round(screenWidth * 9 / 16);

  const { data: material, isError: fetchError } = useQuery<{
    id: number; title: string; file_url: string; file_type: string;
    description: string; download_allowed: boolean; is_free: boolean;
    section_title: string | null;
  }>({
    queryKey: ["/api/study-materials", id],
    enabled: !!id,
  });

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

    // Already a full R2/CDN URL — serve directly
    if (raw.startsWith("https://cdn.3ilearning.in/")) return raw;
    if (raw.includes("r2.cloudflarestorage.com")) return raw;
    if (raw.includes("pub-") && raw.includes(".r2.dev")) return raw;

    // Any URL containing /api/media/ — use Vercel proxy on web (full origin URL),
    // or direct API URL on native
    if (raw.includes("/api/media/")) {
      const path = raw.startsWith("/") ? raw : raw.replace(/^https?:\/\/[^/]+/, "");
      if (Platform.OS === "web" && typeof window !== "undefined") {
        return `${window.location.origin}${path}`;
      }
      return `${getBaseUrl()}${path}`;
    }

    // Google Drive / Docs — use as-is
    if (raw.includes("drive.google.com") || raw.includes("docs.google.com")) return raw;

    // Relative path — prepend base
    if (raw.startsWith("/")) return `${getBaseUrl()}${raw}`;

    // Anything else (YouTube, external URLs) — use as-is
    return raw;
  })();

  const isPdf = material && (material.file_type === "pdf" || fileUrl?.toLowerCase().endsWith(".pdf"));
  const isGDrive = material && isGoogleDriveUrl(fileUrl || "");
  const gDriveFileId = material ? getGoogleDriveFileId(fileUrl || "") : null;
  const youtubeVideoId = material ? getYouTubeVideoId(fileUrl || "") : null;
  const isYouTube = !!youtubeVideoId;
  const apiBaseUrl = getBaseUrl();

  // Extract the R2 file key from the URL for token generation
  const fileKey = (() => {
    const raw = material?.file_url || "";
    if (!raw || !raw.includes("/api/media/")) return null;
    const path = raw.startsWith("/") ? raw : raw.replace(/^https?:\/\/[^/]+/, "");
    return path.replace(/^\/api\/media\//, "");
  })();

  // Fetch a short-lived media token for PDF/video viewing (avoids srcDoc cookie issues)
  React.useEffect(() => {
    if (!fileKey || !material) return;
    if (isGDrive || isYouTube) return; // not needed for these
    apiRequest("POST", "/api/media-token", { fileKey })
      .then(r => r.json())
      .then(d => { if (d.token) setMediaToken(d.token); })
      .catch(() => {}); // silently fail — fallback to direct URL
  }, [fileKey, material?.id]);

  // Authenticated URL with token for iframe src (works in all browsers including mobile)
  const tokenizedUrl = mediaToken && fileKey
    ? (Platform.OS === "web" && typeof window !== "undefined"
        ? `${window.location.origin}/api/media/${fileKey}?token=${mediaToken}`
        : `${getBaseUrl()}/api/media/${fileKey}?token=${mediaToken}`)
    : fileUrl;

  return (
    <View style={styles.container}>
      {/* For YouTube: fullscreen with floating back button only */}
      {isYouTube ? (
        <View style={{ flex: 1, backgroundColor: "#000", overflow: "hidden" as const, justifyContent: "center" }}>
          {/* Back button — top-left of screen, above video */}
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
                srcDoc={buildYouTubeHtml(youtubeVideoId!)}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" } as any}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                title={material?.title || "Video"}
                onLoad={() => setLoading(false)}
              />
            ) : (
              <WebView
                source={{ html: buildNativeYouTubeHtml(youtubeVideoId!), baseUrl: "https://www.youtube.com" }}
                style={{ flex: 1, backgroundColor: "#000" }}
                onLoad={() => setLoading(false)}
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
            )}
            {loading && (
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
                  />
                )}
              </View>
            </View>
          </LinearGradient>

          <View style={styles.content}>
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
                  (mediaToken || !fileKey) ? (
                    // Use direct src with token (or direct URL if no fileKey needed)
                    <iframe
                      src={tokenizedUrl}
                      style={{ width: "100%", height: "100%", border: "none" } as any}
                      title={material.title}
                      onLoad={() => setLoading(false)}
                    />
                  ) : (
                    // Token not yet loaded — show spinner
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
                  // For video files — use <video> tag (iframes blocked by X-Frame-Options)
                  // For other files — use iframe
                  material?.file_type === "video" || fileUrl?.match(/\.(mp4|mov|webm|mkv|avi)(\?|$)/i) ? (
                    <video
                      src={fileUrl}
                      controls
                      autoPlay
                      playsInline
                      controlsList="nodownload noplaybackrate"
                      disablePictureInPicture
                      style={{ width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } as any}
                      onLoadedData={() => setLoading(false)}
                      onContextMenu={(e: any) => e.preventDefault()}
                    />
                  ) : (
                    <iframe
                      src={fileUrl}
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
                    : isPdf && tokenizedUrl
                      ? { uri: tokenizedUrl }
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
