import { describe, expect, it } from "vitest";
import { normalizePipPosition } from "./classroomPipPosition";

describe("normalizePipPosition", () => {
  it("accepts all four corners", () => {
    expect(normalizePipPosition("top-right")).toBe("top-right");
    expect(normalizePipPosition("top-left")).toBe("top-left");
    expect(normalizePipPosition("bottom-right")).toBe("bottom-right");
    expect(normalizePipPosition("bottom-left")).toBe("bottom-left");
  });

  it("normalizes case and whitespace", () => {
    expect(normalizePipPosition("  TOP-RIGHT  ")).toBe("top-right");
  });

  it("falls back to bottom-left for unknown values", () => {
    expect(normalizePipPosition("center")).toBe("bottom-left");
    expect(normalizePipPosition(null)).toBe("bottom-left");
  });
});
