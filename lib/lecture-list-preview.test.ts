import { describe, expect, it } from "vitest";
import {
  cfStreamThumbnailUrl,
  extractCfStreamUid,
  getLectureListPreviewSpec,
  getYouTubeVideoIdForPreview,
} from "./lecture-list-preview";

describe("extractCfStreamUid", () => {
  it("parses videodelivery manifest URL", () => {
    const uid = "f3446ca4fb4402105e6ba0f2a1f28347";
    expect(
      extractCfStreamUid(`https://videodelivery.net/${uid}/manifest/video.m3u8`),
    ).toBe(uid);
  });

  it("parses videodelivery downloads path", () => {
    const uid = "a1b2c3d4e5f6789012345678abcdef01";
    expect(extractCfStreamUid(`https://videodelivery.net/${uid}/downloads/default.mp4`)).toBe(uid);
  });

  it("parses customer cloudflarestream.com host", () => {
    const uid = "f3446ca4fb4402105e6ba0f2a1f28347";
    expect(
      extractCfStreamUid(`https://customer-abc123.cloudflarestream.com/${uid}/manifest/video.m3u8`),
    ).toBe(uid);
  });

  it("returns null for R2 URL", () => {
    expect(extractCfStreamUid("https://api.example.com/api/media/live-class-recording/x.mp4")).toBeNull();
  });
});

describe("cfStreamThumbnailUrl", () => {
  it("uses videodelivery thumbnails path", () => {
    const uid = "f3446ca4fb4402105e6ba0f2a1f28347";
    expect(cfStreamThumbnailUrl(uid)).toContain(`videodelivery.net/${uid}/thumbnails/thumbnail.jpg`);
  });
});

describe("getYouTubeVideoIdForPreview", () => {
  it("parses watch URL", () => {
    expect(getYouTubeVideoIdForPreview("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("parses youtu.be", () => {
    expect(getYouTubeVideoIdForPreview("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
});

describe("getLectureListPreviewSpec", () => {
  it("returns image for Stream manifest", () => {
    const uid = "f3446ca4fb4402105e6ba0f2a1f28347";
    const spec = getLectureListPreviewSpec(`https://videodelivery.net/${uid}/manifest/video.m3u8`, null);
    expect(spec.kind).toBe("image");
    if (spec.kind === "image") expect(spec.uri).toContain(uid);
  });

  it("returns image for YouTube", () => {
    const spec = getLectureListPreviewSpec("https://www.youtube.com/watch?v=dQw4w9WgXcQ", null);
    expect(spec).toEqual({ kind: "image", uri: "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg" });
  });

  it("returns securedVideo for api media mp4", () => {
    expect(getLectureListPreviewSpec("/api/media/live-class-recording/x.mp4", null)).toEqual({
      kind: "securedVideo",
      fileKey: "live-class-recording/x.mp4",
    });
  });

  it("returns placeholder for api media HLS (no client poster path)", () => {
    expect(getLectureListPreviewSpec("/api/media/videos/lesson.m3u8", null)).toEqual({ kind: "placeholder" });
  });

  it("returns pdf when only pdf_url", () => {
    expect(getLectureListPreviewSpec("", "https://api.example.com/api/media/notes/a.pdf")).toEqual({
      kind: "pdf",
    });
  });

  it("prefers video over pdf when both set (YouTube)", () => {
    const spec = getLectureListPreviewSpec("https://youtu.be/dQw4w9WgXcQ", "https://x.com/slides.pdf");
    expect(spec.kind).toBe("image");
  });
});
