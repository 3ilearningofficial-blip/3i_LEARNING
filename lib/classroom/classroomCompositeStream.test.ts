import { describe, it, expect } from "vitest";
import {
  COMPOSITE_WIDTH,
  COMPOSITE_HEIGHT,
  computeCornerOrigin,
  computeGreenScreenCutoutRect,
  computePipOrigin,
  GS_CUTOUT_MARGIN,
  GS_CUTOUT_MAX_HEIGHT_FRAC,
  GS_CUTOUT_MAX_WIDTH_FRAC,
} from "./classroomCompositeStream";

describe("computeCornerOrigin", () => {
  it("anchors bottom-right with margin", () => {
    const { x, y } = computeCornerOrigin("bottom-right", 100, 200, 16);
    expect(x).toBe(COMPOSITE_WIDTH - 100 - 16);
    expect(y).toBe(COMPOSITE_HEIGHT - 200 - 16);
  });

  it("anchors top-left with margin", () => {
    const { x, y } = computeCornerOrigin("top-left", 100, 200, 16);
    expect(x).toBe(16);
    expect(y).toBe(16);
  });
});

describe("computePipOrigin", () => {
  it("places non-GS PiP in bottom-right", () => {
    const { pipX, pipY } = computePipOrigin("bottom-right");
    expect(pipX).toBeGreaterThan(COMPOSITE_WIDTH / 2);
    expect(pipY).toBeGreaterThan(COMPOSITE_HEIGHT / 2);
  });
});

describe("computeGreenScreenCutoutRect", () => {
  it("contain-fits into the max box and anchors bottom-right (OBS-style)", () => {
    // Landscape source — height-limited by maxH
    const sw = 1280;
    const sh = 720;
    const maxW = Math.round(COMPOSITE_WIDTH * GS_CUTOUT_MAX_WIDTH_FRAC);
    const maxH = Math.round(COMPOSITE_HEIGHT * GS_CUTOUT_MAX_HEIGHT_FRAC);
    const scale = Math.min(maxW / sw, maxH / sh);
    const expectedDw = Math.round(sw * scale);
    const expectedDh = Math.round(sh * scale);

    const { dx, dy, dw, dh } = computeGreenScreenCutoutRect("bottom-right", sw, sh);

    expect(dw).toBe(expectedDw);
    expect(dh).toBe(expectedDh);
    expect(dw).toBeLessThanOrEqual(maxW);
    expect(dh).toBeLessThanOrEqual(maxH);
    expect(dx).toBe(COMPOSITE_WIDTH - dw - GS_CUTOUT_MARGIN);
    expect(dy).toBe(COMPOSITE_HEIGHT - dh - GS_CUTOUT_MARGIN);
    // Not a full-width bottom band
    expect(dw).toBeLessThan(COMPOSITE_WIDTH * 0.5);
    expect(dx).toBeGreaterThan(COMPOSITE_WIDTH / 2);
  });

  it("anchors bottom-left when selected", () => {
    const { dx, dy, dw, dh } = computeGreenScreenCutoutRect("bottom-left", 640, 480);
    expect(dx).toBe(GS_CUTOUT_MARGIN);
    expect(dy).toBe(COMPOSITE_HEIGHT - dh - GS_CUTOUT_MARGIN);
    expect(dw).toBeGreaterThan(0);
    expect(dh).toBeGreaterThan(0);
  });

  it("preserves aspect ratio (contain, no crop)", () => {
    const sw = 900;
    const sh = 1600; // tall portrait
    const { dw, dh } = computeGreenScreenCutoutRect("bottom-right", sw, sh);
    expect(dw / dh).toBeCloseTo(sw / sh, 2);
  });
});
