-- NOTIFY on UPDATE for activity timers (position, expiry) and polls (end/expiry).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'live_class_polls'
  ) THEN
    DROP TRIGGER IF EXISTS trg_live_class_polls_engagement_notify ON live_class_polls;
    CREATE TRIGGER trg_live_class_polls_engagement_notify
    AFTER INSERT OR UPDATE ON live_class_polls
    FOR EACH ROW EXECUTE PROCEDURE live_engagement_notify_fn();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'live_class_activity_timers'
  ) THEN
    DROP TRIGGER IF EXISTS trg_live_class_activity_timers_engagement_notify ON live_class_activity_timers;
    CREATE TRIGGER trg_live_class_activity_timers_engagement_notify
    AFTER INSERT OR UPDATE ON live_class_activity_timers
    FOR EACH ROW EXECUTE PROCEDURE live_engagement_notify_fn();
  END IF;
END $$;
