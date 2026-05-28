-- Migration 0040b: Create live_chat_messages table
--
-- The live_chat_messages table was used in production (via doubt-notification-routes.ts
-- and live class routes) and referenced by:
--   0011_distributed_rate_limits_and_session.sql  (pg_notify trigger)
--   0041_live_chat_created_at_index.sql            (performance index)
-- but no migration ever issued CREATE TABLE live_chat_messages.
--
-- In CI the fresh Postgres database applies migrations in sorted order.
-- Without this file, migration 0041 fails with:
--   ERROR: relation "live_chat_messages" does not exist
-- because it tries to CREATE INDEX on a table that was never created.
--
-- Using CREATE TABLE IF NOT EXISTS makes this safe on production
-- where the table already exists.
CREATE TABLE IF NOT EXISTS live_chat_messages (
  id           SERIAL PRIMARY KEY,
  live_class_id INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  user_name     TEXT NOT NULL,
  message       TEXT NOT NULL,
  is_admin      BOOLEAN DEFAULT FALSE,
  created_at    BIGINT
);
