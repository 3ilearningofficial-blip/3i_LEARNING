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

      const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });

      const paymentRecord = await db.query(
        "SELECT * FROM payments WHERE razorpay_order_id = $1 AND user_id = $2",
        [razorpay_order_id, user.id]
      );
      if (paymentRecord.rows.length === 0) return res.status(400).json({ message: "Payment order not found" });
      if (paymentRecord.rows[0].status === "paid") return res.status(400).json({ message: "Payment already processed" });

      const paymentCourseId = paymentRecord.rows[0].course_id;
      if (courseId && paymentCourseId !== courseId) return res.status(400).json({ message: "Course mismatch" });

      const paidCourseResult = await db.query("SELECT * FROM courses WHERE id = $1", [paymentCourseId]);
      const paidCourse = paidCourseResult.rows[0];
      if (!paidCourse) return res.status(400).json({ message: "Course not found" });
      const endTsPaid = paidCourse.end_date != null && String(paidCourse.end_date).trim() !== ""
        ? Date.parse(String(paidCourse.end_date).trim()) : null;
      if (Number.isFinite(endTsPaid) && (endTsPaid as number) < Date.now()) {
        return res.status(400).json({ message: "This course has ended" });
      }

      await db.query(
        "UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = $3 WHERE razorpay_order_id = $4 AND user_id = $5",
        [razorpay_payment_id, razorpay_signature, "paid", razorpay_order_id, user.id]
      );

      const alreadyEnrolled = await db.query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [user.id, paymentCourseId]
      );
      if (alreadyEnrolled.rows.length === 0) {
        const at = Date.now();
        const vu = computeEnrollmentValidUntil(paidCourse, at);
        await db.query(
          "INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until) VALUES ($1, $2, $3, $4)",
          [user.id, paymentCourseId, at, vu]
        );
        await db.query(
          "UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1",
          [paymentCourseId]
        );
      }
      cacheInvalidate?.("courses:");
      res.json({ success: true, message: "Payment verified and enrolled successfully" });
    } catch (err) {
      console.error("Verify payment error:", err);
      res.status(500).json({ message: "Payment verification failed" });
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
      const order = await razorpay.orders.create({ amount, currency: "INR", receipt: `test_${testId}_user_${user.id}_${Date.now()}` });
      res.json({ orderId: order.id, amount, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID, testName: test.title });
    } catch (err) {
      console.error("Test create-order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
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

