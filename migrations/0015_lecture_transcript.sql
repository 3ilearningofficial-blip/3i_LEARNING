-- Optional full-text transcript for lectures (used server-side by AI Tutor context).
-- Safe to re-run.

ALTER TABLE lectures ADD COLUMN IF NOT EXISTS transcript TEXT;
