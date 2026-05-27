CREATE TABLE IF NOT EXISTS live_stream_finalize_jobs (
  id BIGSERIAL PRIMARY KEY,
  live_class_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS live_stream_finalize_jobs_live_class_unique_idx
  ON live_stream_finalize_jobs (live_class_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS live_stream_finalize_jobs_schedule_idx
  ON live_stream_finalize_jobs (status, next_attempt_at);
