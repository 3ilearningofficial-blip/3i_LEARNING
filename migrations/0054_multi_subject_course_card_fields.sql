-- Migration 0054: Multi-subject course card display fields

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS course_language TEXT,
  ADD COLUMN IF NOT EXISTS batch_status TEXT;
