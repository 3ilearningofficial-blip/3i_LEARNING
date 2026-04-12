-- Cleanup Script: Mark orphaned live classes as completed
-- Run this directly in your database console

-- 1. First, check which live classes will be affected
SELECT 
  id,
  title,
  TO_TIMESTAMP(scheduled_at / 1000) as scheduled_time,
  TO_TIMESTAMP(created_at / 1000) as created_time,
  ROUND((EXTRACT(EPOCH FROM NOW()) * 1000 - scheduled_at) / (1000 * 60 * 60)) as hours_ago,
  is_live,
  is_completed
FROM live_classes
WHERE is_live = true
ORDER BY scheduled_at DESC;

-- 2. Mark all orphaned live classes as completed
-- Uncomment the line below to execute:
-- UPDATE live_classes SET is_live = false, is_completed = true WHERE is_live = true;

-- 3. Verify the update
-- SELECT COUNT(*) as still_live FROM live_classes WHERE is_live = true;
