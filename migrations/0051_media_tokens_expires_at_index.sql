-- Migration 0051: media_tokens expires_at cleanup index
--
-- PROBLEM: The MediaTokenCleanup scheduler runs every 5 minutes:
--   DELETE FROM media_tokens WHERE expires_at < $1
-- Without an index on expires_at this is a full table scan, logged as a
-- [DB] Slow query (~400ms on Neon). It is a background sweep (not user-facing),
-- but the index lets the planner range-scan only the expired rows and removes
-- the slow-query log noise.
CREATE INDEX IF NOT EXISTS idx_media_tokens_expires_at
  ON media_tokens (expires_at);
