-- 0030: Index for upcoming / cached live class listings
-- Improves the `/api/upcoming-classes` query by supporting the sort on
-- (is_live DESC, scheduled_at ASC NULLS LAST) without scanning the full table.

CREATE INDEX IF NOT EXISTS idx_live_classes_is_live_scheduled_at
  ON live_classes (is_live, scheduled_at)
  WHERE is_completed IS NOT TRUE
    AND COALESCE(is_recording_mode, FALSE) = FALSE;

