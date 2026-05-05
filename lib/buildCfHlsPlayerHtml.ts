/**
 * Shared HLS player HTML for WebView / iframe (lectures + live Cloudflare HLS).
 * Optional live-stream tuning + quality picker when hls.js exposes multiple levels.
 */
export type CfHlsPlayerOptions = {
  liveStream?: boolean;
};

export function buildCfHlsPlayerHtml(hlsUrl: string, opts?: CfHlsPlayerOptions): string {
  const live = !!opts?.liveStream;
  const safeUrl = JSON.stringify(hlsUrl);
  if (live) {
    return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
video { width: 100%; height: 100%; object-fit: contain; background: #000; }
#overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0a0a0a; color: #fff; font-family: sans-serif; gap: 12px; }
#overlay.hidden { display: none; }
.spinner { width: 36px; height: 36px; border: 3px solid #333; border-top-color: #F6821F; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.msg { font-size: 13px; color: #aaa; text-align: center; }
#qwrap { position: absolute; bottom: 10px; left: 10px; z-index: 50; font-family: system-ui, sans-serif; display: flex; gap: 8px; }
#qsel { font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.35); background: rgba(0,0,0,0.65); color: #fff; max-width: 160px; }
#ssel { font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.35); background: rgba(0,0,0,0.65); color: #fff; max-width: 120px; }
</style>
</head>
<body>
<div id="qwrap">
  <select id="qsel" aria-label="Quality"></select>
  <select id="ssel" aria-label="Speed">
    <option value="0.5">0.5x</option>
    <option value="0.75">0.75x</option>
    <option value="1" selected>1x</option>
    <option value="1.25">1.25x</option>
    <option value="1.5">1.5x</option>
    <option value="1.75">1.75x</option>
    <option value="2">2x</option>
  </select>
</div>
<video id="v" autoplay controls playsinline controlsList="nodownload noremoteplayback nopictureinpicture" disablePictureInPicture disableRemotePlayback x-webkit-airplay="deny"></video>
<div id="overlay"><div class="spinner"></div><div class="msg" id="msg">Connecting to live stream...</div></div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js"></script>
<script>
var video = document.getElementById('v');
var overlay = document.getElementById('overlay');
var msg = document.getElementById('msg');
var hlsUrl = ${safeUrl};
var qsel = document.getElementById('qsel');
var ssel = document.getElementById('ssel');
var retryCount = 0;
var hlsRef = null;
function showLive() {
  overlay.classList.add('hidden');
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'play' }));
}
function fillQuality(hls) {
  hlsRef = hls;
  if (!qsel || !hls || !hls.levels || hls.levels.length <= 1) {
    if (qsel && qsel.parentNode) qsel.parentNode.style.display = 'none';
    return;
  }
  qsel.innerHTML = '';
  var auto = document.createElement('option');
  auto.value = '-1';
  auto.textContent = 'Auto';
  qsel.appendChild(auto);
  for (var i = 0; i < hls.levels.length; i++) {
    var lv = hls.levels[i];
    var label = lv.height ? (lv.height + 'p') : (lv.bitrate ? Math.round(lv.bitrate / 1000) + ' kbps' : 'Level ' + (i + 1));
    var opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = label;
    qsel.appendChild(opt);
  }
  qsel.value = '-1';
  qsel.onchange = function() {
    var v = parseInt(qsel.value, 10);
    if (hlsRef) hlsRef.currentLevel = isNaN(v) ? -1 : v;
  };
}
if (ssel) {
  ssel.onchange = function() {
    var r = parseFloat(ssel.value || '1');
    video.playbackRate = isNaN(r) ? 1 : r;
  };
}
function tryLoad() {
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    var hls = new Hls({ liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 6, enableWorker: true });
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      fillQuality(hls);
      video.muted = true;
      video.play().then(showLive).catch(function() { video.play().then(showLive).catch(showLive); });
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, function() {
      if (qsel && hls.currentLevel >= 0) qsel.value = String(hls.currentLevel);
    });
    hls.on(Hls.Events.ERROR, function(e, d) {
      if (d.fatal) { retryCount++; msg.textContent = 'Connecting... (' + retryCount + ')'; setTimeout(tryLoad, 5000); }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    if (qsel && qsel.parentNode) qsel.parentNode.style.display = 'none';
    video.muted = true;
    video.src = hlsUrl;
    video.addEventListener('loadedmetadata', function once() {
      video.removeEventListener('loadedmetadata', once);
      video.play().then(showLive).catch(function() { showLive(); });
    });
    video.addEventListener('error', function() { setTimeout(tryLoad, 5000); });
  }
}
tryLoad();
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
</script>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
video { width: 100%; height: 100%; object-fit: contain; background: #000; }
#qwrap { position: absolute; bottom: 10px; left: 10px; z-index: 50; font-family: system-ui, sans-serif; display: flex; gap: 8px; }
#qsel { font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.35); background: rgba(0,0,0,0.65); color: #fff; max-width: 160px; }
#ssel { font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.35); background: rgba(0,0,0,0.65); color: #fff; max-width: 120px; }
</style>
</head>
<body>
<div id="qwrap">
  <select id="qsel" aria-label="Quality"></select>
  <select id="ssel" aria-label="Speed">
    <option value="0.5">0.5x</option>
    <option value="0.75">0.75x</option>
    <option value="1" selected>1x</option>
    <option value="1.25">1.25x</option>
    <option value="1.5">1.5x</option>
    <option value="1.75">1.75x</option>
    <option value="2">2x</option>
  </select>
</div>
<video id="v" autoplay controls playsinline controlsList="nodownload noremoteplayback nopictureinpicture" disablePictureInPicture disableRemotePlayback x-webkit-airplay="deny"></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js"></script>
<script>
var video = document.getElementById('v');
var hlsUrl = ${safeUrl};
var qsel = document.getElementById('qsel');
var ssel = document.getElementById('ssel');
var hlsRef = null;
if (ssel) {
  ssel.onchange = function() {
    var r = parseFloat(ssel.value || '1');
    video.playbackRate = isNaN(r) ? 1 : r;
  };
}
function fillQuality(hls) {
  hlsRef = hls;
  if (!qsel || !hls || !hls.levels || hls.levels.length <= 1) {
    if (qsel && qsel.parentNode) qsel.parentNode.style.display = 'none';
    return;
  }
  qsel.innerHTML = '';
  var auto = document.createElement('option');
  auto.value = '-1';
  auto.textContent = 'Auto';
  qsel.appendChild(auto);
  for (var i = 0; i < hls.levels.length; i++) {
    var lv = hls.levels[i];
    var label = lv.height ? (lv.height + 'p') : (lv.bitrate ? Math.round(lv.bitrate / 1000) + ' kbps' : 'Level ' + (i + 1));
    var opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = label;
    qsel.appendChild(opt);
  }
  qsel.value = '-1';
  qsel.onchange = function() {
    var v = parseInt(qsel.value, 10);
    if (hlsRef) hlsRef.currentLevel = isNaN(v) ? -1 : v;
  };
}
function tryLoad() {
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    var hls = new Hls({ enableWorker: true });
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      fillQuality(hls);
      video.muted = true;
      video.play().catch(function() {});
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'play' }));
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, function() {
      if (qsel && hls.currentLevel >= 0) qsel.value = String(hls.currentLevel);
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    if (qsel && qsel.parentNode) qsel.parentNode.style.display = 'none';
    video.src = hlsUrl;
    video.addEventListener('loadedmetadata', function once() {
      video.removeEventListener('loadedmetadata', once);
      video.muted = true;
      video.play().catch(function() {});
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'play' }));
    });
  }
}
tryLoad();
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
</script>
</body>
</html>`;
}
