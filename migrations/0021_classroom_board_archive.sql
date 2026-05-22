ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS board_pdf_url TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS board_pages_json TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS board_sync_checkpoint_url TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS board_checkpoint_at BIGINT;
