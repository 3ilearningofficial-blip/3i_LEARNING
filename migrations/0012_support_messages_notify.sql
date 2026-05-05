-- NOTIFY subscribers (SSE) when support thread rows change
CREATE OR REPLACE FUNCTION support_messages_notify_fn() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'support_chat',
    json_build_object(
      'userId', NEW.user_id,
      'id', NEW.id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'support_messages'
  ) THEN
    DROP TRIGGER IF EXISTS trg_support_messages_notify ON support_messages;
    CREATE TRIGGER trg_support_messages_notify
    AFTER INSERT ON support_messages
    FOR EACH ROW EXECUTE PROCEDURE support_messages_notify_fn();
  END IF;
END $$;
