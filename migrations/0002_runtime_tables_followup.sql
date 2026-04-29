-- Follow-up baseline for tables that should exist via migrations instead of startup mutation.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS media_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

CREATE INDEX IF NOT EXISTS idx_media_tokens_expires
  ON media_tokens(expires_at);

CREATE TABLE IF NOT EXISTS live_class_viewers (
  id SERIAL PRIMARY KEY,
  live_class_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  last_heartbeat BIGINT NOT NULL,
  UNIQUE(live_class_id, user_id)
);

CREATE TABLE IF NOT EXISTS live_class_hand_raises (
  id SERIAL PRIMARY KEY,
  live_class_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  raised_at BIGINT NOT NULL,
  UNIQUE(live_class_id, user_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at BIGINT;

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS valid_until BIGINT;

ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS stream_type TEXT DEFAULT 'rtmp';
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS show_viewer_count BOOLEAN DEFAULT TRUE;
