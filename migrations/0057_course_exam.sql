-- Migration 0057: exam field for test series courses (NDA/CDS/AFCAT etc.)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS exam TEXT DEFAULT '';
