-- Migration 0045: Auth performance indexes
--
-- PROBLEM 1: Every Bearer-token request for an admin user hits this query:
--   SELECT u.*, s.device_id FROM users u
--   INNER JOIN user_sessions s ON s.user_id = u.id AND s.session_token = $1
-- Without an index on user_sessions.session_token this is a full table scan.
-- At 10 admin logins × N devices this is small now, but latency is 1400ms+
-- because Neon cold-starts a connection and then scans the table.
CREATE INDEX IF NOT EXISTS idx_user_sessions_session_token
  ON user_sessions (session_token);

-- PROBLEM 2: The 30-min notification scheduler runs every 60 seconds:
--   SELECT ... FROM live_classes WHERE is_completed IS NOT TRUE
--     AND is_live IS NOT TRUE AND notify_bell = TRUE
--     AND scheduled_at BETWEEN $1 AND $2
-- The existing index in 0030 is partial (COALESCE(is_recording_mode,FALSE)=FALSE)
-- and covers (is_live, scheduled_at). That partial condition may cause the planner
-- to skip the index for this query. A plain index on scheduled_at lets the planner
-- pick the cheapest plan regardless of recording_mode.
CREATE INDEX IF NOT EXISTS idx_live_classes_scheduled_at
  ON live_classes (scheduled_at)
  WHERE scheduled_at IS NOT NULL;
