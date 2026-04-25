import type { Express, Request, Response } from "express";
import { computeEnrollmentValidUntil } from "./course-access-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type AuthUser = {
  id: number;
};

type RegisterPaymentRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<AuthUser | null>;
  getRazorpay: () => any;
  verifyPaymentSignature: (orderId: string, paymentId: string, signature: string) => boolean;
  cacheInvalidate?: (pattern: string) => void;
};

export function registerPaymentRoutes({
  app,
  db,
  getAuthUser,
  getRazorpay,
  verifyPaymentSignature,
  cacheInvalidate,
}: RegisterPaymentRoutesDeps): void {
  const completeCoursePaymentByOrder = async ({
    orderId,
    paymentId,
    signature,
    expectedUserId,
    expectedCourseId,
  }: {
    orderId: string;
    paymentId: string;
    signature: string;
    expectedUserId?: number;
    expectedCourseId?: number;
  }) => {
    const isValid = verifyPaymentSignature(orderId, paymentId, signature);
    if (!isValid) {
      throw new Error("Invalid payment signature");
    }

    const paymentRecord = await db.query(
      "SELECT * FROM payments WHERE razorpay_order_id = $1",
      [orderId]
    );
    if (paymentRecord.rows.length === 0) {
      throw new Error("Payment order not found");
    }

    const paymentRow = paymentRecord.rows[0];
    if (expectedUserId && paymentRow.user_id !== expectedUserId) {
      throw new Error("Payment does not belong to this user");
    }
    if (expectedCourseId && paymentRow.course_id !== expectedCourseId) {
      throw new Error("Course mismatch");
    }

    if (paymentRow.status !== "paid") {
      const paidCourseResult = await db.query("SELECT * FROM courses WHERE id = $1", [paymentRow.course_id]);
      const paidCourse = paidCourseResult.rows[0];
      if (!paidCourse) throw new Error("Course not found");
      const endTsPaid = paidCourse.end_date != null && String(paidCourse.end_date).trim() !== ""
        ? Date.parse(String(paidCourse.end_date).trim()) : null;
      if (Number.isFinite(endTsPaid) && (endTsPaid as number) < Date.now()) {
        throw new Error("This course has ended");
      }

      await db.query(
        "UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = $3 WHERE razorpay_order_id = $4",
        [paymentId, signature, "paid", orderId]
      );

      const alreadyEnrolled = await db.query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [paymentRow.user_id, paymentRow.course_id]
      );
      if (alreadyEnrolled.rows.length === 0) {
        const at = Date.now();
        const vu = computeEnrollmentValidUntil(paidCourse, at);
        await db.query(
          "INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until) VALUES ($1, $2, $3, $4)",
          [paymentRow.user_id, paymentRow.course_id, at, vu]
        );
        await db.query(
          "UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1",
          [paymentRow.course_id]
        );
      }
    }

    cacheInvalidate?.("courses:");
    return { userId: paymentRow.user_id, courseId: paymentRow.course_id };
  };

  app.post("/api/payments/track-click", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ ok: true });
      const { courseId } = req.body;
      if (!courseId) return res.json({ ok: true });
      const course = await db.query("SELECT price FROM courses WHERE id = $1", [courseId]);
      const price = course.rows[0]?.price || 0;

      const existing = await db.query(
        "SELECT id, click_count FROM payments WHERE user_id = $1 AND course_id = $2 AND (status = 'created' OR status IS NULL) ORDER BY created_at DESC LIMIT 1",
        [user.id, courseId]
      );
      if (existing.rows.length > 0) {
        const currentCount = parseInt(existing.rows[0].click_count) || 1;
        const newCount = currentCount + 1;
        await db.query(
          "UPDATE payments SET click_count = $1, status = 'created' WHERE id = $2 RETURNING id, click_count",
          [newCount, existing.rows[0].id]
        );
      } else {
        const paid = await db.query(
          "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' LIMIT 1",
          [user.id, courseId]
        );
        if (paid.rows.length === 0) {
          await db.query(
            `INSERT INTO payments (user_id, course_id, amount, status, click_count, created_at)
             VALUES ($1, $2, $3, 'created', 1, $4)
             ON CONFLICT (user_id, course_id) DO UPDATE SET click_count = payments.click_count + 1`,
            [user.id, courseId, price, Date.now()]
          );
        }
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  app.post("/api/payments/create-order", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const { courseId } = req.body;
      if (!courseId) return res.status(400).json({ message: "Course ID is required" });

      const courseResult = await db.query("SELECT * FROM courses WHERE id = $1", [courseId]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });

      const course = courseResult.rows[0];
      if (course.is_free) return res.status(400).json({ message: "This course is free, no payment needed" });
      const endTs = course.end_date != null && String(course.end_date).trim() !== ""
        ? Date.parse(String(course.end_date).trim()) : null;
      if (Number.isFinite(endTs) && (endTs as number) < Date.now()) {
        return res.status(400).json({ message: "This course has ended" });
      }

      const existingEnrollment = await db.query("SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2", [user.id, courseId]);
      if (existingEnrollment.rows.length > 0) return res.status(400).json({ message: "Already enrolled" });

      const amount = Math.round(parseFloat(course.price) * 100);
      const razorpay = getRazorpay();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `course_${courseId}_user_${user.id}_${Date.now()}`,
        notes: { courseId: courseId.toString(), userId: user.id.toString(), courseTitle: course.title },
      });
      console.log("[Payments] create-order success", {
        userId: user.id,
        courseId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      });

      const existingPayment = await db.query(
        "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'created' ORDER BY created_at DESC LIMIT 1",
        [user.id, courseId]
      );
      if (existingPayment.rows.length > 0) {
        await db.query(
          "UPDATE payments SET razorpay_order_id = $1, amount = $2 WHERE id = $3",
          [order.id, course.price, existingPayment.rows[0].id]
        );
      } else {
        await db.query(
          "INSERT INTO payments (user_id, course_id, razorpay_order_id, amount, status, click_count, created_at) VALUES ($1, $2, $3, $4, 'created', 1, $5)",
          [user.id, courseId, order.id, course.price, Date.now()]
        );
      }

      res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        courseName: course.title,
        courseId,
      });
    } catch (err) {
      console.error("Create order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  app.post("/api/payments/verify", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, courseId } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: "Payment details are required" });
      }

      const result = await completeCoursePaymentByOrder({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        expectedUserId: user.id,
        expectedCourseId: courseId,
      });
      console.log("[Payments] verify success", {
        userId: result.userId,
        courseId: result.courseId,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
      });
      res.json({ success: true, message: "Payment verified and enrolled successfully" });
    } catch (err) {
      console.error("Verify payment error:", err);
      res.status(500).json({ message: "Payment verification failed" });
    }
  });

  // iOS mobile web is more reliable with Razorpay redirect callback than popup handler callbacks.
  app.post("/api/payments/verify-redirect", async (req: Request, res: Response) => {
    const frontendBase = process.env.FRONTEND_URL || "https://3ilearning.in";
    const fail = `${frontendBase}/store?payment=failed`;
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      } = req.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.redirect(fail);
      }
      const result = await completeCoursePaymentByOrder({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      });
      return res.redirect(`${frontendBase}/course/${result.courseId}?payment=success`);
    } catch (err) {
      console.error("[Payments] redirect verify failed:", err);
      return res.redirect(fail);
    }
  });

  app.post("/api/tests/create-order", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { testId } = req.body;
      const testResult = await db.query("SELECT id, title, price FROM tests WHERE id = $1", [testId]);
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];
      if (!test.price || parseFloat(test.price) <= 0) return res.status(400).json({ message: "This test is free" });
      const existing = await db.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, testId]);
      if (existing.rows.length > 0) return res.json({ alreadyPurchased: true });
      const amount = Math.round(parseFloat(test.price) * 100);
      const razorpay = getRazorpay();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `test_${testId}_user_${user.id}_${Date.now()}`,
        notes: { testId: String(testId), userId: String(user.id), kind: "test" },
      });
      res.json({ orderId: order.id, amount, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID, testName: test.title });
    } catch (err) {
      console.error("Test create-order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  // Mobile web redirect (iOS / Android): same pattern as course payment
  app.post("/api/tests/verify-redirect", async (req: Request, res: Response) => {
    const frontendBase = process.env.FRONTEND_URL || "https://3ilearning.in";
    const fail = `${frontendBase}/test-series?payment=failed`;
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.redirect(fail);
      }
      const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.redirect(fail);
      const razorpay = getRazorpay();
      const order: { notes?: Record<string, string> } = await razorpay.orders.fetch(razorpay_order_id);
      const n = order.notes || {};
      if (n.kind !== "test") return res.redirect(fail);
      const testId = parseInt(n.testId || "0", 10);
      const userId = parseInt(n.userId || "0", 10);
      if (!testId || !userId) return res.redirect(fail);
      await db.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [userId, testId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      return res.redirect(`${frontendBase}/test-series?payment=success&testId=${testId}`);
    } catch (err) {
      console.error("[Tests] verify-redirect failed:", err);
      return res.redirect(fail);
    }
  });

  app.post("/api/tests/verify-payment", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, testId } = req.body;
      const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      await db.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [user.id, testId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Test verify-payment error:", err);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });

  app.get("/api/tests/:id/purchased", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ purchased: false });
      const result = await db.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, req.params.id]);
      res.json({ purchased: result.rows.length > 0 });
    } catch {
      res.json({ purchased: false });
    }
  });
}

