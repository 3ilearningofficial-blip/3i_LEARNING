-- Migration 0040: Performance indexes for notifications, notifications_sent, and enrollments
--
-- DQR-01: Without an index on (user_id, created_at), every student notification fetch
--         is a full sequential scan over all their rows. After 1 year at 1,000 students
--         each student may have 500+ rows — unacceptably slow.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- SB-02: The scheduler runs DELETE FROM notifications_sent WHERE sent_at < $1 every 60s.
--        Without an index on sent_at this becomes a full sequential scan.
--        At 260,000+ rows (6 months × 10 classes/week × 1,000 students) this is very slow.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_sent_at
  ON notifications_sent (sent_at);

-- DQR-02: Partial index on enrollments filtered to active rows only.
--         The live notification scheduler queries enrollments WHERE course_id = $1 AND
--         (status = 'active' OR status IS NULL). A partial index covering only active
--         rows is much smaller and faster than a full index on course_id alone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_course_active
  ON enrollments (course_id)
  WHERE status = 'active' OR status IS NULL;

-- Extra: index on notifications (created_at) for the scheduler cleanup DELETE
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_created_at
  ON notifications (created_at);
