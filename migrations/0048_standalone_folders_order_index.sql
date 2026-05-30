-- Migration 0048: Add order_index to standalone_folders (free folder reordering)
--
-- WHY:
--   standalone_folders (free test / material / mission / mini_course folders)
--   had no ordering column, so folders were always shown in creation order
--   (read query used `ORDER BY created_at ASC`). This mirrors migration 0047
--   for course_folders and lets admins drag-reorder the free-content folders.
--
-- SAFETY:
--   - Additive only. `ADD COLUMN IF NOT EXISTS` + DEFAULT 0 makes every
--     existing row valid immediately (no NULLs, no data loss).
--   - Backfill ranks existing folders per `type` by their current created_at
--     order, so the visible order does NOT change after migration.
--   - Re-runnable and deterministic.
--   - Backward compatible: old reads still work; only the ORDER BY changes
--     (deployed alongside, falls back to created_at as tiebreak).

-- 1. Add the column (default 0 so all existing rows are valid)
ALTER TABLE standalone_folders
  ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill: preserve current (creation) order within each type.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY type
      ORDER BY created_at ASC, id ASC
    ) - 1 AS rn
  FROM standalone_folders
)
UPDATE standalone_folders sf
SET order_index = ranked.rn
FROM ranked
WHERE sf.id = ranked.id;

-- 3. Index for efficient ordered listing per type
CREATE INDEX IF NOT EXISTS idx_standalone_folders_type_order
  ON standalone_folders (type, order_index);
