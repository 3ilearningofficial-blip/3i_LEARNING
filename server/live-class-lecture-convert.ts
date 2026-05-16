import { buildRecordingLectureSectionTitle } from "./recordingSection";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

function inferVideoType(url: string): "youtube" | "cloudflare" | "r2" {
  const lower = String(url || "").toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
  return "r2";
}

function pickRecordingUrl(row: Record<string, unknown>, fallback?: Record<string, unknown>): string {
  const from = (r: Record<string, unknown>) =>
    String(r.recording_url || r.cf_playback_hls || r.youtube_url || r.board_snapshot_url || "").trim();
  return from(row) || (fallback ? from(fallback) : "");
}

function durationMinutes(peer: Record<string, unknown>, anchor: Record<string, unknown>): number {
  if (peer.started_at && peer.ended_at) {
    return Math.max(1, Math.round((Number(peer.ended_at) - Number(peer.started_at)) / 60000));
  }
  if (peer.duration_minutes != null) return Number(peer.duration_minutes);
  if (anchor.duration_minutes != null) return Number(anchor.duration_minutes);
  return 0;
}

/** Save completed live class(es) with the same title as a course lecture under Live Class Recordings (+ optional subfolder). */
export async function convertLiveClassTitlePeersToLectures(
  db: DbClient,
  anchor: Record<string, unknown>,
  opts: {
    sectionTitleOverride?: string | null;
    recomputeCourseProgress?: (courseId: number | string) => Promise<void>;
  } = {}
): Promise<number[]> {
  if (anchor.recording_deleted_at) return [];

  const title = String(anchor.title || "").trim();
  if (!title) return [];

  const sameTitle = await db.query("SELECT * FROM live_classes WHERE title = $1 ORDER BY id", [title]);
  const lectureIds: number[] = [];

  for (const peer of sameTitle.rows) {
    if (!peer.course_id || peer.recording_deleted_at) continue;

    const urlForPeer = pickRecordingUrl(peer, anchor);
    const targetSection = buildRecordingLectureSectionTitle(
      peer.lecture_section_title,
      peer.lecture_subfolder_title,
      opts.sectionTitleOverride
    );

    const maxOrder = await db.query(
      "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
      [peer.course_id]
    );

    const description =
      String(peer.description || anchor.description || "").trim() ||
      (urlForPeer ? "" : "Interactive classroom session (whiteboard). Upload a video recording to replace this placeholder.");

    const lectureResult = await db.query(
      `INSERT INTO lectures (
         course_id, title, description, video_url, video_type, duration_minutes,
         order_index, is_free_preview, section_title, live_class_id, live_class_finalized, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
       ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         video_url = COALESCE(NULLIF(EXCLUDED.video_url, ''), lectures.video_url),
         video_type = EXCLUDED.video_type,
         duration_minutes = EXCLUDED.duration_minutes,
         section_title = EXCLUDED.section_title,
         live_class_finalized = TRUE
       RETURNING id`,
      [
        peer.course_id,
        peer.title,
        description,
        urlForPeer,
        urlForPeer ? inferVideoType(urlForPeer) : "r2",
        durationMinutes(peer, anchor),
        maxOrder.rows[0].next_order,
        false,
        targetSection,
        peer.id,
        Date.now(),
      ]
    );

    lectureIds.push(Number(lectureResult.rows[0]?.id));
    await db.query(
      "UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1",
      [peer.course_id]
    );
    if (opts.recomputeCourseProgress) {
      await opts.recomputeCourseProgress(peer.course_id);
    }
  }

  return lectureIds;
}

export function liveClassHasConvertibleRecording(row: Record<string, unknown>): boolean {
  return !!pickRecordingUrl(row);
}
