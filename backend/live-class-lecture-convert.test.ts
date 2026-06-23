import { describe, expect, it } from "vitest";
import {
  pickVideoRecordingUrlFromRow,
  isVideoRecordingUrl,
} from "../shared/recordingUrl";
import { liveClassHasConvertibleRecording } from "./live-class-lecture-convert";

describe("pickVideoRecordingUrlFromRow", () => {
  it("returns webm recording_url when present", () => {
    const url = pickVideoRecordingUrlFromRow({
      recording_url: "https://cdn.example.com/class.webm",
      board_snapshot_url: "https://cdn.example.com/board.png",
    });
    expect(url).toBe("https://cdn.example.com/class.webm");
    expect(isVideoRecordingUrl(url)).toBe(true);
  });

  it("never falls back to board_snapshot PNG", () => {
    const url = pickVideoRecordingUrlFromRow({
      recording_url: "",
      board_snapshot_url: "https://cdn.example.com/board-snapshot.png",
    });
    expect(url).toBe("");
  });

  it("ignores PNG in recording_url field", () => {
    const url = pickVideoRecordingUrlFromRow({
      recording_url: "https://cdn.example.com/mistaken-board.png",
      board_snapshot_url: "https://cdn.example.com/board.png",
    });
    expect(url).toBe("");
  });

  it("liveClassHasConvertibleRecording is false when only board snapshot exists", () => {
    expect(
      liveClassHasConvertibleRecording({
        board_snapshot_url: "https://cdn.example.com/snap.png",
      })
    ).toBe(false);
  });

  it("liveClassHasConvertibleRecording is true for webm", () => {
    expect(
      liveClassHasConvertibleRecording({
        recording_url: "https://cdn.example.com/rec.webm",
      })
    ).toBe(true);
  });
});
