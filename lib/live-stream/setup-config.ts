import { getYouTubeVideoId } from "@/lib/youtube-utils";
import type { StreamType } from "./types";

export type SetupValidationResult = { ok: true } | { ok: false; message: string };

export function validateSetupBeforeGoLive(
  streamType: StreamType,
  opts: {
    youtubeUrl?: string;
    cfStreamReady?: boolean;
    livekitConfigured?: boolean;
  }
): SetupValidationResult {
  if (streamType === "rtmp") {
    const id = getYouTubeVideoId(String(opts.youtubeUrl || ""));
    if (!id) {
      return {
        ok: false,
        message:
          "Enter a valid YouTube Live or watch URL (e.g. https://www.youtube.com/watch?v=... or /live/...).",
      };
    }
  }
  if (streamType === "cloudflare" && !opts.cfStreamReady) {
    return { ok: false, message: "Cloudflare Stream is not ready yet. Wait or tap retry." };
  }
  if (streamType === "classroom" && opts.livekitConfigured === false) {
    return {
      ok: false,
      message:
        "LiveKit is not configured on the server. Add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET to continue.",
    };
  }
  return { ok: true };
}
