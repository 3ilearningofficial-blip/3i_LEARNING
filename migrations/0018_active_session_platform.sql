-- Track which platform family (web vs mobile) holds the student's single active session.

ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_platform TEXT;
