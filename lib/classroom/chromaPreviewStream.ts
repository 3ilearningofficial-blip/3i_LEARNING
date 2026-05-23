import { drawVideoWithChromaKey } from "./chromaKey";

/** Preview camera with optional green-screen keying (setup sidebar). */
export function attachChromaPreviewToVideo(
  sourceStream: MediaStream,
  videoEl: HTMLVideoElement,
  greenScreen: boolean
): () => void {
  const sourceVideo = document.createElement("video");
  sourceVideo.srcObject = sourceStream;
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  void sourceVideo.play().catch(() => {});

  if (!greenScreen) {
    videoEl.srcObject = sourceStream;
    void videoEl.play().catch(() => {});
    return () => {
      videoEl.srcObject = null;
      sourceVideo.srcObject = null;
    };
  }

  const chromaCanvas = document.createElement("canvas");
  const chromaCtx = chromaCanvas.getContext("2d");
  const outCanvas = document.createElement("canvas");
  const outCtx = outCanvas.getContext("2d");
  if (!chromaCtx || !outCtx) {
    videoEl.srcObject = sourceStream;
    return () => {
      videoEl.srcObject = null;
      sourceVideo.srcObject = null;
    };
  }

  let raf = 0;
  const paint = () => {
    if (sourceVideo.readyState >= 2) {
      const w = sourceVideo.videoWidth || 640;
      const h = sourceVideo.videoHeight || 480;
      if (chromaCanvas.width !== w) chromaCanvas.width = w;
      if (chromaCanvas.height !== h) chromaCanvas.height = h;
      if (outCanvas.width !== w) outCanvas.width = w;
      if (outCanvas.height !== h) outCanvas.height = h;
      drawVideoWithChromaKey(sourceVideo, chromaCanvas, chromaCtx);
      outCtx.clearRect(0, 0, w, h);
      outCtx.drawImage(chromaCanvas, 0, 0, w, h);
    }
    raf = requestAnimationFrame(paint);
  };
  paint();

  const outStream = outCanvas.captureStream(30);
  videoEl.srcObject = outStream;
  void videoEl.play().catch(() => {});

  return () => {
    cancelAnimationFrame(raf);
    outStream.getTracks().forEach((t) => t.stop());
    videoEl.srcObject = null;
    sourceVideo.srcObject = null;
  };
}
