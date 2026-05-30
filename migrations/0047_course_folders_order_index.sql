-- Migration 0047: Add order_index to course_folders (folder reordering)
--
-- WHY:
--   course_folders had no ordering column, so folders were always shown in
--   creation order (read query used `ORDER BY created_at ASC`). Admins could
--   reorder items WITHIN a folder (tests/materials) but never the folders
--   themselves. This adds an explicit order column so folders can be dragged.
--
-- SAFETY:
--   - Additive only. `ADD COLUMN IF NOT EXISTS` + DEFAULT 0 makes every
--     existing row valid immediately (no NULLs, no data loss).
--   - Backfill ranks existing folders per (course_id, type) by their current
--     created_at order, so the visible order does NOT change after migration.
--   - Re-runnable: the migration runner applies each file once, and the
--     backfill is deterministic from created_at.
--   - Backward compatible: old reads still work; only the ORDER BY changes
--     (deployed alongside, falls back to created_at as tiebreak).

-- 1. Add the column (default 0 so all existing rows are valid)
ALTER TABLE course_folders
  ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill: preserve current (creation) order within each course + type.
--    ROW_NUMBER starts at 1; subtract 1 so indices are 0-based like the
--    tests/study_materials order_index convention.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY course_id, type
      ORDER BY created_at ASC, id ASC
    ) - 1 AS rn
  FROM course_folders
)
UPDATE course_folders cf
SET order_index = ranked.rn
FROM ranked
WHERE cf.id = ranked.id;

-- 3. Index for efficient ordered listing per course + type
CREATE INDEX IF NOT EXISTS idx_course_folders_course_type_order
  ON course_folders (course_id, type, order_index);
