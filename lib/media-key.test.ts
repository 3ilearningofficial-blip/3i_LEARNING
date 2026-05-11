import { describe, it, expect } from "vitest";
import { extractMediaFileKey } from "./media-key";

describe("extractMediaFileKey", () => {
  it("extracts key from absolute API URL", () => {
    expect(
      extractMediaFileKey("https://api.3ilearning.in/api/media/live-class-recording/chapter-2/Class%205.mp4?token=abc"),
    ).toBe("live-class-recording/chapter-2/Class 5.mp4");
  });

  it("extracts key from relative API URL", () => {
    expect(extractMediaFileKey("/api/media/notes/ch-5/number-system.pdf")).toBe("notes/ch-5/number-system.pdf");
  });

  it("returns null for non-media URL", () => {
    expect(extractMediaFileKey("https://youtu.be/dQw4w9WgXcQ")).toBeNull();
  });

  it("returns null for invalid traversal key", () => {
    expect(extractMediaFileKey("/api/media/notes/../secret.pdf")).toBeNull();
  });
});
