import { Box, type Editor } from "tldraw";
import { getSlideBounds } from "./slideConstants";
import { fitEditorToSlide } from "./classroomSlideEditor";

/**
 * Live board frame provider for the classroom composite stream.
 *
 * tldraw renders strokes as SVG inside `.tl-canvas` (a div), so a canvas
 * `captureStream` of that element is empty — the board would be black in the
 * recording and in the students' live view. Instead we periodically rasterize
 * the current tldraw page via `editor.toImage()` into a cached <img>, and the
 * composite paint loops draw that image. This is the only reliable way to get
 * SVG board content into a canvas-based MediaStream.
 *
 * The image is refreshed shortly after the teacher draws (debounced store
 * listener) plus a low-rate safety interval, so a static board does not
 * re-rasterize continuously while still keeping handwriting near real time.
 */
export type BoardFrameSource = {
  /** Latest rasterized board image, or null when the page is empty / not ready. */
  getFrame: () => CanvasImageSource | null;
  /** Resolves after the first rasterize attempt (empty page counts as ready). */
  firstFrameReady: Promise<void>;
  stop: () => void;
};

type Opts = {
  /** Minimum gap between rasterizations (ms). */
  minIntervalMs?: number;
  /** Debounce after a board change before rasterizing (ms). */
  debounceMs?: number;
  /** Safety re-render cadence even with no detected change (ms). */
  safetyIntervalMs?: number;
};

// ~30fps cap with faster ink during active drawing.
const DEFAULT_MIN_INTERVAL = 33;
// No debounce: rasterization is scheduled per animation frame so we still
// coalesce bursts of store events without adding a fixed timeout gap.
const DEFAULT_DEBOUNCE = 0;
// Safety refresh reduced further so static-ink lag is bounded to ~250 ms even
// when store listeners miss a change (e.g. during panning/zooming).
const DEFAULT_SAFETY = 250;
// ~60 fps ceiling when re-running immediately after a slow rasterize.
const PENDING_MIN_INTERVAL = 16;
// JPEG encoder quality — lower means faster canvas.toBlob and smaller
// blobs, which lets us round-trip through createImageBitmap within a
// single animation frame during active drawing.
const JPEG_QUALITY = 0.6;
// Lower pixel ratio → smaller raster → faster encode + decode. 0.6 on a
// 1920-wide slide still yields ~1150 px which is sharp enough for streamed
// board content while cutting encode time nearly in half vs 0.75.
const PIXEL_RATIO = 0.6;

type FrameImage = HTMLImageElement | ImageBitmap;

const supportsImageBitmap = typeof globalThis !== "undefined" && typeof globalThis.createImageBitmap === "function";

async function decodeBlobToFrame(blob: Blob): Promise<FrameImage | null> {
  if (supportsImageBitmap) {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to <img> */
    }
  }
  return await new Promise<FrameImage | null>((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // Revoke on next tick so the decoded pixels remain available to the
      // caller while the bitmap-less browser paints.
      queueMicrotask(() => URL.revokeObjectURL(url));
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function releaseFrame(frame: FrameImage | null) {
  if (frame && "close" in frame && typeof frame.close === "function") {
    try {
      frame.close();
    } catch {
      /* already closed */
    }
  }
}

export function createBoardFrameSource(
  editor: Editor | null,
  boardEl: HTMLElement | null,
  opts: Opts = {}
): BoardFrameSource {
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE;
  const safetyIntervalMs = opts.safetyIntervalMs ?? DEFAULT_SAFETY;

  let current: FrameImage | null = null;
  let inFlight = false;
  // Set true when a store change arrives during an in-flight rasterize. On
  // completion we re-run immediately (queueMicrotask) with a shorter min gap
  // so the very next stroke shows up without waiting for the safety tick.
  let pending = false;
  let lastRasterAt = 0;
  let stopped = false;
  let warned = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let rafHandle: number | null = null;
  let firstFrameResolved = false;
  let resolveFirstFrame: (() => void) | null = null;
  const firstFrameReady = new Promise<void>((resolve) => {
    resolveFirstFrame = resolve;
  });
  const markFirstFrameReady = () => {
    if (firstFrameResolved) return;
    firstFrameResolved = true;
    resolveFirstFrame?.();
  };

  const setFrame = (img: FrameImage | null) => {
    if (current && current !== img) releaseFrame(current);
    current = img;
  };

  const rasterize = async () => {
    if (stopped || !editor) return;
    if (inFlight) {
      pending = true;
      return;
    }
    const now = Date.now();
    const gap = pending ? PENDING_MIN_INTERVAL : minIntervalMs;
    if (now - lastRasterAt < gap) return;
    inFlight = true;
    lastRasterAt = now;
    try {
      const shapeIds = [...editor.getCurrentPageShapeIds()];
      if (shapeIds.length === 0) {
        setFrame(null);
        markFirstFrameReady();
        return;
      }
      const bounds = getSlideBounds();
      const { blob } = await editor.toImage(shapeIds, {
        format: "jpeg",
        bounds: Box.From(bounds),
        background: true,
        scale: 1,
        pixelRatio: PIXEL_RATIO,
        padding: 0,
        quality: JPEG_QUALITY,
      });
      if (stopped || !blob) {
        markFirstFrameReady();
        return;
      }
      const frame = await decodeBlobToFrame(blob);
      if (stopped) {
        releaseFrame(frame);
        markFirstFrameReady();
        return;
      }
      setFrame(frame);
      markFirstFrameReady();
    } catch (e) {
      if (!warned) {
        warned = true;
        console.warn("[Classroom] board frame rasterize failed:", e);
      }
      markFirstFrameReady();
    } finally {
      inFlight = false;
      if (pending && !stopped) {
        pending = false;
        queueMicrotask(() => void rasterize());
      }
    }
  };

  // Coalesce a burst of store events (a single stroke fires many) into at
  // most one rasterize per animation frame. Falls back to setTimeout when
  // requestAnimationFrame is unavailable (SSR / tests).
  const scheduleImmediate = () => {
    if (stopped) return;
    if (typeof requestAnimationFrame === "function") {
      if (rafHandle != null) return;
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        void rasterize();
      });
      return;
    }
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void rasterize();
    }, debounceMs);
  };

  void rasterize();
  if (!editor) markFirstFrameReady();

  let lastPageId = editor?.getCurrentPageId();
  const unsub = editor?.store.listen(() => {
    scheduleImmediate();
    if (!editor) return;
    const pageId = editor.getCurrentPageId();
    if (pageId !== lastPageId) {
      lastPageId = pageId;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (rafHandle != null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      fitEditorToSlide(editor);
      void rasterize();
    }
  }, { scope: "document" });

  // Fire a crisp final rasterize right when the teacher lifts the pen /
  // finger. tldraw's store also fires, but pointer-up is the earliest
  // signal we can hook so the very last stroke shows up without waiting
  // for another RAF slice.
  const handlePointerUp = () => scheduleImmediate();
  if (boardEl && typeof boardEl.addEventListener === "function") {
    boardEl.addEventListener("pointerup", handlePointerUp, { passive: true });
    boardEl.addEventListener("pointercancel", handlePointerUp, { passive: true });
  }

  const safety = setInterval(() => scheduleImmediate(), safetyIntervalMs);

  const stop = () => {
    stopped = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (rafHandle != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    clearInterval(safety);
    if (boardEl && typeof boardEl.removeEventListener === "function") {
      boardEl.removeEventListener("pointerup", handlePointerUp);
      boardEl.removeEventListener("pointercancel", handlePointerUp);
    }
    try {
      unsub?.();
    } catch {
      /* listener already torn down */
    }
    setFrame(null);
  };

  return {
    getFrame: () => current,
    firstFrameReady,
    stop,
  };
}
