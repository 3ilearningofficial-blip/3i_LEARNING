-- Baseline hardening migration (idempotent).
-- Safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS app_bound_device_id TEXT;

CREATE TABLE IF NOT EXISTS device_block_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempted_device_id TEXT,
  bound_device_id TEXT,
  phone TEXT,
  email TEXT,
  platform TEXT,
  reason TEXT DEFAULT 'wrong_device_login_denied',
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

CREATE INDEX IF NOT EXISTS idx_device_block_events_created
  ON device_block_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_session_token
  ON users(session_token);
