-- Client-uploaded tldraw JSON checkpoints (full https URL). Kept separate from
-- server auto-checkpoints (board-checkpoints/* keys in board_sync_checkpoint_url).
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS board_client_checkpoint_url TEXT;
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS board_client_checkpoint_at BIGINT;
