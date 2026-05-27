-- 0031: Keep courses.total_lectures in sync via DB trigger
-- Eliminates full-table COUNT(*) scans during lecture save/conversion flows.

-- Backfill (one-time) so existing deployments are correct immediately.
UPDATE courses c
SET total_lectures = COALESCE((
  SELECT COUNT(*)::int
  FROM lectures l
  WHERE l.course_id = c.id
), 0);

CREATE OR REPLACE FUNCTION public.sync_courses_total_lectures() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.course_id IS NOT NULL THEN
      UPDATE courses
      SET total_lectures = COALESCE(total_lectures, 0) + 1
      WHERE id = NEW.course_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.course_id IS NOT NULL THEN
      UPDATE courses
      SET total_lectures = GREATEST(COALESCE(total_lectures, 0) - 1, 0)
      WHERE id = OLD.course_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.course_id IS DISTINCT FROM OLD.course_id THEN
      IF OLD.course_id IS NOT NULL THEN
        UPDATE courses
        SET total_lectures = GREATEST(COALESCE(total_lectures, 0) - 1, 0)
        WHERE id = OLD.course_id;
      END IF;
      IF NEW.course_id IS NOT NULL THEN
        UPDATE courses
        SET total_lectures = COALESCE(total_lectures, 0) + 1
        WHERE id = NEW.course_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_courses_total_lectures ON lectures;

CREATE TRIGGER trg_sync_courses_total_lectures
AFTER INSERT OR DELETE OR UPDATE OF course_id
ON lectures
FOR EACH ROW
EXECUTE FUNCTION public.sync_courses_total_lectures();

