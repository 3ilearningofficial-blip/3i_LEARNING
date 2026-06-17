import { buildRecordingLectureSectionTitle } from "../shared/recordingSection";
import { notifyEnrolledCourseStudents } from "./auto-notification-expiry";
import { sendPushToUsers } from "./push-notifications";

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
  const lectureIds: number[] = [];
  const endedAt = Date.now();

  // Process only the class identified by liveClassId.
  // Previously this fetched all classes sharing the same title, which caused
  // recordings to be silently written to unrelated classes with duplicate names.
  for (const row of [liveClass]) {
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
    // visible_after_at: pass through from live_class for recording-mode sessions.
    // NULL means immediately visible (default for all live classes and manual lectures).
    const visibleAfterAt = (row.is_recording_mode && row.visible_after_at)
      ? Number(row.visible_after_at)
      : null;
    const lectureResult = await db.query(
      `INSERT INTO lectures (
         course_id, title, description, video_url, video_type, duration_minutes,
         order_index, is_free_preview, section_title, live_class_id, live_class_finalized,
         visible_after_at, subject_key, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $12, $13)
       ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
       DO UPDATE SET
         course_id = EXCLUDED.course_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         video_url = CASE
           WHEN $4::text ~* '\\.(png|jpe?g|webp|gif)(\\?|$)' AND lectures.video_url IS NOT NULL
             AND lectures.video_url !~* '\\.(png|jpe?g|webp|gif)(\\?|$)'
           THEN lectures.video_url
           ELSE EXCLUDED.video_url
         END,
         video_type = CASE
           WHEN $4::text ~* '\\.(png|jpe?g|webp|gif)(\\?|$)' AND lectures.video_url IS NOT NULL
             AND lectures.video_url !~* '\\.(png|jpe?g|webp|gif)(\\?|$)'
           THEN lectures.video_type
           ELSE EXCLUDED.video_type
         END,
         duration_minutes = EXCLUDED.duration_minutes,
         section_title = EXCLUDED.section_title,
         visible_after_at = EXCLUDED.visible_after_at,
        subject_key = EXCLUDED.subject_key,
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
        visibleAfterAt,
        row.subject_key || null,
        Date.now(),
      ]
    );
    lectureIds.push(Number(lectureResult.rows[0]?.id));
    // `courses.total_lectures` is maintained by a trigger on `lectures`.
    if (opts.recomputeCourseProgress) {
      await opts.recomputeCourseProgress(row.course_id);
    }

    const visibleNow =
      !visibleAfterAt || Number(visibleAfterAt) <= Date.now();
    if (visibleNow) {
      const courseInfo = await db
        .query("SELECT title FROM courses WHERE id = $1", [row.course_id])
        .catch(() => ({ rows: [] as { title?: string }[] }));
      const courseTitle = String(courseInfo.rows[0]?.title || "your course");
      const notifTitle = "📹 Class Recording Available";
      const notifMessage = `"${row.title}" recording is now available in ${courseTitle}.`;
      await notifyEnrolledCourseStudents(db, row.course_id, {
        title: notifTitle,
        message: notifMessage,
        pushData: {
          type: "class_recording_available",
          liveClassId: Number(row.id),
          courseId: Number(row.course_id),
        },
        sendPush: (userIds, payload) => sendPushToUsers(db, userIds, payload),
      });
    }
  }

  return { lectureId: lectureIds[0] ?? null, lectureIds };
}
