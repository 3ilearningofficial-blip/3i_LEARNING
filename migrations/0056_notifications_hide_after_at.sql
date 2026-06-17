-- Migration 0056: deferred hide time for auto notifications after student tap
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS hide_after_at BIGINT;

CREATE INDEX IF NOT EXISTS idx_notifications_user_hide_after
  ON notifications (user_id, hide_after_at)
  WHERE hide_after_at IS NOT NULL;
