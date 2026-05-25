-- T-11: Partial index on live_classes.scheduled_at
-- Eliminates the full table scan in the live class notification scheduler
-- (runs every 60s — was taking 1.2-1.3s without this index).
--
-- IF NOT EXISTS: safe to re-run if the index already exists.
-- Partial WHERE clause matches the exact WHERE used by the scheduler query,
-- so PostgreSQL can use this index for that query and skip rows it will never need.
--
-- Note: CONCURRENTLY is omitted because this runner executes migrations inside
-- a transaction (BEGIN/COMMIT), and PostgreSQL forbids CONCURRENTLY in a
-- transaction block. The live_classes table is small (hundreds of rows) so a
-- regular CREATE INDEX completes in milliseconds with a brief share lock —
-- no students will notice.

CREATE INDEX IF NOT EXISTS idx_live_classes_scheduled_at
  ON live_classes (scheduled_at)
  WHERE is_completed IS NOT TRUE
    AND is_live IS NOT TRUE
    AND notify_bell = TRUE;
