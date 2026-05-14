-- Per-user OTP send throttle (3 OTP sends per cycle, 2 minutes between sends,
-- then 24h lock) and a staging table for unverified phone/email registrations
-- staging table for unverified phone/email registrations so we no longer create
-- a `users` row at /api/auth/send-otp time. Only after the OTP is verified AND
-- the profile-setup screen is saved do we INSERT into `users`.
--
-- Safe to re-run.

-- Throttle counters live on the users row for already-known accounts (so OTP
-- resends for existing users are throttled) and on otp_challenges for unknown
-- phones/emails (before any users row exists).
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_send_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_send_window_start BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_send_locked_until BIGINT;

-- Track unverified registrations (phone or email) without polluting the users
-- table. Identifier is normalized: 10-digit phone or lowercased email.
CREATE TABLE IF NOT EXISTS otp_challenges (
  identifier TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('phone', 'email')),
  otp_hash TEXT,
  otp_expires_at BIGINT,
  verify_failed_attempts INTEGER NOT NULL DEFAULT 0,
  verify_locked_until BIGINT,
  send_count INTEGER NOT NULL DEFAULT 0,
  send_window_start BIGINT,
  send_locked_until BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_otp_challenges_updated_at ON otp_challenges (updated_at);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_type ON otp_challenges (type);
