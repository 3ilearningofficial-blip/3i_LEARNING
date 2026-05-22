import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCloudflareStreamDownload,
  ensureCloudflareMp4DownloadUrl,
  getCloudflareStreamDownload,
} from "./cloudflare-stream-download";

describe("cloudflare-stream-download", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("createCloudflareStreamDownload returns ready url from POST", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        result: { default: { status: "ready", url: "https://customer.cloudflarestream.com/abc/downloads/default.mp4" } },
      }),
    } as Response);

    const info = await createCloudflareStreamDownload("acc", "token", "video-uid");
    expect(info?.status).toBe("ready");
    expect(info?.url).toContain("default.mp4");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/stream/video-uid/downloads"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("ensureCloudflareMp4DownloadUrl polls GET until ready", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: { default: { status: "inprogress", percentComplete: 10 } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: { default: { status: "inprogress", percentComplete: 50 } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            default: {
              status: "ready",
              url: "https://customer.cloudflarestream.com/xyz/downloads/default.mp4",
            },
          },
        }),
      } as Response);

    const url = await ensureCloudflareMp4DownloadUrl("acc", "token", "xyz", {
      maxWaitMs: 5000,
      pollMs: 1,
    });
    expect(url).toContain("default.mp4");
    expect(fetch).toHaveBeenCalled();
  });

  it("getCloudflareStreamDownload returns null on API failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false }),
    } as Response);

    const info = await getCloudflareStreamDownload("acc", "token", "bad");
    expect(info).toBeNull();
  });
});
