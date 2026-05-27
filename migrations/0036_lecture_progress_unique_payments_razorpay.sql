-- 0036: Add missing uniqueness constraints
--
-- A) lecture_progress(user_id, lecture_id) unique index
--    Without this, a race condition (two near-simultaneous progress saves for the same
--    lecture) creates duplicate rows. The application code relies on a single row per
--    student per lecture for correct progress tracking.
--    Safe approach: delete any true duplicates (keep the row with the highest
--    watch_percent / most recent completed_at) before adding the index.
--
-- B) payments(razorpay_order_id) partial unique index
--    Prevents duplicate payment rows for the same Razorpay order (e.g. double-click
--    on Pay button). Partial index excludes NULL order IDs (legacy / manual grants).

-- ── A: lecture_progress dedup then unique index ──────────────────────────────────────

-- Remove duplicates, keeping the row with the highest watch_percent for each
-- (user_id, lecture_id) pair.  If watch_percent is equal, keep the lower id
-- (the earlier insert, which is less likely to be a stale phantom row).
DELETE FROM lecture_progress lp
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, lecture_id) id
  FROM lecture_progress
  ORDER BY user_id, lecture_id, watch_percent DESC, id ASC
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lecture_progress_user_lecture
  ON lecture_progress (user_id, lecture_id);

-- ── B: payments razorpay_order_id partial unique index ───────────────────────────────

-- Only enforce uniqueness for rows that actually have a Razorpay order ID.
-- NULL means the payment was manually granted by an admin and has no Razorpay order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_order_id
  ON payments (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL AND btrim(razorpay_order_id) <> '';
