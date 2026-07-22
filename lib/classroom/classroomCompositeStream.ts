import type { Editor } from "tldraw";
import { drawVideoWithChromaKey } from "./chromaKey";
import { createBoardFrameSource, type BoardFrameSource } from "./boardFrameSource";
import { COMPOSITE_WIDTH, COMPOSITE_HEIGHT } from "./slideConstants";
import { normalizePipPosition, type ClassroomPipPosition } from "./mediaDevices";
import {
  acquireVideoOnlyStream,
  formatMediaAccessError,
} from "../mediaDeviceAcquire";

export { COMPOSITE_WIDTH, COMPOSITE_HEIGHT };

// PiP dimensions for non-green-screen mode (small corner overlay).
const PIP_WIDTH = Math.round(COMPOSITE_WIDTH * 0.22);
const PIP_HEIGHT = Math.round(PIP_WIDTH * (3 / 4)); // portrait 3:4 so full body shows
const PIP_MARGIN = 16;
const DEFAULT_FPS = 30;

/**
 * Max box for OBS-style green-screen cutout (full person, contain-fit).
 *
 * Portrait 3:4-ish box (~422 x 594 px on a 1920 x 1080 composite) so a 16:9
 * webcam, cropped to a centered portrait ROI first, produces a slim vertical
 * figure that sits comfortably in the chosen corner without eating half the
 * board.
 */
export const GS_CUTOUT_MAX_WIDTH_FRAC = 0.22;
export const GS_CUTOUT_MAX_HEIGHT_FRAC = 0.55;
export const GS_CUTOUT_MARGIN = 16;

/**
 * Crop a landscape webcam source to a centered portrait ROI so the teacher's
 * full body fills the cutout box regardless of camera aspect.
 */
export function computePortraitRoi(
  sourceWidth: number,
  sourceHeight: number,
  targetAspect = 3 / 4
): { sx: number; sy: number; sw: number; sh: number } {
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  const wantW = Math.min(sw, Math.max(1, Math.round(sh * targetAspect)));
  const sx = Math.round((sw - wantW) / 2);
  return { sx, sy: 0, sw: wantW, sh };
}

// Camera canvas dimensions when green screen is ON: full resolution for keying / raw publish.
const GS_CAM_WIDTH = COMPOSITE_WIDTH;
const GS_CAM_HEIGHT = COMPOSITE_HEIGHT;

/** When false, teacher publishes a single pre-composited track (board + teacher baked in). */
export const CLASSROOM_SPLIT_STREAM = false;

/** Top-left origin of a rectangle of size (w×h) in the chosen board corner. */
export function computeCornerOrigin(
  position: ClassroomPipPosition,
  w: number,
  h: number,
  margin: number = PIP_MARGIN
): { x: number; y: number } {
  const onLeft = position === "top-left" || position === "bottom-left";
  const onBottom = position === "bottom-right" || position === "bottom-left";
  const x = onLeft ? margin : COMPOSITE_WIDTH - w - margin;
  const y = onBottom ? COMPOSITE_HEIGHT - h - margin : margin;
  return { x, y };
}

/** Top-left corner of the PiP rectangle for the chosen corner. */
export function computePipOrigin(position: ClassroomPipPosition): { pipX: number; pipY: number } {
  const { x, y } = computeCornerOrigin(position, PIP_WIDTH, PIP_HEIGHT, PIP_MARGIN);
  return { pipX: x, pipY: y };
}

/**
 * Contain-fit the keyed teacher into a max box and anchor to the chosen corner
 * (OBS-style cutout — full silhouette, no crop, no full-width band).
 */
export function computeGreenScreenCutoutRect(
  position: ClassroomPipPosition,
  sourceWidth: number,
  sourceHeight: number
): { dx: number; dy: number; dw: number; dh: number } {
  const maxW = Math.round(COMPOSITE_WIDTH * GS_CUTOUT_MAX_WIDTH_FRAC);
  const maxH = Math.round(COMPOSITE_HEIGHT * GS_CUTOUT_MAX_HEIGHT_FRAC);
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  const scale = Math.min(maxW / sw, maxH / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const { x: dx, y: dy } = computeCornerOrigin(position, dw, dh, GS_CUTOUT_MARGIN);
  return { dx, dy, dw, dh };
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

export type ClassroomCameraPreview = {
  /** Raw webcam MediaStream, no chroma-key applied, no board composite. */
  stream: MediaStream;
  /** Hidden <video> attached to the raw stream so consumers can clone srcObject. */
  el: HTMLVideoElement;
};

export type ClassroomPublishBundle = {
  board: BoardStreamHandle;
  camera: CameraStreamHandle;
  recording: ClassroomCompositeHandle;
  /**
   * Raw webcam preview (no chroma-key, no board). Used by the admin studio's
   * CAMERA panel so the teacher always sees their full uncropped self, even
   * when the published composite crops them into a corner cutout.
   */
  cameraPreview: ClassroomCameraPreview;
  /**
   * Move the teacher cutout / PiP to a different board corner at runtime,
   * without restarting the capture pipeline or the LiveKit publish. The next
   * composite frame paints in the new corner.
   */
  setPipPosition: (next: ClassroomPipPosition) => void;
  /**
   * Show/hide the teacher PiP in the published composite without unpublishing
   * the LiveKit track. Off = board-only frames; On = PiP returns on the next paint.
   */
  setPipEnabled: (enabled: boolean) => void;
  /** Set when camera open failed and the bundle is board-only. */
  cameraWarning?: string;
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

/** Green-screen recording: OBS-style cutout anchored to the chosen board corner. */
function drawFullBoardTeacherLayer(
  outCtx: CanvasRenderingContext2D,
  cameraVideo: HTMLVideoElement,
  chromaCanvas: HTMLCanvasElement,
  chromaCtx: CanvasRenderingContext2D,
  pipPosition: ClassroomPipPosition
) {
  if (cameraVideo.readyState < 2) return;
  drawVideoWithChromaKey(cameraVideo, chromaCanvas, chromaCtx);
  const chromaSw = chromaCanvas.width || cameraVideo.videoWidth || 1;
  const chromaSh = chromaCanvas.height || cameraVideo.videoHeight || 1;
  // Crop the keyed source to a centered portrait ROI so the person fills the
  // cutout regardless of webcam aspect (16:9 sources land as a slim figure,
  // not a huge letterboxed landscape).
  const roi = computePortraitRoi(chromaSw, chromaSh);
  const { dx, dy, dw, dh } = computeGreenScreenCutoutRect(pipPosition, roi.sw, roi.sh);
  outCtx.drawImage(chromaCanvas, roi.sx, roi.sy, roi.sw, roi.sh, dx, dy, dw, dh);
}

async function openCameraVideo(cameraId?: string): Promise<HTMLVideoElement> {
  const cameraStream = await acquireVideoOnlyStream(cameraId);
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

  let cameraVideo: HTMLVideoElement | null = null;
  let cameraStream: MediaStream | null = null;
  let cameraWarning: string | undefined;
  try {
    cameraVideo = await openCameraVideo(opts.cameraId);
    cameraStream = cameraVideo.srcObject as MediaStream;
  } catch (err) {
    // Prefer board-only streaming over failing the whole class for students.
    cameraWarning = formatMediaAccessError(err);
    console.warn("[Classroom] camera open failed; continuing board-only:", cameraWarning);
  }

  const boardFrame = createBoardFrameSource(opts.editor ?? null, opts.boardEl);
  const chromaCanvas = opts.greenScreen && cameraVideo ? document.createElement("canvas") : null;
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
    if (cameraVideo && cameraVideo.readyState >= 2) {
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
  const rawCamTrack = cameraStream?.getVideoTracks()[0];
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
  // pipPosition / pipEnabled are mutable so runtime corner tabs and cam on/off
  // update the paint loop without restarting the whole publish bundle.
  let pipPosition = normalizePipPosition(opts.pipPosition);
  let pipEnabled = true;
  const setPipPosition = (next: ClassroomPipPosition) => {
    pipPosition = normalizePipPosition(next);
  };
  const setPipEnabled = (enabled: boolean) => {
    pipEnabled = !!enabled;
  };
  let resolveRecordingReady: (() => void) | null = null;
  let hasResolvedRecordingReady = false;
  const recordingReady = new Promise<void>((resolve) => {
    resolveRecordingReady = resolve;
  });
  const tryResolveRecordingReady = () => {
    if (hasResolvedRecordingReady) return;
    // Board-only: ready as soon as the first board frame lands.
    if (!boardFrameIsReady) return;
    if (pipEnabled && cameraVideo && cameraVideo.readyState < 2) return;
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
    if (pipEnabled && cameraVideo) {
      if (opts.greenScreen && chromaCanvas && chromaCtx) {
        drawFullBoardTeacherLayer(recCtx, cameraVideo, chromaCanvas, chromaCtx, pipPosition);
      } else {
        const { pipX, pipY } = computePipOrigin(pipPosition);
        drawPipLayer(recCtx, cameraVideo, false, null, null, pipX, pipY);
      }
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

  const previewStream = cameraStream ?? recStream;
  const rawCamPreviewEl = document.createElement("video");
  rawCamPreviewEl.muted = true;
  rawCamPreviewEl.playsInline = true;
  rawCamPreviewEl.srcObject = previewStream;
  void rawCamPreviewEl.play().catch(() => {});

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
    rawCamPreviewEl.srcObject = null;
  };

  return {
    board: { stream: boardStream, stop: () => boardTrack.stop() },
    camera: { stream: camStream, previewEl: camPreviewEl, livePublishTrack, stop: () => camTrack.stop() },
    recording: { stream: recStream, previewEl: recPreviewEl, ready: recordingReady, stop: () => recTrack.stop() },
    cameraPreview: { stream: previewStream, el: rawCamPreviewEl },
    setPipPosition,
    setPipEnabled,
    cameraWarning,
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
