CREATE TABLE IF NOT EXISTS runtime_feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS runtime_feature_flags_updated_at_idx
  ON runtime_feature_flags (updated_at DESC);
