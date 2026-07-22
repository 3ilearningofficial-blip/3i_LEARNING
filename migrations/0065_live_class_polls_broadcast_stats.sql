-- Live class polls: track when a poll's stats are being broadcast to students.
--
-- The admin has a "Show stats to students" toggle in the post-poll view. When
-- flipped on, the live class server emits `stats_show` on the engagement SSE
-- channel and the students overlay the percentage bars + top-10 leaderboard.
-- Flipping it off (or ending the class) clears the field.
--
-- `broadcast_stats` stores the timestamp when broadcasting began; NULL means
-- no active broadcast. Bigint milliseconds matches every other timestamp in
-- this schema (see 0000_core_schema_baseline.sql).
--
-- Idempotent: safe to re-run.

ALTER TABLE live_class_polls
  ADD COLUMN IF NOT EXISTS broadcast_stats BIGINT;
