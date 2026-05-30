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
  const id = Number(courseId);
  if (!Number.isFinite(id)) {
    console.warn("[Progress] updateCourseTestCounts skipped invalid courseId:", courseId);
    return;
  }
  await db.query(
    `UPDATE courses SET
      total_tests    = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int),
      pyq_count      = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'pyq'),
      mock_count     = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'mock'),
      practice_count = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'practice')
    WHERE id = $1::int`,
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
 *
 * @param runTx  Optional transaction runner. When provided, all 4 queries run inside
 *               a single transaction with SELECT FOR UPDATE on the enrollment row,
 *               preventing concurrent updates for the same user+course from racing.
 *               Call sites that don't supply runTx continue working as before.
 */
export async function updateCourseProgress(
  db: DbClient,
  userId: number,
  courseId: number | string,
  runTx?: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>
): Promise<void> {
  const cid = Number(courseId);
  if (!Number.isFinite(cid)) {
    console.warn("[Progress] updateCourseProgress skipped invalid courseId:", courseId);
    return;
  }

  const doUpdate = async (client: DbClient) => {
    // Acquire a row-level lock on the enrollment to prevent concurrent progress
    // updates for the same user+course from racing and overwriting each other.
    // If no enrollment exists yet, the lock is a no-op and we proceed safely.
    if (runTx) {
      await client.query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2::int FOR UPDATE",
        [userId, cid]
      );
    }

    const totalLec = await client.query(
      `SELECT COUNT(*) FROM lectures
       WHERE course_id = $1::int
       AND (visible_after_at IS NULL OR visible_after_at <= EXTRACT(EPOCH FROM NOW()) * 1000)`,
      [cid]
    );
    const totalTests = await client.query(
      "SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND is_published = TRUE",
      [cid]
    );
    const completedLec = await client.query(
      `SELECT COUNT(*) FROM lecture_progress lp JOIN lectures l ON lp.lecture_id = l.id
       WHERE lp.user_id = $1 AND l.course_id = $2::int AND lp.is_completed = TRUE`,
      [userId, cid]
    );
    const completedTests = await client.query(
      `SELECT COUNT(DISTINCT test_id) FROM test_attempts
       WHERE user_id = $1 AND test_id IN (SELECT id FROM tests WHERE course_id = $2::int) AND status = 'completed'`,
      [userId, cid]
    );

    const total = parseInt(totalLec.rows[0].count) + parseInt(totalTests.rows[0].count);
    const completed = parseInt(completedLec.rows[0].count) + parseInt(completedTests.rows[0].count);
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    await client.query(
      "UPDATE enrollments SET progress_percent = $1 WHERE user_id = $2 AND course_id = $3::int",
      [progress, userId, cid]
    );
  };

  try {
    if (runTx) {
      await runTx((tx) => doUpdate(tx));
    } else {
      await doUpdate(db);
    }
  } catch (err) {
    console.error("[Progress] Failed to update:", err);
  }
}

/**
 * Re-run progress for every enrolled (active) student in a course.
 * Called when content changes affect all students: new lecture added, test published, etc.
 *
 * BUG-13 fix: replaced CROSS JOIN LATERAL with CTEs so that:
 *   - total_lec and total_tests are computed once (not once per student)
 *   - lec_done aggregates all students in a single table scan
 *   - tests_done aggregates all students in a single table scan via JOIN (not IN subquery)
 * This changes O(N) correlated subqueries into O(1) CTEs + O(N) single-pass joins.
 */
export async function recomputeAllEnrollmentsProgressForCourse(
  db: DbClient,
  courseId: number | string
): Promise<void> {
  const cid = Number(courseId);
  if (!Number.isFinite(cid)) {
    console.warn("[Progress] recomputeAllEnrollmentsProgressForCourse skipped invalid courseId:", courseId);
    return;
  }
  try {
    await db.query(
      `WITH
         -- Course-level totals — computed once, not once per student
         total_lec AS (
           SELECT COUNT(*)::bigint AS n FROM lectures WHERE course_id = $1::int
         ),
         total_tests AS (
           SELECT COUNT(*)::bigint AS n FROM tests WHERE course_id = $1::int AND is_published = TRUE
         ),
         -- Per-student lecture completions — single table scan across all students
         lec_done AS (
           SELECT lp.user_id, COUNT(*)::bigint AS n
           FROM lecture_progress lp
           JOIN lectures l ON lp.lecture_id = l.id AND l.course_id = $1::int
           WHERE lp.is_completed = TRUE
           GROUP BY lp.user_id
         ),
         -- Per-student test completions — single table scan via JOIN instead of IN (SELECT)
         tests_done AS (
           SELECT ta.user_id, COUNT(DISTINCT ta.test_id)::bigint AS n
           FROM test_attempts ta
           JOIN tests t ON ta.test_id = t.id AND t.course_id = $1::int AND t.is_published = TRUE
           WHERE ta.status = 'completed'
           GROUP BY ta.user_id
         )
       UPDATE enrollments AS e
       SET progress_percent = calc.pct
       FROM (
         SELECT
           en.user_id,
           en.course_id,
           CASE
             WHEN (tl.n + tt.n) <= 0 THEN 0
             ELSE LEAST(100, GREATEST(0, ROUND(
               100.0 * (COALESCE(ld.n, 0) + COALESCE(td.n, 0))
               / NULLIF(tl.n + tt.n, 0)
             )))
           END::integer AS pct
         FROM enrollments en
         CROSS JOIN total_lec tl
         CROSS JOIN total_tests tt
         LEFT JOIN lec_done  ld ON ld.user_id = en.user_id
         LEFT JOIN tests_done td ON td.user_id = en.user_id
         WHERE en.course_id = $1::int AND (en.status = 'active' OR en.status IS NULL)
       ) AS calc
       WHERE e.user_id = calc.user_id AND e.course_id = calc.course_id`,
      [cid]
    );
  } catch (err) {
    console.error("[Progress] recomputeAllEnrollmentsProgressForCourse failed:", err);
  }
}
