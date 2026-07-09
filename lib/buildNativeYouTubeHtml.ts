/** Shared native (RN WebView) YouTube players — IFrame API + origin-aware fallback. */

export const YT_EMBED_ORIGIN = "https://3ilearning.in";

export type NativeYouTubeHtmlOpts = {
  /** Resume / start seconds (lecture progress). */
  startAt?: number;
  /** Clip end seconds (live-class completed recording). */
  endAt?: number;
  /** Tighter masks for narrow phone layouts. */
  phoneWeb?: boolean;
};

/**
 * Primary native player: YouTube IFrame API with custom controls and branding masks.
 * More reliable in RN WebView than a nested youtube-nocookie iframe.
 */
export function buildNativeYouTubeHtml(videoId: string, opts: NativeYouTubeHtmlOpts = {}): string {
  const startAt = opts.startAt && opts.startAt > 5 ? Math.max(0, Math.floor(opts.startAt - 2)) : 0;
  const endAt = opts.endAt && opts.endAt > 0 ? Math.floor(opts.endAt) : null;
  const phoneWeb = opts.phoneWeb === true;
  const topGap = phoneWeb ? 40 : 52;
  const bottomGap = phoneWeb ? 58 : 72;
  const topMaskHeight = phoneWeb ? 40 : 52;
  const bottomMaskLeftWidth = phoneWeb ? 70 : 120;
  const bottomMaskRightWidth = phoneWeb ? 190 : 230;
  const startVar = startAt > 0 ? `start:${startAt},` : "";
  const endVar = endAt ? `end:${endAt},` : "";

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
function onYouTubeIframeAPIReady(){p=new YT.Player('player',{videoId:'${videoId}',playerVars:{autoplay:1,mute:1,controls:0,modestbranding:1,rel:0,showinfo:0,iv_load_policy:3,cc_load_policy:0,playsinline:1,disablekb:1,fs:0,${startVar}${endVar}},events:{onReady:function(e){rdy=1;e.target.playVideo();up();sc();},onStateChange:function(e){var s=e.data;document.getElementById('ld').style.display=s===3?'block':'none';document.getElementById('bp').className=(s===1||s===3)?'bp h':'bp';upi();}}});}
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

/**
 * Fallback when IFrame API fails: simple embed iframe with explicit origin
 * (avoids blank/black WebView embeds without referrer context).
 */
export function buildNativeYouTubeFallbackHtml(
  videoId: string,
  opts: NativeYouTubeHtmlOpts = {}
): string {
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
  if (opts.startAt && opts.startAt > 5) {
    q.set("start", String(Math.max(0, Math.floor(opts.startAt - 2))));
  }
  if (opts.endAt && opts.endAt > 0) {
    q.set("end", String(Math.max(1, Math.floor(opts.endAt))));
  }
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden}.w{position:relative;width:100%;height:100%}iframe{position:absolute;inset:0;width:100%;height:100%;border:none}</style>
</head><body><div class="w">
<iframe src="https://www.youtube.com/embed/${videoId}?${q.toString()}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"></iframe>
</div><script>document.addEventListener('contextmenu',function(e){e.preventDefault();});</script></body></html>`;
}
