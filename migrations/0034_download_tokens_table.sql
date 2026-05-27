-- 0034: download_tokens table for secure offline downloads
-- Used by /api/download-url and background cleanup scheduler.

CREATE TABLE IF NOT EXISTS download_tokens (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  r2_key TEXT,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  expires_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_download_tokens_token
  ON download_tokens (token);

CREATE INDEX IF NOT EXISTS idx_download_tokens_expires_at
  ON download_tokens (expires_at);

