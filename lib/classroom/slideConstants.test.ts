import { describe, expect, it } from "vitest";
import { SLIDE_ASPECT, getSlideBounds, getExportPixelSize } from "./slideConstants";

describe("slideConstants", () => {
  it("uses 16:9 aspect", () => {
    expect(SLIDE_ASPECT).toBeCloseTo(16 / 9, 5);
  });

  it("slide bounds are 1920x1080", () => {
    const b = getSlideBounds();
    expect(b.w).toBe(1920);
    expect(b.h).toBe(1080);
  });

  it("export pixel size scales by EXPORT_SCALE", () => {
    const { width, height } = getExportPixelSize();
    expect(width).toBe(3840);
    expect(height).toBe(2160);
  });
});
