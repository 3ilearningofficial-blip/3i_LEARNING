-- One enrollment row per (user, course); enables INSERT ... ON CONFLICT for idempotent paid flows.
DELETE FROM enrollments a
USING enrollments b
WHERE a.user_id IS NOT NULL
  AND b.user_id IS NOT NULL
  AND a.course_id IS NOT NULL
  AND b.course_id IS NOT NULL
  AND a.user_id = b.user_id
  AND a.course_id = b.course_id
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_user_course_unique
ON enrollments (user_id, course_id);
