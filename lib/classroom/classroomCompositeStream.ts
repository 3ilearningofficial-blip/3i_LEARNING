import type { Editor } from "tldraw";
import { drawVideoWithChromaKey } from "./chromaKey";
import { createBoardFrameSource, type BoardFrameSource } from "./boardFrameSource";
import { COMPOSITE_WIDTH, COMPOSITE_HEIGHT } from "./slideConstants";
import { normalizePipPosition, type ClassroomPipPosition } from "./mediaDevices";

export { COMPOSITE_WIDTH, COMPOSITE_HEIGHT };

// PiP dimensions for non-green-screen mode (small corner overlay).
const PIP_WIDTH = Math.round(COMPOSITE_WIDTH * 0.22);
const PIP_HEIGHT = Math.round(PIP_WIDTH * (3 / 4)); // portrait 3:4 so full body shows
const PIP_MARGIN = 16;
const DEFAULT_FPS = 30;

// Green-screen teacher band height (fraction of board height) for recording composite.
const GS_TEACHER_BAND_FRAC = 0.45;

// Camera canvas dimensions when green screen is ON: full resolution for keying / raw publish.
const GS_CAM_WIDTH = COMPOSITE_WIDTH;
const GS_CAM_HEIGHT = COMPOSITE_HEIGHT;

export const CLASSROOM_SPLIT_STREAM = true;

/** Top-left corner of the PiP rectangle for the chosen corner. */
export function computePipOrigin(position: ClassroomPipPosition): { pipX: number; pipY: number } {
  const onLeft = position === "top-left" || position === "bottom-left";
  const onBottom = position === "bottom-right" || position === "bottom-left";
  const pipX = onLeft ? PIP_MARGIN : COMPOSITE_WIDTH - PIP_WIDTH - PIP_MARGIN;
  const pipY = onBottom ? COMPOSITE_HEIGHT - PIP_HEIGHT - PIP_MARGIN : PIP_MARGIN;
  return { pipX, pipY };
}

export type ClassroomStreamOptions = {
  editor?: Editor | null;
  boardEl: HTMLElement | null;
  cameraId?: string;
  greenScreen?: boolean;
  fps?: number;
  pipPosition?: ClassroomPipPosition;
};

export type BoardStreamHandle = {
  stream: MediaStream;
  stop: () => void;
};

export type CameraStreamHandle = {
  stream: MediaStream;
  previewEl: HTMLVideoElement;
  /** LiveKit publish track (raw camera when green screen so students can key locally). */
  livePublishTrack: MediaStreamTrack;
  stop: () => void;
};

export type ClassroomCompositeHandle = {
  /** Full board + PiP composite for recording / teacher preview */
  stream: MediaStream;
  previewEl: HTMLVideoElement;
  /** Resolves after the composite canvas has painted a usable first frame. */
  ready: Promise<void>;
  stop: () => void;
};

export type ClassroomPublishBundle = {
  board: BoardStreamHandle;
  camera: CameraStreamHandle;
  recording: ClassroomCompositeHandle;
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

function drawBoardLayer(outCtx: CanvasRenderingContext2D, frame: CanvasImageSource | null) {
  outCtx.fillStyle = "#0a0a0a";
  outCtx.fillRect(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);

  if (frame) {
    try {
      outCtx.drawImage(frame, 0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
    } catch {
      /* frame not yet decodable */
    }
  }
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || dw <= 0 || dh <= 0) return;
  const sourceAspect = sourceWidth / sourceHeight;
  const destAspect = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceAspect > destAspect) {
    sw = sourceHeight * destAspect;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / destAspect;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawCameraCover(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  drawImageCover(ctx, source, sourceWidth, sourceHeight, dx, dy, dw, dh);
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
  if (!greenScreen) {
    roundRect(outCtx, pipX, pipY, PIP_WIDTH, PIP_HEIGHT, 10);
    outCtx.clip();
  }
  if (greenScreen && chromaCanvas && chromaCtx) {
    drawVideoWithChromaKey(cameraVideo, chromaCanvas, chromaCtx);
    drawCameraCover(outCtx, chromaCanvas, pipX, pipY, PIP_WIDTH, PIP_HEIGHT);
  } else {
    drawCameraCover(outCtx, cameraVideo, pipX, pipY, PIP_WIDTH, PIP_HEIGHT);
  }
  outCtx.restore();
}

/** Green-screen recording: teacher keyed in the lower band (not full board). */
function drawFullBoardTeacherLayer(
  outCtx: CanvasRenderingContext2D,
  cameraVideo: HTMLVideoElement,
  chromaCanvas: HTMLCanvasElement,
  chromaCtx: CanvasRenderingContext2D
) {
  if (cameraVideo.readyState < 2) return;
  drawVideoWithChromaKey(cameraVideo, chromaCanvas, chromaCtx);
  const bandH = Math.round(COMPOSITE_HEIGHT * GS_TEACHER_BAND_FRAC);
  const bandY = COMPOSITE_HEIGHT - bandH;
  drawCameraCover(outCtx, chromaCanvas, 0, bandY, COMPOSITE_WIDTH, bandH);
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

function startBoardPaintLoop(
  outCtx: CanvasRenderingContext2D,
  frameSource: BoardFrameSource
): { stopRaf: () => void } {
  let raf = 0;
  const paint = () => {
    drawBoardLayer(outCtx, frameSource.getFrame());
    raf = requestAnimationFrame(paint);
  };
  paint();
  return {
    stopRaf: () => cancelAnimationFrame(raf),
  };
}

/**
 * True once the tldraw editor is mounted. Board content is rasterized via
 * `editor.toImage` (the board is SVG, not a canvas), so a live editor is all
 * that is required — there is no pixel canvas to wait on.
 */
export function isClassroomBoardCaptureReady(
  editor: Editor | null | undefined,
  _boardEl: HTMLElement | null | undefined
): boolean {
  return !!editor;
}

/** Open camera once; publish board + keyed camera + recording composite. */
export async function startClassroomPublishBundle(
  opts: ClassroomStreamOptions
): Promise<ClassroomPublishBundle> {
  const fps = opts.fps ?? DEFAULT_FPS;
  const cameraVideo = await openCameraVideo(opts.cameraId);
  const cameraStream = cameraVideo.srcObject as MediaStream;

  const boardFrame = createBoardFrameSource(opts.editor ?? null, opts.boardEl);
  const chromaCanvas = opts.greenScreen ? document.createElement("canvas") : null;
  const chromaCtx = chromaCanvas?.getContext("2d", { willReadFrequently: true }) ?? null;

  const boardCanvas = document.createElement("canvas");
  boardCanvas.width = COMPOSITE_WIDTH;
  boardCanvas.height = COMPOSITE_HEIGHT;
  const boardCtx = boardCanvas.getContext("2d");
  if (!boardCtx) throw new Error("Canvas not supported");
  const boardLoop = startBoardPaintLoop(boardCtx, boardFrame);
  const boardStream = boardCanvas.captureStream(fps);
  const boardTrack = boardStream.getVideoTracks()[0];
  if (!boardTrack) throw new Error("Could not create board video track");

  // When green screen is enabled, capture the camera at full board dimensions so
  // the teacher can stand / walk anywhere across the stage. The chroma key makes
  // the green background transparent; students receive a full-size RGBA stream
  // and only see the teacher's body overlaid on the board.
  const camW = opts.greenScreen ? GS_CAM_WIDTH : PIP_WIDTH;
  const camH = opts.greenScreen ? GS_CAM_HEIGHT : PIP_HEIGHT;

  const camCanvas = document.createElement("canvas");
  camCanvas.width = camW;
  camCanvas.height = camH;
  const camCtx = camCanvas.getContext("2d");
  if (!camCtx) throw new Error("Canvas not supported");
  let camRaf = 0;
  const camPaint = () => {
    camCtx.clearRect(0, 0, camW, camH);
    if (cameraVideo.readyState >= 2) {
      if (opts.greenScreen && chromaCanvas && chromaCtx) {
        drawVideoWithChromaKey(cameraVideo, chromaCanvas, chromaCtx);
        // Draw the keyed teacher image centered / cover-fitted in the full-board canvas.
        drawCameraCover(camCtx, chromaCanvas, 0, 0, camW, camH);
      } else {
        drawCameraCover(camCtx, cameraVideo, 0, 0, camW, camH);
      }
    }
    camRaf = requestAnimationFrame(camPaint);
  };
  camPaint();
  const camStream = camCanvas.captureStream(fps);
  const camTrack = camStream.getVideoTracks()[0];
  if (!camTrack) throw new Error("Could not create camera video track");
  const rawCamTrack = cameraStream.getVideoTracks()[0];
  const livePublishTrack =
    opts.greenScreen && rawCamTrack?.readyState === "live" ? rawCamTrack : camTrack;

  const camPreviewEl = document.createElement("video");
  camPreviewEl.muted = true;
  camPreviewEl.playsInline = true;
  camPreviewEl.style.objectFit = "cover";
  camPreviewEl.srcObject = camStream;
  void camPreviewEl.play().catch(() => {});

  const recCanvas = document.createElement("canvas");
  recCanvas.width = COMPOSITE_WIDTH;
  recCanvas.height = COMPOSITE_HEIGHT;
  const recCtx = recCanvas.getContext("2d");
  if (!recCtx) throw new Error("Canvas not supported");
  const { pipX, pipY } = computePipOrigin(normalizePipPosition(opts.pipPosition));
  let resolveRecordingReady: (() => void) | null = null;
  let hasResolvedRecordingReady = false;
  const recordingReady = new Promise<void>((resolve) => {
    resolveRecordingReady = resolve;
  });
  const tryResolveRecordingReady = () => {
    if (hasResolvedRecordingReady) return;
    if (!boardFrameIsReady || cameraVideo.readyState < 2) return;
    hasResolvedRecordingReady = true;
    resolveRecordingReady?.();
  };
  let boardFrameIsReady = false;
  void boardFrame.firstFrameReady
    .then(() => {
      boardFrameIsReady = true;
      tryResolveRecordingReady();
    })
    .catch(() => {
      boardFrameIsReady = true;
      tryResolveRecordingReady();
    });
  let recRaf = 0;
  const recPaint = () => {
    drawBoardLayer(recCtx, boardFrame.getFrame());
    if (opts.greenScreen && chromaCanvas && chromaCtx) {
      drawFullBoardTeacherLayer(recCtx, cameraVideo, chromaCanvas, chromaCtx);
    } else {
      drawPipLayer(recCtx, cameraVideo, false, null, null, pipX, pipY);
    }
    tryResolveRecordingReady();
    recRaf = requestAnimationFrame(recPaint);
  };
  const recStream = recCanvas.captureStream(fps);
  (recStream as MediaStream & { __classroomReady?: Promise<void> }).__classroomReady =
    recordingReady;
  const recTrack = recStream.getVideoTracks()[0];
  if (!recTrack) throw new Error("Could not create composite video track");
  recPaint();
  setTimeout(() => {
    if (!hasResolvedRecordingReady) {
      hasResolvedRecordingReady = true;
      resolveRecordingReady?.();
    }
  }, 2000);

  const recPreviewEl = document.createElement("video");
  recPreviewEl.muted = true;
  recPreviewEl.playsInline = true;
  recPreviewEl.style.objectFit = "contain";
  recPreviewEl.srcObject = recStream;
  void recPreviewEl.play().catch(() => {});

  const stop = () => {
    boardLoop.stopRaf();
    cancelAnimationFrame(camRaf);
    cancelAnimationFrame(recRaf);
    boardTrack.stop();
    camTrack.stop();
    recTrack.stop();
    boardFrame.stop();
    cameraStream?.getTracks().forEach((t) => t.stop());
    camPreviewEl.srcObject = null;
    recPreviewEl.srcObject = null;
  };

  return {
    board: { stream: boardStream, stop: () => boardTrack.stop() },
    camera: { stream: camStream, previewEl: camPreviewEl, livePublishTrack, stop: () => camTrack.stop() },
    recording: { stream: recStream, previewEl: recPreviewEl, ready: recordingReady, stop: () => recTrack.stop() },
    stop,
  };
}

/** Board-only canvas stream for LiveKit ScreenShare (students layout PiP in CSS). */
export async function startClassroomBoardStream(
  opts: ClassroomStreamOptions
): Promise<BoardStreamHandle> {
  const fps = opts.fps ?? DEFAULT_FPS;
  const boardFrame = createBoardFrameSource(opts.editor ?? null, opts.boardEl);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = COMPOSITE_WIDTH;
  outCanvas.height = COMPOSITE_HEIGHT;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas not supported");

  const boardLoop = startBoardPaintLoop(outCtx, boardFrame);
  const outputStream = outCanvas.captureStream(fps);
  const outputTrack = outputStream.getVideoTracks()[0];
  if (!outputTrack) throw new Error("Could not create board video track");

  const stop = () => {
    boardLoop.stopRaf();
    outputTrack.stop();
    boardFrame.stop();
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
  const chromaCtx = chromaCanvas?.getContext("2d", { willReadFrequently: true }) ?? null;

  // Green screen mode: full-board canvas so the teacher can move across the stage.
  const outW = opts.greenScreen ? GS_CAM_WIDTH : PIP_WIDTH;
  const outH = opts.greenScreen ? GS_CAM_HEIGHT : PIP_HEIGHT;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas not supported");

  let raf = 0;
  const paint = () => {
    outCtx.clearRect(0, 0, outW, outH);
    if (cameraVideo.readyState >= 2) {
      if (opts.greenScreen && chromaCanvas && chromaCtx) {
        drawVideoWithChromaKey(cameraVideo, chromaCanvas, chromaCtx);
        drawCameraCover(outCtx, chromaCanvas, 0, 0, outW, outH);
      } else {
        drawCameraCover(outCtx, cameraVideo, 0, 0, outW, outH);
      }
    }
    raf = requestAnimationFrame(paint);
  };
  paint();

  const outputStream = outCanvas.captureStream(fps);
  const outputTrack = outputStream.getVideoTracks()[0];
  if (!outputTrack) throw new Error("Could not create camera video track");
  const rawTrack = cameraVideo.srcObject as MediaStream;
  const rawCamTrack = rawTrack?.getVideoTracks()[0];
  const livePublishTrack =
    opts.greenScreen && rawCamTrack?.readyState === "live" ? rawCamTrack : outputTrack;

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

  return { stream: outputStream, previewEl, livePublishTrack, stop };
}

/** Full composite (board + top-right PiP) for session recording and teacher preview. */
export async function startClassroomRecordingComposite(
  opts: ClassroomStreamOptions
): Promise<ClassroomCompositeHandle> {
  const bundle = await startClassroomPublishBundle(opts);
  return {
    stream: bundle.recording.stream,
    previewEl: bundle.recording.previewEl,
    ready: bundle.recording.ready,
    stop: bundle.stop,
  };
}

/** @deprecated Use split board + camera streams when CLASSROOM_SPLIT_STREAM is enabled. */
export async function startClassroomCompositeStream(
  opts: ClassroomStreamOptions & { boardEl: HTMLElement }
): Promise<ClassroomCompositeHandle> {
  return startClassroomRecordingComposite(opts);
}
