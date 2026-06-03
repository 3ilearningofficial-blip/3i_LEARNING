-- Migration 0044: Create doubts table
--
-- The doubts table was present in shared/schema.ts and used by doubt-notification-routes.ts
-- via raw SQL (INSERT/SELECT/DELETE) but was never added to the SQL migration chain.
-- In CI the fresh Postgres database only sees what migrations create, so drizzle-kit's
-- drift check detected a missing table and failed (AW-02).
-- Using CREATE TABLE IF NOT EXISTS makes this safe to run against production (table already exists).
CREATE TABLE IF NOT EXISTS doubts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER,
  question    TEXT NOT NULL,
  answer      TEXT,
  topic       TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  BIGINT
);
