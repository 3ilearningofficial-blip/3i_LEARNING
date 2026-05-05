-- Production hardening: enforce ON CONFLICT prerequisites and add hot-path indexes.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS user_push_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_active
  ON user_push_tokens(user_id, is_active);

DO $$
BEGIN
  IF to_regclass('public.user_downloads') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS user_downloads_user_item_unique
      ON user_downloads(user_id, item_type, item_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_missions') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS user_missions_user_mission_unique
      ON user_missions(user_id, mission_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_visibility_created
  ON notifications(user_id, is_read, is_hidden, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_class_viewers_class_heartbeat
  ON live_class_viewers(live_class_id, last_heartbeat DESC);

CREATE INDEX IF NOT EXISTS idx_support_messages_user_created
  ON support_messages(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_messages_user_sender_read
  ON support_messages(user_id, sender, is_read);

CREATE INDEX IF NOT EXISTS idx_payments_user_course_status_created
  ON payments(user_id, course_id, status, created_at DESC);
