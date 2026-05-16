export type StreamType = "classroom" | "cloudflare" | "rtmp" | "webrtc";

export type ChatMode = "public" | "private";

export const STREAM_TYPE_OPTIONS: {
  id: StreamType;
  title: string;
  description: string;
  icon: string;
  recommended?: boolean;
}[] = [
  {
    id: "classroom",
    title: "Interactive Classroom",
    description: "Teach on a live whiteboard with your camera inside the app.",
    icon: "easel",
    recommended: true,
  },
  {
    id: "cloudflare",
    title: "Cloudflare Stream",
    description: "Stream with OBS or an RTMP encoder. Students watch in the app.",
    icon: "cloud",
  },
  {
    id: "rtmp",
    title: "YouTube / RTMP",
    description: "Paste a YouTube Live URL for students to watch in the app.",
    icon: "logo-youtube",
  },
  {
    id: "webrtc",
    title: "Browser record",
    description: "Record from your browser (screen share). Uploads when class ends.",
    icon: "desktop-outline",
  },
];

export function normalizeStreamType(raw: unknown): StreamType | null {
  const v = String(raw || "").toLowerCase();
  if (v === "classroom" || v === "cloudflare" || v === "rtmp" || v === "webrtc") return v;
  if (v === "youtube") return "rtmp";
  return null;
}
