-- Migration 0059: subject_key on daily_missions for multisubject course missions
ALTER TABLE daily_missions
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

CREATE INDEX IF NOT EXISTS idx_daily_missions_course_subject
  ON daily_missions (course_id, subject_key);
