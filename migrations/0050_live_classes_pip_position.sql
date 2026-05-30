-- Teacher picture-in-picture corner for interactive classroom.
-- Students and the saved recording render the teacher PiP in this corner.
-- Values: 'top-right' (default) or 'bottom-right'.
ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS pip_position TEXT DEFAULT 'top-right';
