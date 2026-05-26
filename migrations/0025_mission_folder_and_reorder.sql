-- Migration 0025: Mission folders + course content reordering
--
-- Part A: Add folder_name to daily_missions
--   Allows admin to group missions into named buckets (e.g. "Free Drills",
--   "CDS Paid Missions", "Upcoming — June 2026"). NULL = ungrouped.
--   IF NOT EXISTS guard makes this safe to re-run.
--
-- Part B: Add order_index to tests and study_materials
--   Lectures already have order_index. Tests and materials did not.
--   Default 0 so all existing rows are valid immediately after migration.
--   No data loss; existing ordering (created_at DESC) remains the tiebreak
--   until admin explicitly sets an order.

-- Part A --
ALTER TABLE daily_missions
  ADD COLUMN IF NOT EXISTS folder_name TEXT;

-- Part B --
ALTER TABLE tests
  ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;

ALTER TABLE study_materials
  ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;

-- Index for efficient folder-based listing of missions
CREATE INDEX IF NOT EXISTS idx_daily_missions_folder
  ON daily_missions (folder_name)
  WHERE folder_name IS NOT NULL;

-- Index for course content ordering (tests)
CREATE INDEX IF NOT EXISTS idx_tests_course_order
  ON tests (course_id, order_index);

-- Index for course content ordering (study_materials)
CREATE INDEX IF NOT EXISTS idx_study_materials_course_order
  ON study_materials (course_id, order_index);
