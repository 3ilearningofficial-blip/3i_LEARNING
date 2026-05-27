-- 0028: Media-token hot path normalization columns
-- Removes regexp_replace from the token mint request query by moving it
-- into generated STORED columns + indexes.

-- lectures.video_url_normalized / lectures.pdf_url_normalized
ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS video_url_normalized TEXT
  GENERATED ALWAYS AS (
    regexp_replace(
      regexp_replace(COALESCE(video_url, ''), '^https?://[^/]+/', ''),
      '^/+',
      ''
    )
  ) STORED;

ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS pdf_url_normalized TEXT
  GENERATED ALWAYS AS (
    regexp_replace(
      regexp_replace(COALESCE(pdf_url, ''), '^https?://[^/]+/', ''),
      '^/+',
      ''
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_lectures_video_url_normalized
  ON lectures (video_url_normalized);
CREATE INDEX IF NOT EXISTS idx_lectures_pdf_url_normalized
  ON lectures (pdf_url_normalized);

-- live_classes.recording_url_normalized
ALTER TABLE live_classes
  ADD COLUMN IF NOT EXISTS recording_url_normalized TEXT
  GENERATED ALWAYS AS (
    regexp_replace(
      regexp_replace(COALESCE(recording_url, ''), '^https?://[^/]+/', ''),
      '^/+',
      ''
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_live_classes_recording_url_normalized
  ON live_classes (recording_url_normalized);

-- study_materials.file_url_normalized
ALTER TABLE study_materials
  ADD COLUMN IF NOT EXISTS file_url_normalized TEXT
  GENERATED ALWAYS AS (
    regexp_replace(
      regexp_replace(COALESCE(file_url, ''), '^https?://[^/]+/', ''),
      '^/+',
      ''
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_study_materials_file_url_normalized
  ON study_materials (file_url_normalized);

