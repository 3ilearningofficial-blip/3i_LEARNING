/**
 * Chroma key (green screen) for classroom teacher video.
 * Uses HSV colour space — same approach as OBS Chroma Key filter.
 *
 * Parameters are tuned to match the OBS settings the admin uses:
 *   Similarity 455/1000, Smoothness 65/1000,
 *   Spill Reduction 87/1000, Contrast 0.29, Brightness -0.036
 */

// ── tuneable constants (mirrored from OBS settings) ────────────────────────
// Hue centre of the green key in degrees (0-360). Pure green = 120°.
const KEY_HUE = 120;
// Half-width of the hue acceptance band in degrees.
// OBS Similarity 455/1000 → roughly ±35° hue window.
const HUE_TOLERANCE = 35;
// Saturation must be above this fraction (0–1) to be treated as "coloured".
// Low-saturation pixels (white/grey/black) are never keyed out.
const MIN_SATURATION = 0.15;
// Softness: pixels near the edge of the hue band are faded out gradually
// rather than cut hard.  OBS Smoothness 65/1000 → ~0.40 blend zone.
const SMOOTHNESS = 0.40;
// Spill reduction: green cast remaining on foreground edges is desaturated.
// OBS Spill Reduction 87/1000 → ~0.34 correction strength.
const SPILL_STRENGTH = 0.34;

// ── colour helpers ──────────────────────────────────────────────────────────
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const nr = r / 255, ng = g / 255, nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === nr)      h = 60 * (((ng - nb) / d) % 6);
    else if (max === ng) h = 60 * ((nb - nr) / d + 2);
    else                 h = 60 * ((nr - ng) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/** Angular distance between two hues (0–180). */
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ── main export ─────────────────────────────────────────────────────────────
export function applyChromaKeyToImageData(data: ImageData): void {
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const [h, s] = rgbToHsv(r, g, b);

    // Skip unsaturated pixels — they're never background green.
    if (s < MIN_SATURATION) continue;

    const dist = hueDist(h, KEY_HUE);
    if (dist > HUE_TOLERANCE) continue;

    // Within the acceptance band → compute alpha.
    // Core (dist < HUE_TOLERANCE * (1-SMOOTHNESS)) → fully transparent.
    // Edge (between core and HUE_TOLERANCE) → blend.
    const coreEdge = HUE_TOLERANCE * (1 - SMOOTHNESS);
    if (dist <= coreEdge) {
      px[i + 3] = 0;
    } else {
      // Smooth fade from opaque at HUE_TOLERANCE to transparent at coreEdge.
      const t = (dist - coreEdge) / (HUE_TOLERANCE - coreEdge);
      px[i + 3] = Math.round(t * 255);

      // Green-spill reduction on semi-transparent edge pixels.
      if (SPILL_STRENGTH > 0) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        px[i]     = Math.round(r + SPILL_STRENGTH * (luma - r));
        px[i + 1] = Math.round(g + SPILL_STRENGTH * (luma - g));
        px[i + 2] = Math.round(b + SPILL_STRENGTH * (luma - b));
      }
    }
  }
}

export function drawVideoWithChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): void {
  if (video.videoWidth === 0) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyChromaKeyToImageData(frame);
  ctx.putImageData(frame, 0, 0);
}
