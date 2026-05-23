import type { Editor } from "tldraw";
import { drawVideoWithChromaKey } from "./chromaKey";
import { resolveBoardCaptureElement } from "./resolveBoardCaptureElement";
import { COMPOSITE_WIDTH, COMPOSITE_HEIGHT } from "./slideConstants";

export { COMPOSITE_WIDTH, COMPOSITE_HEIGHT };

const PIP_WIDTH = Math.round(COMPOSITE_WIDTH * 0.16);
const PIP_HEIGHT = Math.round(PIP_WIDTH * (4 / 3));
const PIP_MARGIN = 16;
const DEFAULT_FPS = 30;

export const CLASSROOM_SPLIT_STREAM = true;

export type ClassroomStreamOptions = {
  editor?: Editor | null;
  boardEl: HTMLElement | null;
  cameraId?: string;
  greenScreen?: boolean;
  fps?: number;
};

export type BoardStreamHandle = {
  stream: MediaStream;
  stop: () => void;
};

export type CameraStreamHandle = {
  stream: MediaStream;
  previewEl: HTMLVideoElement;
  stop: () => void;
};

export type ClassroomCompositeHandle = {
  /** Full board + PiP composite for recording / teacher preview */
  stream: MediaStream;
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

function drawBoardLayer(
  outCtx: CanvasRenderingContext2D,
  captureEl: HTMLElement | null,
  boardVideo: HTMLVideoElement | null
) {
  outCtx.fillStyle = "#0a0a0a";
  outCtx.fillRect(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);

  if (boardVideo && boardVideo.readyState >= 2) {
    outCtx.drawImage(boardVideo, 0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
    return;
  }

  if (captureEl instanceof HTMLCanvasElement && captureEl.width > 0 && captureEl.height > 0) {
    outCtx.drawImage(captureEl, 0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
    return;
  }

  if (captureEl) {
    try {
      const rect = captureEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        outCtx.drawImage(captureEl as unknown as CanvasImageSource, 0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
      }
    } catch {
      /* cross-origin or unsupported */
    }
  }
}

function drawPipLayer(
  outCtx: CanvasRenderingContext2D,
  cameraVideo: HTMLVideoElement,
  greenScreen: boolean,
  chromaCanvas: HTMLCanvasElement | null,
  chromaCtx: CanvasRenderingContext2D | null,
  pipX: number,
  pipY: number
) {
  if (cameraVideo.readyState < 2) return;
  outCtx.save();
  roundRect(outCtx, pipX, pipY, PIP_WIDTH, PIP_HEIGHT, 10);
  outCtx.clip();
  if (greenScreen && chromaCanvas && chromaCtx) {
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

async function openCameraVideo(cameraId?: string): Promise<HTMLVideoElement> {
  const cameraStream = await navigator.mediaDevices.getUserMedia({
    video: cameraId ? { deviceId: { exact: cameraId } } : true,
    audio: false,
  });
  const cameraVideo = document.createElement("video");
  cameraVideo.srcObject = cameraStream;
  cameraVideo.muted = true;
  cameraVideo.playsInline = true;
  await cameraVideo.play();
  return cameraVideo;
}

/** Board-only canvas stream for LiveKit ScreenShare (students layout PiP in CSS). */
export async function startClassroomBoardStream(
  opts: ClassroomStreamOptions
): Promise<BoardStreamHandle> {
  const fps = opts.fps ?? DEFAULT_FPS;
  const captureEl = resolveBoardCaptureElement(opts.editor, opts.boardEl);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = COMPOSITE_WIDTH;
  outCanvas.height = COMPOSITE_HEIGHT;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas not supported");

  let boardVideo: HTMLVideoElement | null = null;
  let boardCapture: MediaStream | null = null;

  if (
    captureEl &&
    typeof (captureEl as HTMLElement & { captureStream?: (f?: number) => MediaStream }).captureStream ===
      "function"
  ) {
    try {
      boardCapture = (
        captureEl as HTMLElement & { captureStream: (f?: number) => MediaStream }
      ).captureStream(fps);
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

  let raf = 0;
  const paint = () => {
    drawBoardLayer(outCtx, captureEl, boardVideo);
    raf = requestAnimationFrame(paint);
  };
  paint();

  const outputStream = outCanvas.captureStream(fps);
  const outputTrack = outputStream.getVideoTracks()[0];
  if (!outputTrack) throw new Error("Could not create board video track");

  const stop = () => {
    cancelAnimationFrame(raf);
    outputTrack.stop();
    boardCapture?.getTracks().forEach((t) => t.stop());
    if (boardVideo) boardVideo.srcObject = null;
  };

  return { stream: outputStream, stop };
}

/** Keyed (optional) camera stream for LiveKit Camera track. */
export async function startClassroomCameraStream(opts: {
  cameraId?: string;
  greenScreen?: boolean;
  fps?: number;
}): Promise<CameraStreamHandle> {
  const fps = opts.fps ?? DEFAULT_FPS;
  const cameraVideo = await openCameraVideo(opts.cameraId);

  const chromaCanvas = opts.greenScreen ? document.createElement("canvas") : null;
  const chromaCtx = chromaCanvas?.getContext("2d") ?? null;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = PIP_WIDTH;
  outCanvas.height = PIP_HEIGHT;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas not supported");

  let raf = 0;
  const paint = () => {
    outCtx.clearRect(0, 0, PIP_WIDTH, PIP_HEIGHT);
    if (cameraVideo.readyState >= 2) {
      if (opts.greenScreen && chromaCanvas && chromaCtx) {
        drawVideoWithChromaKey(cameraVideo, chromaCanvas, chromaCtx);
        outCtx.drawImage(chromaCanvas, 0, 0, PIP_WIDTH, PIP_HEIGHT);
      } else {
        outCtx.drawImage(cameraVideo, 0, 0, PIP_WIDTH, PIP_HEIGHT);
      }
    }
    raf = requestAnimationFrame(paint);
  };
  paint();

  const outputStream = outCanvas.captureStream(fps);
  const outputTrack = outputStream.getVideoTracks()[0];
  if (!outputTrack) throw new Error("Could not create camera video track");

  const previewEl = document.createElement("video");
  previewEl.muted = true;
  previewEl.playsInline = true;
  previewEl.style.objectFit = "cover";
  previewEl.srcObject = outputStream;
  void previewEl.play().catch(() => {});

  const cameraStream = cameraVideo.srcObject as MediaStream;

  const stop = () => {
    cancelAnimationFrame(raf);
    outputTrack.stop();
    cameraStream?.getTracks().forEach((t) => t.stop());
    previewEl.srcObject = null;
  };

  return { stream: outputStream, previewEl, stop };
}

/** Full composite (board + top-right PiP) for session recording and teacher preview. */
export async function startClassroomRecordingComposite(
  opts: ClassroomStreamOptions
): Promise<ClassroomCompositeHandle> {
  const fps = opts.fps ?? DEFAULT_FPS;
  const captureEl = resolveBoardCaptureElement(opts.editor, opts.boardEl);
  const cameraVideo = await openCameraVideo(opts.cameraId);

  const previewEl = document.createElement("video");
  previewEl.muted = true;
  previewEl.playsInline = true;
  previewEl.style.objectFit = "contain";

  const outCanvas = document.createElement("canvas");
  outCanvas.width = COMPOSITE_WIDTH;
  outCanvas.height = COMPOSITE_HEIGHT;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas not supported");

  let boardVideo: HTMLVideoElement | null = null;
  let boardCapture: MediaStream | null = null;

  if (
    captureEl &&
    typeof (captureEl as HTMLElement & { captureStream?: (f?: number) => MediaStream }).captureStream ===
      "function"
  ) {
    try {
      boardCapture = (
        captureEl as HTMLElement & { captureStream: (f?: number) => MediaStream }
      ).captureStream(fps);
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
    drawBoardLayer(outCtx, captureEl, boardVideo);
    drawPipLayer(
      outCtx,
      cameraVideo,
      !!opts.greenScreen,
      chromaCanvas,
      chromaCtx,
      pipX,
      pipY
    );
    raf = requestAnimationFrame(paint);
  };
  paint();

  const outputStream = outCanvas.captureStream(fps);
  const outputTrack = outputStream.getVideoTracks()[0];
  if (!outputTrack) throw new Error("Could not create composite video track");

  previewEl.srcObject = outputStream;
  void previewEl.play().catch(() => {});

  const cameraStream = cameraVideo.srcObject as MediaStream;

  const stop = () => {
    cancelAnimationFrame(raf);
    outputTrack.stop();
    cameraStream?.getTracks().forEach((t) => t.stop());
    boardCapture?.getTracks().forEach((t) => t.stop());
    if (boardVideo) boardVideo.srcObject = null;
    previewEl.srcObject = null;
  };

  return { stream: outputStream, previewEl, stop };
}

/** @deprecated Use split board + camera streams when CLASSROOM_SPLIT_STREAM is enabled. */
export async function startClassroomCompositeStream(
  opts: ClassroomStreamOptions & { boardEl: HTMLElement }
): Promise<ClassroomCompositeHandle> {
  return startClassroomRecordingComposite(opts);
}
