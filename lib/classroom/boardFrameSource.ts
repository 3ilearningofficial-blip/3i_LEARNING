import { Box, type Editor } from "tldraw";
import { getCurrentPageExportBounds } from "./exportClassroomBoardViewport";

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
// Removed 100ms debounce so rasterization starts immediately on each store change.
const DEFAULT_DEBOUNCE = 0;
// Safety refresh reduced from 1000ms → 400ms to keep students in sync on slow canvases.
const DEFAULT_SAFETY = 400;

export function createBoardFrameSource(
  editor: Editor | null,
  boardEl: HTMLElement | null,
  opts: Opts = {}
): BoardFrameSource {
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE;
  const safetyIntervalMs = opts.safetyIntervalMs ?? DEFAULT_SAFETY;

  let current: HTMLImageElement | null = null;
  let currentUrl: string | null = null;
  let inFlight = false;
  let lastRasterAt = 0;
  let stopped = false;
  let warned = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
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

  const setFrame = (img: HTMLImageElement | null, url: string | null) => {
    const prevUrl = currentUrl;
    current = img;
    currentUrl = url;
    if (prevUrl && prevUrl !== url) URL.revokeObjectURL(prevUrl);
  };

  const rasterize = async () => {
    if (stopped || inFlight || !editor) return;
    const now = Date.now();
    if (now - lastRasterAt < minIntervalMs) return;
    inFlight = true;
    lastRasterAt = now;
    try {
      const shapeIds = [...editor.getCurrentPageShapeIds()];
      if (shapeIds.length === 0) {
        // Empty page: clear the frame so the composite shows its slide background.
        setFrame(null, null);
        markFirstFrameReady();
        return;
      }
      const bounds = getCurrentPageExportBounds(editor, boardEl);
      // "jpeg" encodes ~3× faster than "png" for the same content; pixelRatio 0.75
      // reduces the blob size without visible quality loss on a 1920-wide canvas.
      const { blob } = await editor.toImage(shapeIds, {
        format: "jpeg",
        bounds: Box.From(bounds),
        background: true,
        scale: 1,
        pixelRatio: 0.75,
        padding: 0,
      });
      if (stopped || !blob) {
        markFirstFrameReady();
        return;
      }

      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      });
      if (stopped) {
        URL.revokeObjectURL(url);
        markFirstFrameReady();
        return;
      }
      setFrame(img, url);
      markFirstFrameReady();
    } catch (e) {
      if (!warned) {
        warned = true;
        console.warn("[Classroom] board frame rasterize failed:", e);
      }
      markFirstFrameReady();
    } finally {
      inFlight = false;
    }
  };

  const scheduleDebounced = () => {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void rasterize(), debounceMs);
  };

  // First frame as soon as possible.
  void rasterize();
  if (!editor) markFirstFrameReady();

  let lastPageId = editor?.getCurrentPageId();
  const unsub = editor?.store.listen(() => {
    scheduleDebounced();
    if (!editor) return;
    const pageId = editor.getCurrentPageId();
    if (pageId !== lastPageId) {
      lastPageId = pageId;
      if (debounceTimer) clearTimeout(debounceTimer);
      void rasterize();
    }
  }, { scope: "document" });
  const safety = setInterval(() => void rasterize(), safetyIntervalMs);

  const stop = () => {
    stopped = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(safety);
    try {
      unsub?.();
    } catch {
      /* listener already torn down */
    }
    setFrame(null, null);
  };

  return {
    getFrame: () => current,
    firstFrameReady,
    stop,
  };
}
