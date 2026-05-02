-- Lecture VOD: count debounced "open player" sessions; live class: recording replays + existing viewer heartbeats for live presence.

ALTER TABLE lecture_progress ADD COLUMN IF NOT EXISTS playback_sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lecture_progress ADD COLUMN IF NOT EXISTS last_session_ping_at BIGINT;

CREATE TABLE IF NOT EXISTS live_class_recording_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  live_class_id INTEGER NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  watch_percent INTEGER NOT NULL DEFAULT 0,
  playback_sessions INTEGER NOT NULL DEFAULT 0,
  last_session_ping_at BIGINT,
  updated_at BIGINT,
  PRIMARY KEY (user_id, live_class_id)
);

CREATE INDEX IF NOT EXISTS idx_lc_recording_progress_user ON live_class_recording_progress(user_id);
