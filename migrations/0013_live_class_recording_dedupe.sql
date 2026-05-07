-- Make live-class -> lecture finalize idempotent and resilient to admin deletes.
--
-- Background:
--   * `POST /api/admin/live-classes/:id/stream/end` and `PUT /api/admin/live-classes/:id`
--     both used to insert lecture rows for a finished class, often with different
--     URLs (cf_playback_hls vs the final VOD URL) so the legacy
--     (course_id, title, video_url) dedupe missed and we got two rows.
--   * After admin delete, a still-running async finalize loop or the periodic
--     archive sweep could re-insert the same row 5–8 s later.
--
-- This migration enforces a single canonical row per live class, and lets the
-- delete handler tombstone the live class so background workers stop touching it.
--
-- Safe to re-run.

ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS live_class_id INTEGER NULL,
  ADD COLUMN IF NOT EXISTS live_class_finalized BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_lectures_live_class_id
  ON lectures(live_class_id)
  WHERE live_class_id IS NOT NULL;

-- Backfill live_class_id for existing recordings so the unique index below can
-- be created without conflict and so the new finalize path can match on it.
DO $$
BEGIN
  IF to_regclass('public.live_classes') IS NOT NULL THEN
    UPDATE lectures l
       SET live_class_id = lc.id
      FROM live_classes lc
     WHERE l.live_class_id IS NULL
       AND lc.recording_url IS NOT NULL
       AND lc.recording_url <> ''
       AND lc.course_id = l.course_id
       AND lc.title = l.title
       AND l.video_url = lc.recording_url;
  END IF;
END $$;

-- If the backfill produced duplicates (multiple lectures referencing the same
-- live class — exactly the bug we are fixing), keep only the most recent and
-- null-out the older rows so the unique index can be created.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT live_class_id
      FROM lectures
     WHERE live_class_id IS NOT NULL
     GROUP BY live_class_id
    HAVING COUNT(*) > 1
  ) AS d;

  IF dup_count > 0 THEN
    UPDATE lectures
       SET live_class_id = NULL
     WHERE id IN (
       SELECT id FROM (
         SELECT id,
                row_number() OVER (
                  PARTITION BY live_class_id
                  ORDER BY COALESCE(created_at, 0) DESC, id DESC
                ) AS rn
           FROM lectures
          WHERE live_class_id IS NOT NULL
       ) ranked
       WHERE rn > 1
     );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lectures_one_per_live_class
  ON lectures(live_class_id)
  WHERE live_class_id IS NOT NULL;

ALTER TABLE live_classes
  ADD COLUMN IF NOT EXISTS recording_deleted_at BIGINT NULL;
