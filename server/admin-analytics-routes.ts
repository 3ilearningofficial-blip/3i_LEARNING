import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminAnalyticsRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

export function registerAdminAnalyticsRoutes({
  app,
  db,
  requireAdmin,
}: RegisterAdminAnalyticsRoutesDeps): void {
  app.get("/api/admin/analytics", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { period, startDate, endDate } = req.query;

      const now = Date.now();
      const day = 86400000;
      const toSafeTs = (value: unknown): number | null => {
        const ts = new Date(String(value)).getTime();
        return Number.isFinite(ts) ? ts : null;
      };
      const buildRange = (): { start: number; endExclusive: number } | null => {
        if (period === "today") {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          return { start: start.getTime(), endExclusive: start.getTime() + day };
        }
        if (period === "yesterday") {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          start.setDate(start.getDate() - 1);
          const end = new Date();
          end.setHours(0, 0, 0, 0);
          return { start: start.getTime(), endExclusive: end.getTime() };
        }
        if (period === "7days") return { start: now - 7 * day, endExclusive: now + day };
        if (period === "15days") return { start: now - 15 * day, endExclusive: now + day };
        if (period === "30days") return { start: now - 30 * day, endExclusive: now + day };
        if (period === "custom" && startDate && endDate) {
          const s = toSafeTs(startDate);
          const e = toSafeTs(endDate);
          if (s !== null && e !== null) return { start: s, endExclusive: e + day };
        }
        return null;
      };
      const range = buildRange();
      const rangeParams = range ? [range.start, range.endExclusive] : [];
      const paymentWhere = range ? " AND p.created_at >= $1 AND p.created_at < $2" : "";
      const enrollWhere = range ? " AND e.enrolled_at >= $1 AND e.enrolled_at < $2" : "";
      const bookWhere = range ? " AND bp.purchased_at >= $1 AND bp.purchased_at < $2" : "";
      const enrollJoin = range ? " AND e.enrolled_at >= $1 AND e.enrolled_at < $2" : "";
      // Course revenue must not JOIN payments next to enrollments (cartesian = doubled sums).
      // Payouts are stored in paise (Razorpay); response amounts use rupees for this API.

      const [
        revenueResult,
        enrollResult,
        lifetimeResult,
        lifetimeEnrollResult,
        courseBreakdown,
        recentPurchases,
        abandonedResult,
        bookPurchases,
        lifetimeBookRevenue,
        bookAbandonedResult,
        testPurchases,
        lifetimeTestRevenue,
      ] = await Promise.all([
        db.query(
          `SELECT COALESCE(SUM(
              (CASE
                WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                  AND p.amount::numeric = c.price::numeric
                THEN (ROUND(c.price::numeric * 100))::integer
                ELSE p.amount
              END)
            ), 0) / 100.0 as total_revenue
           FROM payments p
           JOIN courses c ON c.id = p.course_id
           WHERE p.status = 'paid'${paymentWhere}`,
          rangeParams
        ),
        db.query(`SELECT COUNT(*) as total_enrollments FROM enrollments e WHERE 1=1${enrollWhere}`, rangeParams),
        db.query(
          `SELECT COALESCE(SUM(
              (CASE
                WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                  AND p.amount::numeric = c.price::numeric
                THEN (ROUND(c.price::numeric * 100))::integer
                ELSE p.amount
              END)
            ), 0) / 100.0 as lifetime_revenue
           FROM payments p
           JOIN courses c ON c.id = p.course_id
           WHERE p.status = 'paid'`
        ),
        db.query(`SELECT COUNT(*) as cnt FROM enrollments`),
        db.query(`
          SELECT c.id, c.title, c.category, c.price, c.is_free, c.course_type,
                 COUNT(DISTINCT e.id) as enrollment_count,
                 (COALESCE((
                    SELECT SUM(
                      (CASE
                        WHEN p2.amount IS NOT NULL AND c2.price IS NOT NULL
                          AND p2.amount::numeric = c2.price::numeric
                        THEN (ROUND(c2.price::numeric * 100))::integer
                        ELSE p2.amount
                      END)
                    ) FROM payments p2
                    JOIN courses c2 ON c2.id = p2.course_id
                    WHERE p2.course_id = c.id AND p2.status = 'paid'${range ? " AND p2.created_at >= $1 AND p2.created_at < $2" : ""}
                 ), 0) / 100.0) as revenue
          FROM courses c
          LEFT JOIN enrollments e ON e.course_id = c.id${enrollJoin}
          GROUP BY c.id, c.title, c.category, c.price, c.is_free, c.course_type
          ORDER BY enrollment_count DESC
        `, range ? rangeParams : []),
        db.query(`
          SELECT p.id, p.created_at,
                 (CASE
                    WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                      AND p.amount::numeric = c.price::numeric
                    THEN (ROUND(c.price::numeric * 100))::integer
                    ELSE p.amount
                  END) / 100.0 as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 c.title as course_title, c.category
          FROM payments p
          JOIN users u ON u.id = p.user_id
          JOIN courses c ON c.id = p.course_id
          WHERE p.status = 'paid'${paymentWhere}
          ORDER BY p.created_at DESC LIMIT 20
        `, rangeParams),
        db.query(`
          SELECT MIN(p.id) as id, MAX(p.created_at) as created_at, MAX(p.amount) as amount,
                 SUM(COALESCE(p.click_count, 1)) as click_count,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 c.title as course_title, c.category, c.price
          FROM payments p
          JOIN users u ON u.id = p.user_id
          JOIN courses c ON c.id = p.course_id
          WHERE (p.status = 'created' OR p.status IS NULL)
          GROUP BY p.user_id, p.course_id, u.name, u.phone, u.email, c.title, c.category, c.price
          ORDER BY click_count DESC, MAX(p.created_at) DESC LIMIT 100
        `),
        db.query(`
          SELECT bp.id, bp.purchased_at as created_at, b.price as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 b.title as book_title, b.author, b.cover_url
          FROM book_purchases bp
          JOIN users u ON u.id = bp.user_id
          JOIN books b ON b.id = bp.book_id
          WHERE 1=1${bookWhere}
          ORDER BY bp.purchased_at DESC LIMIT 100
        `, rangeParams),
        db.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM book_purchases bp JOIN books b ON b.id = bp.book_id`),
        db.query(`
          SELECT bct.id, bct.created_at, bct.click_count,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 b.title as book_title, b.author, b.price
          FROM book_click_tracking bct
          JOIN users u ON u.id = bct.user_id
          JOIN books b ON b.id = bct.book_id
          ORDER BY bct.click_count DESC, bct.created_at DESC LIMIT 100
        `),
        db.query(`
          SELECT tp.id, tp.created_at, t.price as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 t.title as test_title, t.test_type
          FROM test_purchases tp
          JOIN users u ON u.id = tp.user_id
          JOIN tests t ON t.id = tp.test_id
          ORDER BY tp.created_at DESC LIMIT 100
        `).catch(() => ({ rows: [] })),
        db.query(`SELECT COALESCE(SUM(t.price), 0) as total FROM test_purchases tp JOIN tests t ON t.id = tp.test_id`).catch(() => ({ rows: [{ total: 0 }] })),
      ]);

      res.json({
        totalEnrollments: parseInt(enrollResult.rows[0]?.total_enrollments || "0"),
        totalRevenue: parseFloat(revenueResult.rows[0]?.total_revenue || "0"),
        lifetimeRevenue: parseFloat(lifetimeResult.rows[0]?.lifetime_revenue || "0"),
        lifetimeEnrollments: parseInt(lifetimeEnrollResult.rows[0]?.cnt || "0"),
        lifetimeBookRevenue: parseFloat(lifetimeBookRevenue.rows[0]?.total || "0"),
        lifetimeTestRevenue: parseFloat(lifetimeTestRevenue.rows[0]?.total || "0"),
        courseBreakdown: courseBreakdown.rows,
        recentPurchases: recentPurchases.rows,
        abandonedCheckouts: abandonedResult.rows,
        bookPurchases: bookPurchases.rows,
        bookAbandonedCheckouts: bookAbandonedResult.rows,
        testPurchases: testPurchases.rows,
      });
    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  app.get("/api/admin/courses/:id/enrollments", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT
           e.id,
           e.user_id,
           u.name AS user_name,
           u.phone AS user_phone,
           u.email AS user_email,
           e.enrolled_at,
           COALESCE(e.status, 'active') AS status,
           CASE
             WHEN (COALESCE(tl.total_lectures, 0) + COALESCE(tt.total_tests, 0)) <= 0 THEN 0
             ELSE LEAST(
               100,
               GREATEST(
                 0,
                 ROUND(
                   100.0 * (COALESCE(lp.lecture_points, 0) + COALESCE(tp.completed_tests, 0))
                   / NULLIF(COALESCE(tl.total_lectures, 0) + COALESCE(tt.total_tests, 0), 0)
                 )
               )
             )::integer
           END AS progress_percent
         FROM enrollments e
         JOIN users u ON e.user_id = u.id
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::numeric AS total_lectures
           FROM lectures l
           WHERE l.course_id = $1
         ) tl
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::numeric AS total_tests
           FROM tests t
           WHERE t.course_id = $1
             AND COALESCE(t.is_published, true) = true
         ) tt
         LEFT JOIN LATERAL (
           SELECT
             COALESCE(
               SUM(
                 LEAST(
                   1.0,
                   GREATEST(
                     CASE
                       WHEN COALESCE(lp2.is_completed, false) THEN 1.0
                       ELSE GREATEST(0.0, LEAST(100.0, COALESCE(lp2.watch_percent, 0)::numeric)) / 100.0
                     END,
                     CASE
                       WHEN COALESCE(lp2.playback_sessions, 0) > 0 THEN 0.10
                       ELSE 0.0
                     END
                   )
                 )
               ),
               0
             ) AS lecture_points
           FROM lecture_progress lp2
           JOIN lectures l2 ON l2.id = lp2.lecture_id
           WHERE lp2.user_id = e.user_id
             AND l2.course_id = $1
         ) lp ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT ta.test_id)::numeric AS completed_tests
           FROM test_attempts ta
           JOIN tests t2 ON t2.id = ta.test_id
           WHERE ta.user_id = e.user_id
             AND ta.status = 'completed'
             AND t2.course_id = $1
             AND COALESCE(t2.is_published, true) = true
         ) tp ON true
         WHERE e.course_id = $1
         ORDER BY e.enrolled_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch enrollments" });
    }
  });

  /** Lecture + live + test breakdown for one enrolled student (admin). */
  app.get("/api/admin/courses/:courseId/enrollments/:userId/detail", requireAdmin, async (req: Request, res: Response) => {
    try {
      const courseId = parseInt(String(req.params.courseId), 10);
      const userId = parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(courseId) || !Number.isFinite(userId)) {
        return res.status(400).json({ message: "Invalid course or user id" });
      }
      const enr = await db.query(
        "SELECT e.id, u.id AS user_id, u.name AS user_name, u.email AS user_email, u.phone AS user_phone, e.progress_percent, e.enrolled_at, COALESCE(e.status, 'active') AS status FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = $1 AND e.user_id = $2",
        [courseId, userId]
      );
      if (enr.rows.length === 0) return res.status(404).json({ message: "Enrollment not found" });
      const student = enr.rows[0];

      const lectures = await db.query(
        `SELECT l.id AS lecture_id, l.title, l.order_index, l.section_title,
                COALESCE(lp.watch_percent, 0) AS watch_percent,
                COALESCE(lp.is_completed, false) AS is_completed,
                COALESCE(lp.playback_sessions, 0) AS playback_sessions
         FROM lectures l
         LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.user_id = $2
         WHERE l.course_id = $1
         ORDER BY l.order_index ASC NULLS LAST, l.id ASC`,
        [courseId, userId]
      );

      const liveClasses = await db.query(
        `SELECT lc.id AS live_class_id, lc.title, lc.scheduled_at, lc.is_completed, lc.is_live,
                (CASE WHEN v.user_id IS NOT NULL THEN true ELSE false END) AS present_during_live,
                COALESCE(rp.watch_percent, 0) AS recording_watch_percent,
                COALESCE(rp.playback_sessions, 0) AS recording_playback_sessions,
                (CASE WHEN lc.recording_url IS NOT NULL AND LENGTH(BTRIM(COALESCE(lc.recording_url, ''))) > 0 THEN true ELSE false END) AS has_recording
         FROM live_classes lc
         LEFT JOIN live_class_viewers v ON v.live_class_id = lc.id AND v.user_id = $2
         LEFT JOIN live_class_recording_progress rp ON rp.live_class_id = lc.id AND rp.user_id = $2
         WHERE lc.course_id = $1
         ORDER BY lc.scheduled_at DESC NULLS LAST, lc.id DESC`,
        [courseId, userId]
      );

      const tests = await db.query(
        `SELECT t.id AS test_id, t.title, t.total_questions,
                ta.id AS attempt_id, ta.status AS attempt_status,
                ta.correct, ta.incorrect, ta.attempted,
                ta.completed_at, ta.score, ta.total_marks
         FROM tests t
         LEFT JOIN LATERAL (
           SELECT ta2.id, ta2.status, ta2.correct, ta2.incorrect, ta2.attempted, ta2.completed_at, ta2.score, ta2.total_marks
           FROM test_attempts ta2
           WHERE ta2.test_id = t.id AND ta2.user_id = $2
           ORDER BY CASE WHEN ta2.status = 'completed' THEN 0 ELSE 1 END, ta2.completed_at DESC NULLS LAST, ta2.id DESC
           LIMIT 1
         ) ta ON true
         WHERE t.course_id = $1 AND COALESCE(t.is_published, true) = true
         ORDER BY t.folder_name NULLS LAST, t.id ASC`,
        [courseId, userId]
      );

      const missions = await db.query(
        `SELECT dm.id AS mission_id, dm.title, dm.mission_date::text AS mission_date,
                CASE
                  WHEN dm.questions IS NULL THEN 0
                  ELSE GREATEST(0, COALESCE(jsonb_array_length(dm.questions::jsonb), 0))
                END AS total_questions,
                COALESCE(um.is_completed, false) AS is_completed,
                COALESCE(um.score, 0) AS correct,
                COALESCE(um.incorrect, 0) AS incorrect,
                COALESCE(um.skipped, 0) AS skipped
         FROM daily_missions dm
         LEFT JOIN user_missions um ON um.mission_id = dm.id AND um.user_id = $2
         WHERE dm.course_id = $1
         ORDER BY dm.mission_date DESC NULLS LAST, dm.id DESC`,
        [courseId, userId]
      );

      res.json({
        student,
        lectures: lectures.rows,
        liveClasses: liveClasses.rows,
        tests: tests.rows,
        missions: missions.rows,
      });
    } catch (err) {
      console.error("Enrollment detail error:", err);
      res.status(500).json({ message: "Failed to fetch student progress" });
    }
  });
}

