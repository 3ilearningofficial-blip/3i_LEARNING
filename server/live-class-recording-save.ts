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

/** Persist recording URL on live class row(s) and upsert course lecture under Live Class Recordings. */
export async function saveRecordingForClassAndPeers(
  db: DbClient,
  liveClassId: string,
  recordingUrl: string,
  opts: {
    sectionTitle?: string;
    recomputeCourseProgress?: (courseId: number | string) => Promise<void>;
  } = {}
): Promise<{ lectureId: number | null; lectureIds: number[] }> {
  const lcResult = await db.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
  if (lcResult.rows.length === 0) {
    throw new Error("Live class not found");
  }
  const liveClass = lcResult.rows[0];
  if (liveClass.recording_deleted_at) {
    return { lectureId: null, lectureIds: [] };
  }
  const title = liveClass.title as string;
  const peers = await db.query("SELECT * FROM live_classes WHERE title = $1 ORDER BY id", [title]);
  const lectureIds: number[] = [];
  const endedAt = Date.now();

  for (const row of peers.rows) {
    if (row.recording_deleted_at) continue;
    const durationMins = row.started_at
      ? Math.max(1, Math.round((endedAt - Number(row.started_at)) / 60000))
      : 0;
    await db.query(
      `UPDATE live_classes 
         SET recording_url = $1, is_completed = TRUE, is_live = FALSE, ended_at = $2,
             duration_minutes = CASE 
               WHEN started_at IS NOT NULL 
               THEN GREATEST(1, ROUND(($2::bigint - started_at) / 60000.0)::INTEGER)
               ELSE 0
             END
         WHERE id = $3`,
      [recordingUrl, endedAt, row.id]
    );

    if (!row.course_id) continue;
    const maxOrder = await db.query(
      "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
      [row.course_id]
    );
    const recordSection = buildRecordingLectureSectionTitle(
      row.lecture_section_title,
      row.lecture_subfolder_title,
      opts.sectionTitle
    );
    const lectureResult = await db.query(
      `INSERT INTO lectures (
         course_id, title, description, video_url, video_type, duration_minutes,
         order_index, is_free_preview, section_title, live_class_id, live_class_finalized, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
       ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
       DO UPDATE SET
         course_id = EXCLUDED.course_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         video_url = EXCLUDED.video_url,
         video_type = EXCLUDED.video_type,
         duration_minutes = EXCLUDED.duration_minutes,
         section_title = EXCLUDED.section_title,
         live_class_finalized = TRUE
       RETURNING id`,
      [
        row.course_id,
        row.title,
        row.description || "",
        recordingUrl,
        inferVideoType(recordingUrl),
        durationMins,
        maxOrder.rows[0].next_order,
        false,
        recordSection,
        row.id,
        Date.now(),
      ]
    );
    lectureIds.push(Number(lectureResult.rows[0]?.id));
    await db.query(
      "UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1",
      [row.course_id]
    );
    if (opts.recomputeCourseProgress) {
      await opts.recomputeCourseProgress(row.course_id);
    }
  }

  return { lectureId: lectureIds[0] ?? null, lectureIds };
}
