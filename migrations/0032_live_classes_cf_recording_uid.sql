-- 0032: Store Cloudflare recording UID on live_classes for reliable re-archiving.

ALTER TABLE live_classes
  ADD COLUMN IF NOT EXISTS cf_recording_uid TEXT;

CREATE INDEX IF NOT EXISTS idx_live_classes_cf_recording_uid
  ON live_classes (cf_recording_uid);

