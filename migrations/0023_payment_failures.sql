-- 0023_payment_failures.sql
-- Creates the payment_failures audit table.
--
-- This table was previously created at runtime via CREATE TABLE IF NOT EXISTS
-- inside server/payment-routes.ts. That approach bypassed the migration system
-- and required the DB user to have CREATE TABLE privileges at runtime.
-- Moving it here keeps the schema fully version-controlled.
--
-- IF NOT EXISTS is safe: the table already exists in production, so this
-- migration is a no-op on live servers and creates it fresh on new deployments.

CREATE TABLE IF NOT EXISTS payment_failures (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER,
  course_id           INTEGER,
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  source              TEXT,
  reason              TEXT,
  raw_error           TEXT,
  created_at          BIGINT NOT NULL
);
