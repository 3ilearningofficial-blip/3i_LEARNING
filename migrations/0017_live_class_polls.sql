CREATE TABLE IF NOT EXISTS live_class_polls (
  id SERIAL PRIMARY KEY,
  live_class_id INTEGER NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('poll', 'quiz')),
  question TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  correct_option_id INTEGER,
  started_at BIGINT NOT NULL,
  ends_at BIGINT NOT NULL,
  ended_at BIGINT,
  created_by INTEGER,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE TABLE IF NOT EXISTS live_class_poll_options (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES live_class_polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE live_class_polls
  ADD CONSTRAINT live_class_polls_correct_option_fk
  FOREIGN KEY (correct_option_id) REFERENCES live_class_poll_options(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS live_class_poll_votes (
  poll_id INTEGER NOT NULL REFERENCES live_class_polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  option_id INTEGER NOT NULL REFERENCES live_class_poll_options(id) ON DELETE CASCADE,
  voted_at BIGINT NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS live_class_activity_timers (
  id SERIAL PRIMARY KEY,
  live_class_id INTEGER NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  started_at BIGINT NOT NULL,
  ends_at BIGINT NOT NULL,
  ended_at BIGINT,
  created_by INTEGER,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_live_class_polls_class_active
  ON live_class_polls (live_class_id, ends_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_class_activity_timers_class_active
  ON live_class_activity_timers (live_class_id, ends_at DESC);
