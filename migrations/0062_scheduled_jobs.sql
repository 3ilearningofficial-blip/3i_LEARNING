-- Event-driven scheduled jobs (Phase 2): live class reminders at exact run_at times.
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  ref_id BIGINT NOT NULL,
  run_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_type_ref_uidx
  ON scheduled_jobs (job_type, ref_id);

CREATE INDEX IF NOT EXISTS scheduled_jobs_pending_run_at_idx
  ON scheduled_jobs (run_at)
  WHERE status = 'pending';

-- Backfill 30-minute reminder jobs for existing future live classes.
INSERT INTO scheduled_jobs (job_type, ref_id, run_at, status, created_at, updated_at)
SELECT
  'live_class_reminder_30min',
  lc.id,
  lc.scheduled_at - (30 * 60 * 1000),
  'pending',
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
FROM live_classes lc
WHERE lc.notify_bell = TRUE
  AND lc.scheduled_at IS NOT NULL
  AND lc.scheduled_at > (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  AND COALESCE(lc.is_completed, FALSE) IS NOT TRUE
  AND COALESCE(lc.is_live, FALSE) IS NOT TRUE
  AND COALESCE(lc.is_recording_mode, FALSE) IS NOT TRUE
ON CONFLICT (job_type, ref_id) DO UPDATE SET
  run_at = EXCLUDED.run_at,
  status = CASE
    WHEN scheduled_jobs.status = 'running' THEN 'running'
    WHEN scheduled_jobs.status = 'done' AND scheduled_jobs.run_at = EXCLUDED.run_at THEN 'done'
    ELSE 'pending'
  END,
  updated_at = EXCLUDED.updated_at;
