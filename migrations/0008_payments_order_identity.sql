-- Multiple checkout rows per user+course; each Razorpay order id must be unique when set.
DROP INDEX IF EXISTS payments_user_course_unique;

CREATE UNIQUE INDEX IF NOT EXISTS payments_razorpay_order_id_unique
  ON payments (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL AND btrim(razorpay_order_id) <> '';

CREATE INDEX IF NOT EXISTS payments_user_course_idx ON payments (user_id, course_id);
