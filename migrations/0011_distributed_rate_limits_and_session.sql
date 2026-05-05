-- Distributed rate limit buckets (express-rate-limit + support caps)
CREATE TABLE IF NOT EXISTS express_rate_limit (
  bucket_key TEXT PRIMARY KEY,
  total_hits INT NOT NULL DEFAULT 0,
  reset_time_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_express_rate_limit_reset ON express_rate_limit (reset_time_ms);

-- connect-pg-simple session store (created here instead of runtime DDL in production)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
  ) THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Push new live chat rows to SSE listeners (payload is JSON text)
CREATE OR REPLACE FUNCTION live_chat_messages_notify_fn() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'live_chat',
    json_build_object(
      'liveClassId', NEW.live_class_id,
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
    WHERE table_schema = 'public' AND table_name = 'live_chat_messages'
  ) THEN
    DROP TRIGGER IF EXISTS trg_live_chat_messages_notify ON live_chat_messages;
    CREATE TRIGGER trg_live_chat_messages_notify
    AFTER INSERT ON live_chat_messages
    FOR EACH ROW EXECUTE PROCEDURE live_chat_messages_notify_fn();
  END IF;
END $$;
