import { describe, it, expect } from "vitest";
import { canonicalMediaKey, mediaKeyMatchVariants } from "./media-key-utils";

describe("media-key-utils", () => {
  it("canonicalizes full api/media URL", () => {
    const raw = "https://api.3ilearning.in/api/media/live-class-recording/chapter-1/video%20one.mp4?x=1#t=5";
    expect(canonicalMediaKey(raw)).toBe("live-class-recording/chapter-1/video one.mp4");
  });

  it("canonicalizes already-relative api/media URL", () => {
    expect(canonicalMediaKey("/api/media/notes/ch-5/NumberSystem.pdf")).toBe("notes/ch-5/NumberSystem.pdf");
  });

  it("rejects traversal-like keys", () => {
    expect(canonicalMediaKey("/api/media/notes/../secret.pdf")).toBe("");
  });

  it("returns stable variants for SQL matching", () => {
    const variants = mediaKeyMatchVariants("/api/media/folder/file one.pdf");
    expect(variants).toContain("folder/file one.pdf");
    expect(variants).toContain("/api/media/folder/file one.pdf");
    expect(variants).toContain("api/media/folder/file%20one.pdf");
  });
});
