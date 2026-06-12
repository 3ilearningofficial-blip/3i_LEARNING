-- Migration 0053: Multi-subject course metadata and subject-scoped content
--
-- Adds optional metadata for the new multi-subject course experience while
-- preserving existing single-subject course behavior. Content remains in the
-- existing lectures/tests/study_materials/live_classes tables, with subject_key
-- used only when a course is configured as multi-subject.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS teacher_bio TEXT,
  ADD COLUMN IF NOT EXISTS teacher_image_url TEXT,
  ADD COLUMN IF NOT EXISTS teacher_details_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS multi_subject_config JSONB DEFAULT '[]'::jsonb;

ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

ALTER TABLE study_materials
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

ALTER TABLE tests
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

ALTER TABLE live_classes
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

ALTER TABLE course_folders
  ADD COLUMN IF NOT EXISTS subject_key TEXT;

DROP INDEX IF EXISTS uq_course_folders_sibling_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_folders_sibling_name
  ON course_folders (course_id, type, (COALESCE(subject_key, '')), (COALESCE(parent_id, 0)), LOWER(name));

CREATE INDEX IF NOT EXISTS idx_lectures_course_subject
  ON lectures (course_id, subject_key, order_index);

CREATE INDEX IF NOT EXISTS idx_study_materials_course_subject
  ON study_materials (course_id, subject_key, order_index);

CREATE INDEX IF NOT EXISTS idx_tests_course_subject
  ON tests (course_id, subject_key, test_type, order_index);

CREATE INDEX IF NOT EXISTS idx_live_classes_course_subject
  ON live_classes (course_id, subject_key, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_course_folders_course_type_subject
  ON course_folders (course_id, type, subject_key, parent_id, order_index);
