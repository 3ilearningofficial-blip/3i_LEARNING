-- SEC-04: Admin session device binding.
-- Adds a device_id column to user_sessions so each admin session token is
-- bound to the device/browser that created it.  A token presented from a
-- different device is rejected, preventing session-token replay attacks.

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS device_id TEXT;

-- Index speeds up the per-request device_id lookup for admin auth.
CREATE INDEX IF NOT EXISTS idx_user_sessions_device_id
  ON user_sessions (user_id, device_id)
  WHERE device_id IS NOT NULL;
