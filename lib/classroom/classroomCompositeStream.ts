import { drawVideoWithChromaKey } from "./chromaKey";

export const COMPOSITE_WIDTH = 1280;
export const COMPOSITE_HEIGHT = 720;
const PIP_WIDTH = 200;
const PIP_HEIGHT = 266;
const PIP_MARGIN = 16;
const DEFAULT_FPS = 30;

export type ClassroomCompositeOptions = {
  boardEl: HTMLElement;
  cameraId?: string;
  greenScreen?: boolean;
  fps?: number;
};

export type ClassroomCompositeHandle = {
  /** Video + no audio — mic stays on LiveKit separately */
  stream: MediaStream;
  /** Hidden element feeding the PiP layer (for teacher sidebar preview) */
  previewEl: HTMLVideoElement;
  stop: () => void;
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Board + teacher PiP composite for LiveKit publish and session recording. */
export async function startClassroomCompositeStream(
  opts: ClassroomCompositeOptions
): Promise<ClassroomCompositeHandle> {
  const fps = opts.fps ?? DEFAULT_FPS;
  const boardEl = opts.boardEl;

  const cameraStream = await navigator.mediaDevices.getUserMedia({
    video: opts.cameraId ? { deviceId: { exact: opts.cameraId } } : true,
    audio: false,
  });

  const cameraVideo = document.createElement("video");
  cameraVideo.srcObject = cameraStream;
  cameraVideo.muted = true;
  cameraVideo.playsInline = true;
  await cameraVideo.play();

  const previewEl = document.createElement("video");
  previewEl.muted = true;
  previewEl.playsInline = true;
  previewEl.style.objectFit = "cover";

  const outCanvas = document.createElement("canvas");
  outCanvas.width = COMPOSITE_WIDTH;
  outCanvas.height = COMPOSITE_HEIGHT;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas not supported");

  let boardVideo: HTMLVideoElement | null = null;
  let boardCapture: MediaStream | null = null;

  if (typeof (boardEl as HTMLElement & { captureStream?: (f?: number) => MediaStream }).captureStream === "function") {
    try {
      boardCapture = (boardEl as HTMLElement & { captureStream: (f?: number) => MediaStream }).captureStream(fps);
      const vt = boardCapture.getVideoTracks()[0];
      if (vt) {
        boardVideo = document.createElement("video");
        boardVideo.srcObject = boardCapture;
        boardVideo.muted = true;
        boardVideo.playsInline = true;
        await boardVideo.play();
      }
    } catch {
      boardCapture = null;
    }
  }

  const chromaCanvas = opts.greenScreen ? document.createElement("canvas") : null;
  const chromaCtx = chromaCanvas?.getContext("2d") ?? null;

  const pipX = COMPOSITE_WIDTH - PIP_WIDTH - PIP_MARGIN;
  const pipY = PIP_MARGIN;

  let raf = 0;
  const paint = () => {
    outCtx.fillStyle = "#0a0a0a";
    outCtx.fillRect(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);

    if (boardVideo && boardVideo.readyState >= 2) {
      outCtx.drawImage(boardVideo, 0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
    } else {
      try {
        const rect = boardEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          outCtx.drawImage(boardEl as unknown as CanvasImageSource, 0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
        }
      } catch {
        /* drawImage on HTMLElement may fail cross-origin — board stays black */
      }
    }

    if (cameraVideo.readyState >= 2) {
      outCtx.save();
      roundRect(outCtx, pipX, pipY, PIP_WIDTH, PIP_HEIGHT, 10);
      outCtx.clip();
      if (opts.greenScreen && chromaCanvas && chromaCtx) {
        drawVideoWithChromaKey(cameraVideo, chromaCanvas, chromaCtx);
        outCtx.drawImage(chromaCanvas, pipX, pipY, PIP_WIDTH, PIP_HEIGHT);
      } else {
        outCtx.drawImage(cameraVideo, pipX, pipY, PIP_WIDTH, PIP_HEIGHT);
      }
      outCtx.restore();
      outCtx.strokeStyle = "rgba(255,255,255,0.25)";
      outCtx.lineWidth = 2;
      roundRect(outCtx, pipX, pipY, PIP_WIDTH, PIP_HEIGHT, 10);
      outCtx.stroke();
    }

    raf = requestAnimationFrame(paint);
  };
  paint();

  const outputStream = outCanvas.captureStream(fps);
  const outputTrack = outputStream.getVideoTracks()[0];
  if (!outputTrack) throw new Error("Could not create composite video track");

  previewEl.srcObject = outputStream;
  void previewEl.play().catch(() => {});

  const stop = () => {
    cancelAnimationFrame(raf);
    outputTrack.stop();
    cameraStream.getTracks().forEach((t) => t.stop());
    boardCapture?.getTracks().forEach((t) => t.stop());
    if (boardVideo) boardVideo.srcObject = null;
    previewEl.srcObject = null;
  };

  return {
    stream: outputStream,
    previewEl,
    stop,
  };
}
