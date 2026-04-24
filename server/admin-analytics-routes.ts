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
      const paymentJoin = range ? " AND p.created_at >= $3 AND p.created_at < $4" : "";
      const courseJoinParams = range ? [range.start, range.endExclusive, range.start, range.endExclusive] : [];

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
        db.query(`SELECT COALESCE(SUM(p.amount), 0) as total_revenue FROM payments p WHERE p.status = 'paid'${paymentWhere}`, rangeParams),
        db.query(`SELECT COUNT(*) as total_enrollments FROM enrollments e WHERE 1=1${enrollWhere}`, rangeParams),
        db.query(`SELECT COALESCE(SUM(amount), 0) as lifetime_revenue FROM payments WHERE status = 'paid'`),
        db.query(`SELECT COUNT(*) as cnt FROM enrollments`),
        db.query(`
          SELECT c.id, c.title, c.category, c.price, c.is_free, c.course_type,
                 COUNT(DISTINCT e.id) as enrollment_count,
                 COALESCE(SUM(p.amount), 0) as revenue
          FROM courses c
          LEFT JOIN enrollments e ON e.course_id = c.id${enrollJoin}
          LEFT JOIN payments p ON p.course_id = c.id AND p.status = 'paid'${paymentJoin}
          GROUP BY c.id, c.title, c.category, c.price, c.is_free, c.course_type
          ORDER BY enrollment_count DESC
        `, courseJoinParams),
        db.query(`
          SELECT p.id, p.created_at, p.amount,
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
        `SELECT e.id, e.user_id, u.name AS user_name, u.phone AS user_phone, u.email AS user_email,
                e.enrolled_at, e.progress_percent, COALESCE(e.status, 'active') AS status
         FROM enrollments e JOIN users u ON e.user_id = u.id
         WHERE e.course_id = $1 ORDER BY e.enrolled_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch enrollments" });
    }
  });
}

