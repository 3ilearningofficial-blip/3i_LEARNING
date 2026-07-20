import { describe, it, expect } from "vitest";
import { buildNativeYouTubeFallbackHtml, buildNativeYouTubeHtml } from "./buildNativeYouTubeHtml";

const VIDEO_ID = "dQw4w9WgXcQ";

describe("buildNativeYouTubeHtml", () => {
  it("includes video id and iframe API for primary native player", () => {
    const html = buildNativeYouTubeHtml(VIDEO_ID, { startAt: 30 });
    expect(html).toContain(`videoId:'${VIDEO_ID}'`);
    expect(html).toContain("youtube.com/iframe_api");
    expect(html).toContain("start:28");
  });

  it("fallback embed includes origin and video id", () => {
    const html = buildNativeYouTubeFallbackHtml(VIDEO_ID, { startAt: 30, endAt: 120 });
    expect(html).toContain(`/embed/${VIDEO_ID}?`);
    expect(html).toContain("origin=https%3A%2F%2F3ilearning.in");
    expect(html).toContain("start=28");
    expect(html).toContain("end=120");
  });
});
