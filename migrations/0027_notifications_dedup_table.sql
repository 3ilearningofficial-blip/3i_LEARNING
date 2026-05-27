-- Migration 0027: Persistent notification deduplication table
-- Replaces the in-memory sentNotifications Set which could lose state
-- on server restart and doesn't work across multiple instances.

CREATE TABLE IF NOT EXISTS notifications_sent (
  id BIGSERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'upcoming',
  sent_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_sent_dedup
  ON notifications_sent (class_id, user_id, type);

CREATE INDEX IF NOT EXISTS idx_notifications_sent_cleanup
  ON notifications_sent (sent_at);
