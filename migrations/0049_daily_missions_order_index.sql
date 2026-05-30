-- Migration 0049: Add order_index to daily_missions (mission reordering)
--
-- WHY:
--   daily_missions had no ordering column, so missions inside a folder were
--   shown by mission_date. This adds an explicit order column so admins can
--   drag-reorder missions within a folder (mirrors 0047/0048).
--
-- SAFETY:
--   - Additive only. ADD COLUMN IF NOT EXISTS + DEFAULT 0 -> all rows valid.
--   - Backfill ranks existing missions per folder_name by mission_date so the
--     visible order does NOT change after migration.
--   - Re-runnable and deterministic.
--   - Backward compatible: reads fall back to mission_date when order_index ties
--     (all default to 0 until an admin reorders).

-- 1. Add the column (default 0 so all existing rows are valid)
ALTER TABLE daily_missions
  ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill: preserve current order within each folder (NULL folder grouped together).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY folder_name
      ORDER BY mission_date ASC, id ASC
    ) - 1 AS rn
  FROM daily_missions
)
UPDATE daily_missions dm
SET order_index = ranked.rn
FROM ranked
WHERE dm.id = ranked.id;

-- 3. Index for efficient ordered listing per folder
CREATE INDEX IF NOT EXISTS idx_daily_missions_folder_order
  ON daily_missions (folder_name, order_index);
