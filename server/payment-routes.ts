import type { Express, Request, Response } from "express";
import { computeEnrollmentValidUntil, isEnrollmentExpired } from "./course-access-utils";
import {
  assertNativePaidPurchaseInstallation,
  finalizeInstallationBindAfterPurchase,
} from "./native-device-binding";

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
  runInTransaction: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
};

/** Maps domain errors from course payment verification to HTTP status (best-effort). */
function httpStatusForCourseVerifyError(message: string): number {
  switch (message) {
    case "Invalid payment signature":
      return 400;
    case "Payment order not found":
      return 404;
    case "Payment does not belong to this user":
      return 403;
    case "Course mismatch":
      return 400;
    case "This course has ended":
      return 410;
    case "Course not found":
      return 404;
    case "Payment kind mismatch":
    case "Payment user mismatch":
    case "Payment course mismatch":
      return 400;
    default:
      return 500;
  }
}

export function registerPaymentRoutes({
  app,
  db,
  getAuthUser,
  getRazorpay,
  verifyPaymentSignature,
  runInTransaction,
}: RegisterPaymentRoutesDeps): void {
  // Best-effort bootstrap; analytics also handles missing table safely.
  db.query(
    `CREATE TABLE IF NOT EXISTS payment_failures (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      course_id INTEGER,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      source TEXT,
      reason TEXT,
      raw_error TEXT,
      created_at BIGINT NOT NULL
    )`
  ).catch((err) => {
    console.error("[Payments] failed to ensure payment_failures table:", err);
  });

  const logPaymentFailure = async (payload: {
    userId?: number | null;
    courseId?: number | null;
    orderId?: string | null;
    paymentId?: string | null;
    source: string;
    reason?: string | null;
    rawError?: unknown;
  }) => {
    try {
      await db.query(
        `INSERT INTO payment_failures
         (user_id, course_id, razorpay_order_id, razorpay_payment_id, source, reason, raw_error, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          payload.userId ?? null,
          payload.courseId ?? null,
          payload.orderId ?? null,
          payload.paymentId ?? null,
          payload.source,
          payload.reason ?? null,
          payload.rawError == null ? null : JSON.stringify(payload.rawError),
          Date.now(),
        ]
      );
    } catch (err) {
      console.error("[Payments] failed to log payment failure:", err);
    }
  };

  const verifyOrderOwnershipAndAmount = async ({
    orderId,
    expectedKind,
    expectedUserId,
    expectedItemId,
    expectedAmount,
  }: {
    orderId: string;
    expectedKind: "test" | "book";
    expectedUserId: number;
    expectedItemId: number;
    expectedAmount: number;
  }) => {
    const razorpay = getRazorpay();
    const order: { amount?: number; notes?: Record<string, string> } = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};
    const orderAmount = Number(order.amount || 0);
    const noteKind = String(notes.kind || "");
    const noteUserId = Number(notes.userId || 0);
    const noteTestId = Number(notes.testId || 0);
    const noteBookId = Number(notes.bookId || 0);
    const noteItemId = expectedKind === "test" ? noteTestId : noteBookId;
    if (noteKind !== expectedKind) throw new Error("Payment kind mismatch");
    if (!noteUserId || noteUserId !== expectedUserId) throw new Error("Payment user mismatch");
    if (!noteItemId || noteItemId !== expectedItemId) throw new Error("Payment item mismatch");
    if (!orderAmount || orderAmount !== expectedAmount) throw new Error("Payment amount mismatch");
  };

  const verifyCourseOrderOwnership = async ({
    orderId,
    expectedUserId,
    expectedCourseId,
  }: {
    orderId: string;
    expectedUserId: number;
    expectedCourseId: number;
  }) => {
    const razorpay = getRazorpay();
    const order: { notes?: Record<string, string> } = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};
    const noteUserId = Number(notes.userId || 0);
    const noteCourseId = Number(notes.courseId || 0);
    const noteKind = String(notes.kind || "");
    if (noteKind && noteKind !== "course") throw new Error("Payment kind mismatch");
    if (!noteUserId || noteUserId !== expectedUserId) throw new Error("Payment user mismatch");
    if (!noteCourseId || noteCourseId !== expectedCourseId) throw new Error("Payment course mismatch");
  };

  /** Insert new enrollment (bumps course total_students) or renew expired/inactive access without double-counting. */
  const ensureCourseEnrollment = async (
    exec: DbClient,
    paymentRow: { user_id: number; course_id: number }
  ) => {
    const paidCourseResult = await exec.query("SELECT * FROM courses WHERE id = $1", [paymentRow.course_id]);
    const paidCourse = paidCourseResult.rows[0];
    if (!paidCourse) throw new Error("Course not found");
    const at = Date.now();
    const vu = computeEnrollmentValidUntil(paidCourse, at);
    const existing = await exec.query(
      "SELECT id, valid_until, status FROM enrollments WHERE user_id = $1 AND course_id = $2 FOR UPDATE",
      [paymentRow.user_id, paymentRow.course_id]
    );
    if (existing.rows.length === 0) {
      await exec.query(
        `INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [paymentRow.user_id, paymentRow.course_id, at, vu]
      );
      await exec.query("UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1", [
        paymentRow.course_id,
      ]);
    } else {
      await exec.query(
        `UPDATE enrollments SET enrolled_at = $1, valid_until = $2, status = 'active'
         WHERE user_id = $3 AND course_id = $4`,
        [at, vu, paymentRow.user_id, paymentRow.course_id]
      );
    }
  };

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

    const result = await runInTransaction(async (tx) => {
      const paymentRecord = await tx.query(
        "SELECT * FROM payments WHERE razorpay_order_id = $1 FOR UPDATE",
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
        const paidCourseResult = await tx.query("SELECT * FROM courses WHERE id = $1", [paymentRow.course_id]);
        const paidCourse = paidCourseResult.rows[0];
        if (!paidCourse) throw new Error("Course not found");
        const endTsPaid = paidCourse.end_date != null && String(paidCourse.end_date).trim() !== ""
          ? Date.parse(String(paidCourse.end_date).trim()) : null;
        if (Number.isFinite(endTsPaid) && (endTsPaid as number) < Date.now()) {
          throw new Error("This course has ended");
        }

        await tx.query(
          "UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = $3 WHERE razorpay_order_id = $4",
          [paymentId, signature, "paid", orderId]
        );
      }

      await ensureCourseEnrollment(tx, paymentRow);
      return { userId: paymentRow.user_id as number, courseId: paymentRow.course_id as number };
    });

    return result;
  };

  app.post("/api/payments/track-click", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ ok: true });
      const { courseId } = req.body;
      if (!courseId) return res.json({ ok: true });
      const course = await db.query("SELECT price FROM courses WHERE id = $1", [courseId]);
      const price = course.rows[0]?.price || 0;
      const pricePaisa = Math.round(parseFloat(String(price)) * 100);
      const now = Date.now();

      const updated = await db.query(
        `UPDATE payments AS p
         SET click_count = COALESCE(p.click_count, 1) + 1,
             status = 'created'
         FROM (
           SELECT id FROM payments
           WHERE user_id = $1 AND course_id = $2
             AND (status = 'created' OR status IS NULL)
             AND (razorpay_order_id IS NULL OR btrim(razorpay_order_id) = '')
           ORDER BY created_at DESC
           LIMIT 1
         ) AS sub
         WHERE p.id = sub.id
         RETURNING p.id`,
        [user.id, courseId]
      );
      if (updated.rows.length === 0) {
        const paid = await db.query(
          "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' LIMIT 1",
          [user.id, courseId]
        );
        if (paid.rows.length === 0) {
          await db.query(
            `INSERT INTO payments (user_id, course_id, amount, status, click_count, created_at)
             VALUES ($1, $2, $3, 'created', 1, $4)`,
            [user.id, courseId, pricePaisa, now]
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

      const existingEnrollment = await db.query(
        "SELECT valid_until, status FROM enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1",
        [user.id, courseId]
      );
      if (existingEnrollment.rows.length > 0) {
        const er = existingEnrollment.rows[0];
        const statusOk = er.status == null || String(er.status).toLowerCase() === "active";
        if (statusOk && !isEnrollmentExpired(er)) {
          return res.status(400).json({ message: "Already enrolled" });
        }
      }

      const amount = Math.round(parseFloat(course.price) * 100);
      const razorpay = getRazorpay();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `course_${courseId}_user_${user.id}_${Date.now()}`,
        notes: { courseId: courseId.toString(), userId: user.id.toString(), courseTitle: course.title, kind: "course" },
      });
      console.log("[Payments] create-order success");

      try {
        await db.query(
          "INSERT INTO payments (user_id, course_id, razorpay_order_id, amount, status, click_count, created_at) VALUES ($1, $2, $3, $4, 'created', 1, $5)",
          [user.id, courseId, order.id, amount, Date.now()]
        );
      } catch (insertErr: any) {
        if (insertErr?.code === "23505") {
          return res.status(409).json({ message: "Duplicate payment order; try again" });
        }
        throw insertErr;
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

      const preBind = await assertNativePaidPurchaseInstallation(db, user.id, req);
      if (!preBind.ok) {
        return res.status(403).json({ message: preBind.message });
      }
      const result = await completeCoursePaymentByOrder({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        expectedUserId: user.id,
        expectedCourseId: courseId,
      });
      await finalizeInstallationBindAfterPurchase(db, result.userId, req);
      console.log("[Payments] verify success");
      res.json({ success: true, message: "Payment verified and enrolled successfully" });
    } catch (err) {
      console.error("Verify payment error:", err);
      const msg = err instanceof Error ? err.message : "";
      await logPaymentFailure({
        userId: user?.id ?? null,
        courseId: Number((req.body as any)?.courseId) || null,
        orderId: (req.body as any)?.razorpay_order_id || null,
        paymentId: (req.body as any)?.razorpay_payment_id || null,
        source: "verify",
        reason: msg || "Payment verification failed",
        rawError: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      const status = httpStatusForCourseVerifyError(msg);
      if (status === 500) {
        return res.status(500).json({ message: "Payment verification failed" });
      }
      return res.status(status).json({ message: msg || "Payment verification failed" });
    }
  });

  // Self-service repair: paid in DB but enrollment row missing (legacy bug / partial failure). Idempotent.
  app.post("/api/payments/sync-enrollment", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const courseId = Number((req.body as { courseId?: number })?.courseId);
      if (!Number.isFinite(courseId)) {
        return res.status(400).json({ message: "courseId is required" });
      }
      const pay = await db.query(
        "SELECT * FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' ORDER BY created_at DESC LIMIT 1",
        [user.id, courseId]
      );
      if (pay.rows.length === 0) {
        return res.json({ ok: true, fixed: false, message: "No paid order for this course" });
      }
      await ensureCourseEnrollment(db, pay.rows[0]);
      return res.json({ ok: true, fixed: true, message: "Enrollment synced" });
    } catch (err) {
      console.error("sync-enrollment error:", err);
      res.status(500).json({ message: "Failed to sync enrollment" });
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
        await logPaymentFailure({
          orderId: razorpay_order_id || null,
          paymentId: razorpay_payment_id || null,
          source: "verify_redirect",
          reason: "Missing redirect payment fields",
          rawError: req.body || null,
        });
        return res.redirect(fail);
      }
      const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) {
        await logPaymentFailure({
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          source: "verify_redirect",
          reason: "Invalid payment signature",
        });
        return res.redirect(fail);
      }
      const paymentRecord = await db.query("SELECT * FROM payments WHERE razorpay_order_id = $1", [razorpay_order_id]);
      if (paymentRecord.rows.length === 0) {
        await logPaymentFailure({
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          source: "verify_redirect",
          reason: "Payment order not found",
        });
        return res.redirect(fail);
      }
      const paymentRow = paymentRecord.rows[0] as { user_id: number; course_id: number };
      await verifyCourseOrderOwnership({
        orderId: razorpay_order_id,
        expectedUserId: paymentRow.user_id,
        expectedCourseId: paymentRow.course_id,
      });
      const preBind = await assertNativePaidPurchaseInstallation(db, paymentRow.user_id, req);
      if (!preBind.ok) {
        await logPaymentFailure({
          userId: paymentRow.user_id,
          courseId: paymentRow.course_id,
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          source: "verify_redirect",
          reason: preBind.message || "device_binding_mismatch",
        });
        return res.redirect(fail);
      }
      const result = await completeCoursePaymentByOrder({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      });
      await finalizeInstallationBindAfterPurchase(db, result.userId, req);
      return res.redirect(`${frontendBase}/course/${result.courseId}?payment=success`);
    } catch (err) {
      console.error("[Payments] redirect verify failed:", err);
      await logPaymentFailure({
        orderId: (req.body as any)?.razorpay_order_id || null,
        paymentId: (req.body as any)?.razorpay_payment_id || null,
        source: "verify_redirect",
        reason: "Redirect verification failed",
        rawError: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      return res.redirect(fail);
    }
  });

  // Explicit client-side payment failed callback logging.
  app.post("/api/payments/track-failure", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const body = (req.body || {}) as Record<string, any>;
      await logPaymentFailure({
        userId: user?.id ?? null,
        courseId: Number(body.courseId) || null,
        orderId: typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : null,
        paymentId: typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : null,
        source: "client_callback",
        reason: typeof body.reason === "string" ? body.reason : "Client payment failed callback",
        rawError: body.error ?? null,
      });
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
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
      const testResult = await db.query("SELECT id, price FROM tests WHERE id = $1", [testId]);
      if (!testResult.rows.length) return res.redirect(fail);
      const expectedAmount = Math.round(parseFloat(String(testResult.rows[0].price || "0")) * 100);
      await verifyOrderOwnershipAndAmount({
        orderId: razorpay_order_id,
        expectedKind: "test",
        expectedUserId: userId,
        expectedItemId: testId,
        expectedAmount,
      });
      const preTest = await assertNativePaidPurchaseInstallation(db, userId, req);
      if (!preTest.ok) return res.redirect(fail);
      await db.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [userId, testId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db, userId, req);
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
      const parsedTestId = Number(testId);
      if (!parsedTestId) return res.status(400).json({ message: "testId is required" });
      const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      const testResult = await db.query("SELECT id, price FROM tests WHERE id = $1", [parsedTestId]);
      if (!testResult.rows.length) return res.status(404).json({ message: "Test not found" });
      const expectedAmount = Math.round(parseFloat(String(testResult.rows[0].price || "0")) * 100);
      await verifyOrderOwnershipAndAmount({
        orderId: razorpay_order_id,
        expectedKind: "test",
        expectedUserId: user.id,
        expectedItemId: parsedTestId,
        expectedAmount,
      });
      const preTest = await assertNativePaidPurchaseInstallation(db, user.id, req);
      if (!preTest.ok) {
        return res.status(403).json({ message: preTest.message });
      }
      await db.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [user.id, parsedTestId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db, user.id, req);
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

