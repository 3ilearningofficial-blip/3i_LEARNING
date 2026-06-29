-- Staff concurrent sessions: one active token per platform family (web + mobile).
-- Student web registration columns were added in 0006_web_dual_device_slots.sql.

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS platform_family TEXT;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_platform
  ON user_sessions (user_id, platform_family);
