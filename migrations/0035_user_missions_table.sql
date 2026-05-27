-- 0035: user_missions table
-- Records each student's completion of a daily_mission.
-- This table exists on production (pushed via drizzle-kit historically) but was never
-- codified as a migration. Adding it here so CI / staging / new environments work cleanly.
-- All statements are idempotent (IF NOT EXISTS / DO NOTHING).

CREATE TABLE IF NOT EXISTS user_missions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id    INTEGER NOT NULL REFERENCES daily_missions(id) ON DELETE CASCADE,
  is_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  score         INTEGER,
  completed_at  BIGINT,
  time_taken    INTEGER DEFAULT 0,
  answers       JSONB DEFAULT '{}'::jsonb,
  incorrect     INTEGER DEFAULT 0,
  skipped       INTEGER DEFAULT 0,
  created_at    BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- Unique constraint: one attempt record per student per mission.
-- ON CONFLICT (user_id, mission_id) DO UPDATE is used in student-mission-material-routes.ts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_missions_user_mission
  ON user_missions (user_id, mission_id);

-- Fast lookup for a student's completed missions in bulk (used by the student dashboard).
CREATE INDEX IF NOT EXISTS idx_user_missions_user_id
  ON user_missions (user_id);
