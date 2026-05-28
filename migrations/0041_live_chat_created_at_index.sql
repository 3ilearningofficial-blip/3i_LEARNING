-- Migration 0041: Index on live_chat_messages for paginated chat fetch
--
-- SB-04: The chat fetch queries filter by live_class_id and order/filter by
--        created_at. Without this index each query does a sequential scan over
--        all messages for the class. A 2-hour class with 5,000+ messages makes
--        this index critical for fast initial load and scroll-up pagination.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_live_chat_messages_class_created
  ON live_chat_messages (live_class_id, created_at ASC);
