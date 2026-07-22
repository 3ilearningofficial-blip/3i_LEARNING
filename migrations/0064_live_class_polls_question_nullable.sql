-- Live class polls: make `question` nullable.
--
-- Teachers frequently write the actual question on the whiteboard and use
-- the poll UI only to collect answers (A/B/C/D). The old NOT NULL forced
-- them to type a placeholder question every time, which was clumsy on
-- phone-web and blocked "board question + poll options only" flows.
--
-- Idempotent: safe to re-run.

ALTER TABLE live_class_polls
  ALTER COLUMN question DROP NOT NULL;
