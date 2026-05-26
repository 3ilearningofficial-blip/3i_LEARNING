-- Migration 0026: Record a Class feature
--
-- Adds two columns to live_classes:
--
--   is_recording_mode (BOOLEAN, default FALSE):
--     Marks a session as a private recording-only session. These sessions are
--     never visible to students as "live" or "upcoming" classes. After the
--     admin stops recording, the video is saved to R2 and converted into a
--     course lecture automatically (same path as the existing webrtc recording flow).
--
--   visible_after_at (BIGINT, nullable, ms timestamp):
--     If set on a recording-mode session, the resulting course lecture will NOT
--     be shown to students until this timestamp has elapsed.
--     NULL = lecture becomes visible immediately when recording is finalized.
--
-- Adds one column to lectures:
--
--   visible_after_at (BIGINT, nullable, ms timestamp):
--     Inherited from live_classes.visible_after_at when saveRecordingForClassAndPeers()
--     creates the lecture row. Student-facing course queries gate on this field.
--     NULL = always visible (default for all existing and manual lectures).
--
-- All guards use IF NOT EXISTS so this script is safe to re-run.

ALTER TABLE live_classes
  ADD COLUMN IF NOT EXISTS is_recording_mode BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE live_classes
  ADD COLUMN IF NOT EXISTS visible_after_at BIGINT NULL;

ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS visible_after_at BIGINT NULL;

-- Index for efficient lookup of scheduled-visibility lectures
-- (used when students load course content and the server must filter hidden lectures).
CREATE INDEX IF NOT EXISTS idx_lectures_visible_after_at
  ON lectures (visible_after_at)
  WHERE visible_after_at IS NOT NULL;
