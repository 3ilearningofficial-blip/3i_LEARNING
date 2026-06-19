/**
 * progress-utils.ts — Course progress (materials excluded).
 * Normal: lectures + regular tests + mock + daily missions
 * Multi-subject: lectures + regular tests + PYQ + mock + daily missions
 */

type DbClient = {
  query: (text: string, params?: unknown[], options?: any) => Promise<{ rows: any[]; rowCount?: number }>;
};

const VISIBLE_LECTURE = `(visible_after_at IS NULL OR visible_after_at <= EXTRACT(EPOCH FROM NOW()) * 1000)`;
const VISIBLE_LECTURE_L = `(l.visible_after_at IS NULL OR l.visible_after_at <= EXTRACT(EPOCH FROM NOW()) * 1000)`;

/** Published tests that count toward progress for the given course type. */
function progressTestWhere(courseType: string, alias = ""): string {
  const p = alias ? `${alias}.` : "";
  const pub = `${p}is_published = TRUE`;
  if (String(courseType).toLowerCase() === "multi_subject") {
    return pub;
  }
  return `${pub} AND COALESCE(LOWER(${p}test_type), 'practice') <> 'pyq'`;
}

async function getCourseType(db: DbClient, courseId: number): Promise<string> {
  const r = await db.query(
    `SELECT COALESCE(course_type, 'live') AS course_type FROM courses WHERE id = $1::int LIMIT 1`,
    [courseId]
  );
  return String(r.rows[0]?.course_type || "live").toLowerCase();
}

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
      total_tests    = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND is_published = TRUE),
      pyq_count      = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'pyq' AND is_published = TRUE),
      mock_count     = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'mock' AND is_published = TRUE),
      practice_count = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'practice' AND is_published = TRUE)
    WHERE id = $1::int`,
    [id]
  );
  await recomputeAllEnrollmentsProgressForCourse(db, id);
}

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
    if (runTx) {
      await client.query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2::int FOR UPDATE",
        [userId, cid]
      );
    }

    const courseType = await getCourseType(client, cid);
    const testWhere = progressTestWhere(courseType);
    const testWhereT = progressTestWhere(courseType, "t");

    const totals = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM lectures WHERE course_id = $1::int AND ${VISIBLE_LECTURE}) AS lec,
         (SELECT COUNT(*)::int FROM tests WHERE course_id = $1::int AND ${testWhere}) AS tests,
         (SELECT COUNT(*)::int FROM daily_missions WHERE course_id = $1::int) AS missions`,
      [cid]
    );
    const done = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM lecture_progress lp
          JOIN lectures l ON lp.lecture_id = l.id
          WHERE lp.user_id = $2 AND l.course_id = $1::int AND lp.is_completed = TRUE AND ${VISIBLE_LECTURE_L}) AS lec,
         (SELECT COUNT(DISTINCT ta.test_id)::int FROM test_attempts ta
          JOIN tests t ON ta.test_id = t.id AND t.course_id = $1::int AND ${testWhereT}
          WHERE ta.user_id = $2 AND ta.status = 'completed') AS tests,
         (SELECT COUNT(*)::int FROM user_missions um
          JOIN daily_missions dm ON dm.id = um.mission_id AND dm.course_id = $1::int
          WHERE um.user_id = $2 AND um.is_completed = TRUE) AS missions`,
      [cid, userId]
    );

    const total =
      Number(totals.rows[0]?.lec || 0) +
      Number(totals.rows[0]?.tests || 0) +
      Number(totals.rows[0]?.missions || 0);
    const completed =
      Number(done.rows[0]?.lec || 0) +
      Number(done.rows[0]?.tests || 0) +
      Number(done.rows[0]?.missions || 0);
    const progress = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

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
    const courseType = await getCourseType(db, cid);
    const testWhere = progressTestWhere(courseType);
    const testWhereT = progressTestWhere(courseType, "t");

    await db.query(
      `WITH
         total_lec AS (
           SELECT COUNT(*)::bigint AS n FROM lectures
           WHERE course_id = $1::int AND ${VISIBLE_LECTURE}
         ),
         total_tests AS (
           SELECT COUNT(*)::bigint AS n FROM tests
           WHERE course_id = $1::int AND ${testWhere}
         ),
         total_missions AS (
           SELECT COUNT(*)::bigint AS n FROM daily_missions WHERE course_id = $1::int
         ),
         lec_done AS (
           SELECT lp.user_id, COUNT(*)::bigint AS n
           FROM lecture_progress lp
           JOIN lectures l ON lp.lecture_id = l.id AND l.course_id = $1::int
           WHERE lp.is_completed = TRUE AND ${VISIBLE_LECTURE_L}
           GROUP BY lp.user_id
         ),
         tests_done AS (
           SELECT ta.user_id, COUNT(DISTINCT ta.test_id)::bigint AS n
           FROM test_attempts ta
           JOIN tests t ON ta.test_id = t.id AND t.course_id = $1::int AND ${testWhereT}
           WHERE ta.status = 'completed'
           GROUP BY ta.user_id
         ),
         missions_done AS (
           SELECT um.user_id, COUNT(*)::bigint AS n
           FROM user_missions um
           JOIN daily_missions dm ON dm.id = um.mission_id AND dm.course_id = $1::int
           WHERE um.is_completed = TRUE
           GROUP BY um.user_id
         )
       UPDATE enrollments AS e
       SET progress_percent = calc.pct
       FROM (
         SELECT
           en.user_id,
           en.course_id,
           CASE
             WHEN (tl.n + tt.n + tm.n) <= 0 THEN 0
             ELSE LEAST(100, GREATEST(0, ROUND(
               100.0 * (COALESCE(ld.n, 0) + COALESCE(td.n, 0) + COALESCE(md.n, 0))
               / NULLIF(tl.n + tt.n + tm.n, 0)
             )))
           END::integer AS pct
         FROM enrollments en
         CROSS JOIN total_lec tl
         CROSS JOIN total_tests tt
         CROSS JOIN total_missions tm
         LEFT JOIN lec_done ld ON ld.user_id = en.user_id
         LEFT JOIN tests_done td ON td.user_id = en.user_id
         LEFT JOIN missions_done md ON md.user_id = en.user_id
         WHERE en.course_id = $1::int AND (en.status = 'active' OR en.status IS NULL)
       ) AS calc
       WHERE e.user_id = calc.user_id AND e.course_id = calc.course_id`,
      [cid]
    );
  } catch (err) {
    console.error("[Progress] recomputeAllEnrollmentsProgressForCourse failed:", err);
  }
}
