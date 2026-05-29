-- Migration 0046: Save last playback position for video resume
--
-- Adds last_position_seconds to both progress tables so students
-- resume from where they left off instead of restarting from 0.

ALTER TABLE lecture_progress
  ADD COLUMN IF NOT EXISTS last_position_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE live_class_recording_progress
  ADD COLUMN IF NOT EXISTS last_position_seconds INTEGER NOT NULL DEFAULT 0;
