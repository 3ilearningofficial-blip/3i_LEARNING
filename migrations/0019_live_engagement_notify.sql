-- NOTIFY subscribers (SSE) when polls, activity timers, or hand raises change.

CREATE OR REPLACE FUNCTION live_engagement_notify_fn() RETURNS trigger AS $$
DECLARE
  lc_id TEXT;
  evt_type TEXT;
BEGIN
  IF TG_TABLE_NAME = 'live_class_polls' THEN
    lc_id := NEW.live_class_id::text;
    evt_type := 'poll';
  ELSIF TG_TABLE_NAME = 'live_class_activity_timers' THEN
    lc_id := NEW.live_class_id::text;
    evt_type := 'timer';
  ELSIF TG_TABLE_NAME = 'live_class_hand_raises' THEN
    lc_id := NEW.live_class_id::text;
    evt_type := 'hand_raise';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM pg_notify(
    'live_engagement',
    json_build_object(
      'type', evt_type,
      'liveClassId', lc_id
    )::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'live_class_polls'
  ) THEN
    DROP TRIGGER IF EXISTS trg_live_class_polls_engagement_notify ON live_class_polls;
    CREATE TRIGGER trg_live_class_polls_engagement_notify
    AFTER INSERT ON live_class_polls
    FOR EACH ROW EXECUTE PROCEDURE live_engagement_notify_fn();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'live_class_activity_timers'
  ) THEN
    DROP TRIGGER IF EXISTS trg_live_class_activity_timers_engagement_notify ON live_class_activity_timers;
    CREATE TRIGGER trg_live_class_activity_timers_engagement_notify
    AFTER INSERT ON live_class_activity_timers
    FOR EACH ROW EXECUTE PROCEDURE live_engagement_notify_fn();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'live_class_hand_raises'
  ) THEN
    DROP TRIGGER IF EXISTS trg_live_class_hand_raises_engagement_notify ON live_class_hand_raises;
    CREATE TRIGGER trg_live_class_hand_raises_engagement_notify
    AFTER INSERT OR UPDATE ON live_class_hand_raises
    FOR EACH ROW EXECUTE PROCEDURE live_engagement_notify_fn();
  END IF;
END $$;
