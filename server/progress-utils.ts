/**
 * progress-utils.ts
 * Course progress computation utilities.
 * Extracted from server/routes.ts (Phase 2 refactor — T-06).
 *
 * These functions compute and persist enrollment progress percentages
 * based on how many lectures and tests a student has completed.
 *
 * They are called from 6+ route files via dependency injection,
 * so they accept a db client as a parameter rather than importing it directly.
 */

type DbClient = {
  query: (text: string, params?: unknown[], options?: any) => Promise<{ rows: any[]; rowCount?: number }>;
};

/**
 * Recompute and persist all test-type counts for a course.
 * Called after tests are added, removed, or retyped in a course.
 * Also triggers a full enrollment progress recomputation.
 */
export async function updateCourseTestCounts(
  db: DbClient,
  courseId: number | string
): Promise<void> {
  const id = String(courseId);
  await db.query(
    `UPDATE courses SET
      total_tests    = (SELECT COUNT(*) FROM tests WHERE course_id = $1),
      pyq_count      = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'pyq'),
      mock_count     = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'mock'),
      practice_count = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'practice')
    WHERE id = $1`,
    [id]
  );
  await recomputeAllEnrollmentsProgressForCourse(db, id);
}

/**
 * Recompute course progress for a single user based on ALL content: lectures + tests.
 * Called after a student completes a lecture or test attempt.
 *
 * Note: Live class recordings count as lectures (they become lecture rows
 * when the recording is saved), so they are already included in the lecture count.
 */
export async function updateCourseProgress(
  db: DbClient,
  userId: number,
  courseId: number | string
): Promise<void> {
  const cid = String(courseId);
  try {
    // Count total items
    const totalLec = await db.query(
      "SELECT COUNT(*) FROM lectures WHERE course_id = $1",
      [cid]
    );
    const totalTests = await db.query(
      "SELECT COUNT(*) FROM tests WHERE course_id = $1 AND is_published = TRUE",
      [cid]
    );

    // Count completed items by user
    const completedLec = await db.query(
      `SELECT COUNT(*) FROM lecture_progress lp JOIN lectures l ON lp.lecture_id = l.id
       WHERE lp.user_id = $1 AND l.course_id = $2 AND lp.is_completed = TRUE`,
      [userId, cid]
    );
    const completedTests = await db.query(
      `SELECT COUNT(DISTINCT test_id) FROM test_attempts
       WHERE user_id = $1 AND test_id IN (SELECT id FROM tests WHERE course_id = $2) AND status = 'completed'`,
      [userId, cid]
    );

    const total = parseInt(totalLec.rows[0].count) + parseInt(totalTests.rows[0].count);
    const completed = parseInt(completedLec.rows[0].count) + parseInt(completedTests.rows[0].count);
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    await db.query(
      "UPDATE enrollments SET progress_percent = $1 WHERE user_id = $2 AND course_id = $3",
      [progress, userId, cid]
    );
  } catch (err) {
    console.error("[Progress] Failed to update:", err);
  }
}

/**
 * Re-run progress for every enrolled (active) student in a course.
 * Called when content changes affect all students: new lecture added, test published, etc.
 *
 * Uses a single efficient CROSS JOIN LATERAL query instead of N individual updates.
 * WARNING: At 1000+ enrolled students this query takes several seconds.
 * Phase 4 (T-14) will add a DB index to speed this up.
 */
export async function recomputeAllEnrollmentsProgressForCourse(
  db: DbClient,
  courseId: number | string
): Promise<void> {
  const cid = String(courseId);
  try {
    await db.query(
      `UPDATE enrollments AS e
       SET progress_percent = calc.pct
       FROM (
         SELECT
           en.user_id,
           en.course_id,
           CASE
             WHEN (COALESCE(tl.total_lec, 0) + COALESCE(tt.total_tests, 0)) <= 0 THEN 0
             ELSE LEAST(100, GREATEST(0, ROUND(
               (100.0 * (COALESCE(cl.done_lec, 0) + COALESCE(ct.done_tests, 0)))
               / NULLIF(COALESCE(tl.total_lec, 0) + COALESCE(tt.total_tests, 0), 0)
             )))
           END::integer AS pct
         FROM enrollments en
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::bigint AS total_lec FROM lectures WHERE course_id = $1
         ) tl
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::bigint AS total_tests FROM tests WHERE course_id = $1 AND is_published = TRUE
         ) tt
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::bigint AS done_lec
           FROM lecture_progress lp
           INNER JOIN lectures l ON lp.lecture_id = l.id AND l.course_id = $1
           WHERE lp.user_id = en.user_id AND lp.is_completed = TRUE
         ) cl ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT test_id)::bigint AS done_tests
           FROM test_attempts ta
           WHERE ta.user_id = en.user_id
             AND ta.status = 'completed'
             AND ta.test_id IN (SELECT id FROM tests WHERE course_id = $1)
         ) ct ON TRUE
         WHERE en.course_id::text = $1 AND (en.status = 'active' OR en.status IS NULL)
       ) AS calc
       WHERE e.user_id = calc.user_id AND e.course_id = calc.course_id`,
      [cid]
    );
  } catch (err) {
    console.error("[Progress] recomputeAllEnrollmentsProgressForCourse failed:", err);
  }
}
