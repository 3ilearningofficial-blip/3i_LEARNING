/**
 * iframe[srcDoc] for phone-web YouTube: branding masks plus "shell fullscreen".
 * Native YouTube fullscreen often targets only the embed iframe so our masks disappear;
 * fs=0 + requestFullscreen(.wrapper) keeps black bars visible in fullscreen on Android Chrome.
 */

export type BuildYouTubePhoneWebSrcDocOpts = {
  videoId: string;
  /** Query string without "?" (e.g. autoplay=1&mute=1&…) — fs is forced to 0 here. */
  embedQueryWithoutFs: string;
};

export function buildYouTubePhoneWebSrcDoc(opts: BuildYouTubePhoneWebSrcDocOpts): string {
  const { videoId, embedQueryWithoutFs } = opts;
  const q = new URLSearchParams(embedQueryWithoutFs);
  q.set("fs", "0");
  const iq = q.toString();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="referrer" content="no-referrer-when-downgrade">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; -webkit-user-select: none; user-select: none; }
.wrapper { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; }
.cover-tl { position: absolute; top: 0; left: 0; width: clamp(120px, 28vw, 25%); height: clamp(48px, 12vmin, 56px); background: #000; z-index: 9999; pointer-events: auto; }
.cover-tr { position: absolute; top: 0; right: 0; width: clamp(100px, 28vw, 130px); height: clamp(48px, 12vmin, 56px); background: #000; z-index: 9999; pointer-events: auto; }
.cover-bl { position: absolute; bottom: 0; left: 0; width: clamp(56px, 18vw, 70px); height: clamp(52px, 14vmin, 60px); background: #000; z-index: 9999; pointer-events: auto; }
.cover-br { position: absolute; bottom: 0; right: clamp(40px, 14vw, 50px); width: min(280px, 72vw); height: clamp(52px, 14vmin, 60px); background: #000; z-index: 9999; pointer-events: auto; }
@media (max-width: 600px) {
  .cover-tl { width: clamp(48%, 55vw, 62%); height: clamp(48px, 12vmin, 53px); }
  .cover-tr { display: none; }
  .cover-br { width: 100%; right: 0; }
}
.fs-bar-top {
  position: absolute; top: 0; left: 0; right: 0; pointer-events: none;
  background: #000; z-index: 10001; opacity: 0; transition: opacity 0.2s ease;
  height: clamp(52px, 15vmin, 92px);
}
.fs-bar-bottom {
  position: absolute; bottom: 0; left: 0; right: 0; pointer-events: none;
  background: #000; z-index: 10001; opacity: 0; transition: opacity 0.2s ease;
  height: clamp(60px, 20vmin, 110px);
}
.wrapper:fullscreen .fs-bar-top, .wrapper:fullscreen .fs-bar-bottom,
.wrapper:-webkit-full-screen .fs-bar-top, .wrapper:-webkit-full-screen .fs-bar-bottom {
  opacity: 1;
}
.fs-btn-wrap {
  position: absolute;
  bottom: max(10px, env(safe-area-inset-bottom, 0px));
  right: max(10px, env(safe-area-inset-right, 0px));
  z-index: 10004;
}
.fs-btn {
  width: 44px; height: 44px; border-radius: 22px; border: none;
  background: rgba(0,0,0,0.72); color: #fff;
  font-size: 22px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
.wrapper:fullscreen .fs-btn-wrap, .wrapper:-webkit-full-screen .fs-btn-wrap { display: none; }
@media print { body { display: none !important; } }
</style>
</head>
<body>
<div class="wrapper" id="pw">
<div class="fs-bar-top"></div>
<div class="fs-bar-bottom"></div>
<div class="cover-tl"></div>
<div class="cover-tr"></div>
<iframe
  title="video"
  src="https://www.youtube-nocookie.com/embed/${videoId}?${iq}"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
></iframe>
<div class="cover-bl"></div>
<div class="cover-br"></div>
<div class="fs-btn-wrap">
  <button type="button" class="fs-btn" id="fsb" aria-label="Full screen">⛶</button>
</div>
</div>
<script>
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
(function(){
  var w = document.getElementById('pw');
  var b = document.getElementById('fsb');
  if (!w || !b) return;
  function goFs(el) {
    var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.msRequestFullscreen;
    if (!fn) return;
    var p = fn.call(el);
    if (p && p.catch) p.catch(function(){});
  }
  b.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    goFs(w);
  });
})();
</script>
</body>
</html>`;
}
