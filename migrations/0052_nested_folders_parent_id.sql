-- Migration 0052: Nested folders for course and standalone folder systems
--
-- Adds parent_id to folder tables and backfills existing path-style names
-- such as "Live Class Recordings / Chapter 1" into parent-child rows.
-- Existing content rows keep their legacy section_title/folder_name strings;
-- application queries compute folder full_name from the hierarchy for matching.

ALTER TABLE course_folders
  ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES course_folders(id) ON DELETE CASCADE;

ALTER TABLE standalone_folders
  ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES standalone_folders(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'course_folders_course_id_name_type_key'
      AND conrelid = 'course_folders'::regclass
  ) THEN
    ALTER TABLE course_folders DROP CONSTRAINT course_folders_course_id_name_type_key;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'standalone_folders_name_type_key'
      AND conrelid = 'standalone_folders'::regclass
  ) THEN
    ALTER TABLE standalone_folders DROP CONSTRAINT standalone_folders_name_type_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_folders_sibling_name
  ON course_folders (course_id, type, COALESCE(parent_id, 0), LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS uq_standalone_folders_sibling_name
  ON standalone_folders (type, COALESCE(parent_id, 0), LOWER(name));

CREATE INDEX IF NOT EXISTS idx_course_folders_parent
  ON course_folders (course_id, type, parent_id, order_index);

CREATE INDEX IF NOT EXISTS idx_standalone_folders_parent
  ON standalone_folders (type, parent_id, order_index);

DO $$
DECLARE
  r RECORD;
  parts TEXT[];
  parent_folder_id INTEGER;
  current_folder_id INTEGER;
  part_name TEXT;
  part_index INTEGER;
BEGIN
  FOR r IN
    SELECT id, course_id, type, name
    FROM course_folders
    WHERE parent_id IS NULL AND name LIKE '% / %'
    ORDER BY id
  LOOP
    parts := regexp_split_to_array(r.name, '\s+/\s+');
    parent_folder_id := NULL;

    FOR part_index IN 1..array_length(parts, 1) LOOP
      part_name := NULLIF(BTRIM(parts[part_index]), '');
      IF part_name IS NULL THEN
        CONTINUE;
      END IF;

      IF part_index = array_length(parts, 1) THEN
        UPDATE course_folders
        SET name = part_name,
            parent_id = parent_folder_id
        WHERE id = r.id
        RETURNING id INTO current_folder_id;
      ELSE
        SELECT id INTO current_folder_id
        FROM course_folders
        WHERE course_id = r.course_id
          AND type = r.type
          AND COALESCE(parent_id, 0) = COALESCE(parent_folder_id, 0)
          AND LOWER(name) = LOWER(part_name)
        LIMIT 1;

        IF current_folder_id IS NULL THEN
          INSERT INTO course_folders (course_id, name, type, parent_id, is_hidden, order_index)
          VALUES (r.course_id, part_name, r.type, parent_folder_id, FALSE, 0)
          RETURNING id INTO current_folder_id;
        END IF;
      END IF;

      parent_folder_id := current_folder_id;
      current_folder_id := NULL;
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
  parts TEXT[];
  parent_folder_id INTEGER;
  current_folder_id INTEGER;
  part_name TEXT;
  part_index INTEGER;
BEGIN
  FOR r IN
    SELECT id, type, name
    FROM standalone_folders
    WHERE parent_id IS NULL AND name LIKE '% / %'
    ORDER BY id
  LOOP
    parts := regexp_split_to_array(r.name, '\s+/\s+');
    parent_folder_id := NULL;

    FOR part_index IN 1..array_length(parts, 1) LOOP
      part_name := NULLIF(BTRIM(parts[part_index]), '');
      IF part_name IS NULL THEN
        CONTINUE;
      END IF;

      IF part_index = array_length(parts, 1) THEN
        UPDATE standalone_folders
        SET name = part_name,
            parent_id = parent_folder_id
        WHERE id = r.id
        RETURNING id INTO current_folder_id;
      ELSE
        SELECT id INTO current_folder_id
        FROM standalone_folders
        WHERE type = r.type
          AND COALESCE(parent_id, 0) = COALESCE(parent_folder_id, 0)
          AND LOWER(name) = LOWER(part_name)
        LIMIT 1;

        IF current_folder_id IS NULL THEN
          INSERT INTO standalone_folders (name, type, parent_id, is_hidden, order_index)
          VALUES (part_name, r.type, parent_folder_id, FALSE, 0)
          RETURNING id INTO current_folder_id;
        END IF;
      END IF;

      parent_folder_id := current_folder_id;
      current_folder_id := NULL;
    END LOOP;
  END LOOP;
END $$;
