-- 0029: Reliable offline-download cleanup retry flag
-- When download cleanup fails during enrollment revocation, we keep the
-- enrollment row and set `download_cleanup_pending = TRUE` so the scheduler
-- can retry cleanup later.

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS download_cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_enrollments_download_cleanup_pending
  ON enrollments (download_cleanup_pending);

