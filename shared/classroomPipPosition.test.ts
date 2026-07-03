import { describe, expect, it } from "vitest";
import {
  normalizePipPosition,
  parseClassroomTeacherStreamMeta,
  serializeClassroomTeacherStreamMeta,
} from "./classroomPipPosition";

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

describe("classroom teacher stream meta", () => {
  it("serializes and parses cameraEnabled", () => {
    const on = serializeClassroomTeacherStreamMeta({
      pipPosition: "top-right",
      greenScreen: true,
      cameraEnabled: true,
    });
    expect(JSON.parse(on)).toEqual({
      pipPosition: "top-right",
      greenScreen: true,
      cameraEnabled: true,
    });
    expect(parseClassroomTeacherStreamMeta(on).cameraEnabled).toBe(true);

    const off = serializeClassroomTeacherStreamMeta({
      pipPosition: "bottom-left",
      greenScreen: true,
      cameraEnabled: false,
    });
    expect(parseClassroomTeacherStreamMeta(off).cameraEnabled).toBe(false);
  });

  it("defaults cameraEnabled to true when omitted in legacy metadata", () => {
    expect(parseClassroomTeacherStreamMeta('{"pipPosition":"top-left","greenScreen":true}').cameraEnabled).toBe(
      true
    );
  });

  it("leaves pipPosition undefined when field is missing so DB fallback can apply", () => {
    const meta = parseClassroomTeacherStreamMeta('{"greenScreen":false,"cameraEnabled":true}');
    expect(meta.pipPosition).toBeUndefined();
    expect(meta.greenScreen).toBe(false);
    expect(meta.cameraEnabled).toBe(true);
  });

  it("leaves pipPosition undefined for invalid corner values", () => {
    expect(parseClassroomTeacherStreamMeta('{"pipPosition":"center"}').pipPosition).toBeUndefined();
  });
});
