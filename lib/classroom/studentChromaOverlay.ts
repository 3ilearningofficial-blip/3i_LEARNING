import { drawVideoWithChromaKey } from "./chromaKey";

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  dw: number,
  dh: number
) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || dw <= 0 || dh <= 0) return;
  const sourceAspect = sourceWidth / sourceHeight;
  const destAspect = dw / dh;
  let drawW = dw;
  let drawH = dh;
  let dx = 0;
  let dy = 0;
  if (sourceAspect > destAspect) {
    drawH = dw / sourceAspect;
    dy = (dh - drawH) / 2;
  } else {
    drawW = dh * sourceAspect;
    dx = (dw - drawW) / 2;
  }
  ctx.drawImage(source, dx, dy, drawW, drawH);
}

/**
 * Student-side chroma key: incoming LiveKit camera still has the physical green
 * backdrop (teacher publishes raw camera when green screen is on). Paint keyed
 * frames to a canvas so alpha is preserved over the board video.
 */
export function startStudentChromaOverlay(
  sourceVideo: HTMLVideoElement,
  displayCanvas: HTMLCanvasElement,
  opts?: { fullOverlay?: boolean }
): () => void {
  const chromaCanvas = document.createElement("canvas");
  const chromaCtx = chromaCanvas.getContext("2d", { willReadFrequently: true });
  const outCtx = displayCanvas.getContext("2d", { alpha: true });
  if (!chromaCtx || !outCtx) return () => {};

  let raf = 0;
  const paint = () => {
    if (sourceVideo.readyState >= 2 && sourceVideo.videoWidth > 0) {
      const vw = sourceVideo.videoWidth;
      const vh = sourceVideo.videoHeight;
      const cw = displayCanvas.clientWidth || vw;
      const ch = displayCanvas.clientHeight || vh;
      if (displayCanvas.width !== Math.round(cw)) displayCanvas.width = Math.round(cw);
      if (displayCanvas.height !== Math.round(ch)) displayCanvas.height = Math.round(ch);

      drawVideoWithChromaKey(sourceVideo, chromaCanvas, chromaCtx);
      outCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      if (opts?.fullOverlay) {
        drawImageContain(outCtx, chromaCanvas, chromaCanvas.width, chromaCanvas.height, cw, ch);
      } else {
        outCtx.drawImage(chromaCanvas, 0, 0, cw, ch);
      }
    }
    raf = requestAnimationFrame(paint);
  };
  paint();
  return () => cancelAnimationFrame(raf);
}
