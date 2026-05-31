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
// OBS Similarity 455/1000 → broad acceptance around the green backdrop.
const HUE_TOLERANCE = 58;
// Saturation must be above this fraction (0–1) to be treated as "coloured".
// Low-saturation pixels (white/grey/black) are never keyed out.
const MIN_SATURATION = 0.08;
// Softness: pixels near the edge of the hue band are faded out gradually
// rather than cut hard.  OBS Smoothness 65/1000 → ~0.40 blend zone.
const SMOOTHNESS = 0.58;
// Spill reduction: green cast remaining on foreground edges is desaturated.
// OBS Spill Reduction 87/1000 → ~0.34 correction strength.
const SPILL_STRENGTH = 0.62;
const MIN_GREEN_VALUE = 56;
const GREEN_DOMINANCE = 1.08;

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

    const greenDominant =
      g >= MIN_GREEN_VALUE &&
      g > r * GREEN_DOMINANCE &&
      g > b * GREEN_DOMINANCE &&
      g - Math.max(r, b) > 14;

    // Skip unsaturated pixels unless green is clearly dominant.
    if (s < MIN_SATURATION && !greenDominant) continue;

    const dist = hueDist(h, KEY_HUE);
    if (dist > HUE_TOLERANCE && !greenDominant) continue;

    // Within the acceptance band → compute alpha.
    // Core (dist < HUE_TOLERANCE * (1-SMOOTHNESS)) → fully transparent.
    // Edge (between core and HUE_TOLERANCE) → blend.
    const effectiveDist = greenDominant ? Math.min(dist, HUE_TOLERANCE * 0.35) : dist;
    const coreEdge = HUE_TOLERANCE * (1 - SMOOTHNESS);
    if (effectiveDist <= coreEdge) {
      px[i + 3] = 0;
    } else {
      // Smooth fade from opaque at HUE_TOLERANCE to transparent at coreEdge.
      const t = Math.max(0, Math.min(1, (effectiveDist - coreEdge) / (HUE_TOLERANCE - coreEdge)));
      // Bias semi-transparent green edges toward transparency, closer to OBS
      // chroma-key output for a physical green screen.
      px[i + 3] = Math.round(Math.pow(t, 1.55) * 255);

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
