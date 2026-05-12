/**
 * Grab one JPEG frame from a remote video URL (web only). Used for lecture list previews.
 * Requires the video response to allow cross-origin reads (CORS) for the app origin.
 */
export function captureVideoPosterWeb(videoSrc: string, maxWidth = 356): Promise<string> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return Promise.reject(new Error("captureVideoPosterWeb: document is not available"));
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = videoSrc;

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
    };

    let timeoutId = 0 as number | undefined;
    const fail = (msg: string) => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      timeoutId = undefined;
      finish(new Error(msg));
    };
    timeoutId = window.setTimeout(() => fail("video poster capture timed out"), 25000) as unknown as number;

    const onSeeked = () => {
      if (settled) return;
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) {
          fail("video dimensions not ready");
          return;
        }
        const scale = Math.min(1, maxWidth / w);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fail("no canvas context");
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
            timeoutId = undefined;
            if (!blob) {
              fail("canvas toBlob returned null");
              return;
            }
            try {
              const url = URL.createObjectURL(blob);
              finish();
              resolve(url);
            } catch (e) {
              finish(e instanceof Error ? e : new Error("createObjectURL failed"));
            }
          },
          "image/jpeg",
          0.82,
        );
      } catch (e) {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        timeoutId = undefined;
        const msg = e instanceof Error ? e.message : String(e);
        if (/taint|security/i.test(msg)) {
          fail("canvas tainted (CORS)");
        } else {
          finish(e instanceof Error ? e : new Error(msg));
        }
      }
    };

    video.onloadedmetadata = () => {
      try {
        const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        const t = dur > 0 ? Math.min(2, Math.max(0.05, dur * 0.03)) : 0.5;
        video.currentTime = t;
      } catch {
        fail("seek failed");
      }
    };

    video.onseeked = onSeeked;
    video.onerror = () => {
      fail("video element error");
    };
  });
}
