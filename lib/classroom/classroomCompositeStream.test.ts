import { describe, it, expect } from "vitest";
import {
  COMPOSITE_WIDTH,
  COMPOSITE_HEIGHT,
  computeCornerOrigin,
  computeGreenScreenCutoutRect,
  computePipOrigin,
  computePortraitRoi,
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
  it("contain-fits into the portrait max box and anchors bottom-right (OBS-style)", () => {
    // The cutout is fed a portrait ROI in production, but the function itself
    // should still contain-fit whatever source dims are passed in.
    const sw = 540;
    const sh = 720; // 3:4 portrait ROI from a 1280x720 webcam
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
    expect(dw).toBeLessThan(COMPOSITE_WIDTH * 0.3);
    expect(dx).toBeGreaterThan(COMPOSITE_WIDTH / 2);
  });

  it("stays inside the portrait max box for a 16:9 webcam ROI", () => {
    // Real ROI from a 1280x720 webcam is 540x720 (3:4). The resulting cutout
    // must fit inside the tuned portrait box (~ 422 x 594) with the tuned
    // margin and NOT sprawl across a full landscape band.
    const roiW = 540;
    const roiH = 720;
    const maxW = Math.round(COMPOSITE_WIDTH * GS_CUTOUT_MAX_WIDTH_FRAC);
    const maxH = Math.round(COMPOSITE_HEIGHT * GS_CUTOUT_MAX_HEIGHT_FRAC);
    const { dw, dh, dx, dy } = computeGreenScreenCutoutRect("bottom-right", roiW, roiH);
    expect(dw).toBeLessThanOrEqual(maxW);
    expect(dh).toBeLessThanOrEqual(maxH);
    // Under 25% of the composite width — much smaller than the board area.
    expect(dw).toBeLessThan(Math.round(COMPOSITE_WIDTH * 0.25));
    // Actually anchored to bottom-right within GS_CUTOUT_MARGIN.
    expect(COMPOSITE_WIDTH - (dx + dw)).toBe(GS_CUTOUT_MARGIN);
    expect(COMPOSITE_HEIGHT - (dy + dh)).toBe(GS_CUTOUT_MARGIN);
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

describe("computePortraitRoi", () => {
  it("crops a 1280x720 (16:9) source to a centered 540x720 portrait ROI", () => {
    const { sx, sy, sw, sh } = computePortraitRoi(1280, 720);
    expect(sw).toBe(540);
    expect(sh).toBe(720);
    // Centered horizontally, top-anchored so the full body/head is visible.
    expect(sx).toBe(Math.round((1280 - 540) / 2));
    expect(sy).toBe(0);
  });

  it("returns full frame when the source is already narrower than the target", () => {
    // 720x1600 portrait: 720 < round(1600 * 3/4) = 1200, so wantW = 720.
    const { sx, sw, sh } = computePortraitRoi(720, 1600);
    expect(sw).toBe(720);
    expect(sh).toBe(1600);
    expect(sx).toBe(0);
  });

  it("guards against zero / negative inputs", () => {
    const { sw, sh } = computePortraitRoi(0, 0);
    expect(sw).toBeGreaterThanOrEqual(1);
    expect(sh).toBeGreaterThanOrEqual(1);
  });
});
