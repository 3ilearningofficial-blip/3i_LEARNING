/**
 * Injectable script for inline video player HTML (WebView / iframe srcDoc).
 * Locks landscape on fullscreen enter and restores portrait on exit.
 */
export function fullscreenLandscapeScript(): string {
  return `
(function(){
  function fsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || null;
  }
  function postFs(active) {
    try {
      var msg = JSON.stringify({ event: 'fullscreen', active: !!active });
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
      if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
    } catch (_) {}
  }
  function lockLandscape() {
    try {
      var o = screen.orientation;
      if (o && o.lock) {
        var p = o.lock('landscape-primary');
        if (p && p.catch) p.catch(function() { o.lock('landscape').catch(function(){}); });
      }
    } catch (_) {}
    postFs(true);
  }
  function unlockPortrait() {
    try {
      var o = screen.orientation;
      if (o && o.lock) o.lock('portrait-primary').catch(function(){});
    } catch (_) {}
    postFs(false);
  }
  function onFsChange() {
    if (fsEl()) lockLandscape();
    else unlockPortrait();
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
})();
`;
}

/** Inline IIFE to run after manual requestFullscreen (phone-web YouTube shell). */
export function lockLandscapeAfterFullscreenScript(): string {
  return `
(function(){
  try {
    var o = screen.orientation;
    if (o && o.lock) {
      var p = o.lock('landscape-primary');
      if (p && p.catch) p.catch(function(){ o.lock('landscape').catch(function(){}); });
    }
  } catch (_) {}
  try {
    var msg = JSON.stringify({ event: 'fullscreen', active: true });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
  } catch (_) {}
})();
`;
}
