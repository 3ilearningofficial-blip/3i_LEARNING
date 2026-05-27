-- 0033: Bound replay of the same media token (HTTP range requests on video).

ALTER TABLE media_tokens
  ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0;
