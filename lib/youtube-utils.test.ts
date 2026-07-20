import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getYouTubeVideoId } from "./youtube-utils";

const SAMPLE_ID = "dQw4w9WgXcQ";

describe("getYouTubeVideoId", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${SAMPLE_ID}`, SAMPLE_ID],
    [`https://youtube.com/watch?v=${SAMPLE_ID}&t=120`, SAMPLE_ID],
    [`https://m.youtube.com/watch?v=${SAMPLE_ID}`, SAMPLE_ID],
    [`https://youtu.be/${SAMPLE_ID}`, SAMPLE_ID],
    [`https://www.youtube.com/embed/${SAMPLE_ID}`, SAMPLE_ID],
    [`https://www.youtube-nocookie.com/embed/${SAMPLE_ID}`, SAMPLE_ID],
    [`https://youtube.com/shorts/${SAMPLE_ID}`, SAMPLE_ID],
    [`https://www.youtube.com/live/${SAMPLE_ID}`, SAMPLE_ID],
    [SAMPLE_ID, SAMPLE_ID],
    ["https://example.com/not-youtube", null],
    ["", null],
  ])("parses %s", (url, expected) => {
    expect(getYouTubeVideoId(url)).toBe(expected);
  });

  it("Property: supported URL prefixes yield the embedded video id", () => {
    const videoIdArbitrary = fc
      .array(
        fc.constantFrom(
          ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".split(""),
        ),
        { minLength: 11, maxLength: 11 },
      )
      .map((chars) => chars.join(""));

    const urlFormatArbitrary = fc.constantFrom(
      "https://youtube.com/live/",
      "https://www.youtube.com/live/",
      "https://youtu.be/",
      "https://www.youtu.be/",
      "https://youtube.com/watch?v=",
      "https://www.youtube.com/watch?v=",
      "https://m.youtube.com/watch?v=",
      "https://youtube.com/embed/",
      "https://www.youtube.com/embed/",
      "https://youtube-nocookie.com/embed/",
      "https://www.youtube-nocookie.com/embed/",
      "https://youtube.com/shorts/",
      "https://www.youtube.com/shorts/",
    );

    fc.assert(
      fc.property(
        fc.tuple(urlFormatArbitrary, videoIdArbitrary).map(([format, videoId]) => ({
          url: format + videoId,
          expectedId: videoId,
        })),
        ({ url, expectedId }) => {
          expect(getYouTubeVideoId(url)).toBe(expectedId);
        },
      ),
      { numRuns: 20 },
    );
  });
});
