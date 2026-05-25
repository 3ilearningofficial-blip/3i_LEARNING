import type { Express, Request, Response } from "express";
import {
  assertNativePaidPurchaseInstallation,
  finalizeInstallationBindAfterPurchase,
} from "./native-device-binding";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterTestFolderRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
  getRazorpay: () => any;
  verifyPaymentSignature: (orderId: string, paymentId: string, signature: string) => boolean;
};

export function registerTestFolderRoutes({
  app,
  db,
  getAuthUser,
  getRazorpay,
  verifyPaymentSignature,
}: RegisterTestFolderRoutesDeps): void {
  const verifyFolderOrder = async (orderId: string, userId: number, folderId: number) => {
    const folderResult = await db.query(
      "SELECT id, price, is_free FROM standalone_folders WHERE id = $1 AND type = 'mini_course'",
      [folderId]
    );
    if (!folderResult.rows.length) throw new Error("Folder not found");
    const folder = folderResult.rows[0];
    if (folder.is_free || parseFloat(String(folder.price || "0")) <= 0) {
      throw new Error("This folder is free");
    }
    const expectedAmount = Math.round(parseFloat(String(folder.price || "0")) * 100);
    const razorpay = getRazorpay();
    const order: { amount?: number; notes?: Record<string, string> } = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};
    const noteKind = String(notes.kind || "");
    const noteUserId = Number(notes.userId || 0);
    const noteFolderId = Number(notes.folderId || 0);
    const amount = Number(order.amount || 0);
    if (noteKind !== "test_folder") throw new Error("Payment kind mismatch");
    if (!noteUserId || noteUserId !== userId) throw new Error("Payment user mismatch");
    if (!noteFolderId || noteFolderId !== folderId) throw new Error("Payment folder mismatch");
    if (!amount || amount !== expectedAmount) throw new Error("Payment amount mismatch");
  };

  app.get("/api/test-folders", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const result = await db.query(
        "SELECT sf.*, (SELECT COUNT(*) FROM tests t WHERE t.mini_course_id = sf.id) as total_tests FROM standalone_folders sf WHERE sf.type = 'mini_course' AND (sf.is_hidden = FALSE OR sf.is_hidden IS NULL) ORDER BY sf.created_at DESC"
      );
      const folders = result.rows.map((f: any) => ({ ...f, is_purchased: false }));
      if (user) {
        const purchases = await db.query("SELECT folder_id FROM folder_purchases WHERE user_id = $1", [user.id]);
        const purchasedIds = new Set(purchases.rows.map((p: any) => p.folder_id));
        for (const f of folders) f.is_purchased = f.is_free || purchasedIds.has(f.id);
      } else {
        for (const f of folders) f.is_purchased = f.is_free;
      }
      res.json(folders);
    } catch (err) {
      console.error("Test folders error:", err);
      res.status(500).json({ message: "Failed to fetch test folders" });
    }
  });

  app.get("/api/test-folders/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1 AND type = 'mini_course'", [req.params.id]);
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      const f = folder.rows[0];
      const tests = await db.query("SELECT t.*, t.folder_name as sub_folder FROM tests t WHERE t.mini_course_id = $1 ORDER BY t.folder_name ASC NULLS LAST, t.created_at ASC", [f.id]);
      let isPurchased = f.is_free;
      const attempts: Record<number, any> = {};
      if (user) {
        const purchase = await db.query("SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2", [user.id, f.id]);
        if (purchase.rows.length > 0) isPurchased = true;
        if (tests.rows.length > 0) {
          const attemptsResult = await db.query(
            "SELECT test_id, score, total_marks, completed_at FROM test_attempts WHERE user_id = $1 AND test_id = ANY($2) AND completed_at IS NOT NULL ORDER BY score DESC",
            [user.id, tests.rows.map((t: any) => t.id)]
          );
          for (const a of attemptsResult.rows) {
            if (!attempts[a.test_id]) attempts[a.test_id] = a;
          }
        }
      }
      res.json({ ...f, is_purchased: isPurchased, tests: tests.rows, attempts });
    } catch (err) {
      console.error("Test folder detail error:", err);
      res.status(500).json({ message: "Failed to fetch folder" });
    }
  });

  app.post("/api/test-folders/:id/enroll", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1 AND type = 'mini_course'", [req.params.id]);
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      if (!folder.rows[0].is_free) return res.status(400).json({ message: "This folder requires payment" });
      await db.query("INSERT INTO folder_purchases (user_id, folder_id, amount) VALUES ($1, $2, 0) ON CONFLICT (user_id, folder_id) DO NOTHING", [user.id, req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to enroll" });
    }
  });

  app.post("/api/test-folders/create-order", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folderId = Number((req.body as { folderId?: number }).folderId);
      if (!folderId) return res.status(400).json({ message: "Folder ID required" });

      const folderResult = await db.query(
        "SELECT id, name, price, is_free FROM standalone_folders WHERE id = $1 AND type = 'mini_course'",
        [folderId]
      );
      if (!folderResult.rows.length) return res.status(404).json({ message: "Folder not found" });
      const folder = folderResult.rows[0];
      if (folder.is_free || parseFloat(String(folder.price || "0")) <= 0) {
        return res.status(400).json({ message: "This folder is free" });
      }

      const existing = await db.query(
        "SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2",
        [user.id, folderId]
      );
      if (existing.rows.length > 0) return res.json({ alreadyPurchased: true });

      const amount = Math.round(parseFloat(String(folder.price || "0")) * 100);
      const razorpay = getRazorpay();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `folder_${folderId}_user_${user.id}_${Date.now()}`,
        notes: {
          folderId: String(folderId),
          userId: String(user.id),
          folderName: folder.name,
          kind: "test_folder",
        },
      });

      return res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        folderName: folder.name,
      });
    } catch (err) {
      console.error("Test folder create-order error:", err);
      return res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  app.post("/api/test-folders/verify-payment", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { folderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      const parsedFolderId = Number(folderId);
      if (!parsedFolderId) return res.status(400).json({ message: "folderId is required" });
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: "Payment details are required" });
      }

      const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });

      await verifyFolderOrder(razorpay_order_id, user.id, parsedFolderId);

      const pre = await assertNativePaidPurchaseInstallation(db, user.id, req);
      if (!pre.ok) return res.status(403).json({ message: pre.message });

      await db.query(
        "INSERT INTO folder_purchases (user_id, folder_id, amount, payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, folder_id) DO NOTHING",
        [user.id, parsedFolderId, null, razorpay_payment_id, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db, user.id, req);

      return res.json({ success: true });
    } catch (err) {
      console.error("Test folder verify-payment error:", err);
      return res.status(500).json({ message: "Failed to verify payment" });
    }
  });

  app.post("/api/test-folders/verify-redirect", async (req: Request, res: Response) => {
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
      const notes = order.notes || {};
      if (String(notes.kind || "") !== "test_folder") return res.redirect(fail);
      const folderId = Number(notes.folderId || 0);
      const userId = Number(notes.userId || 0);
      if (!folderId || !userId) return res.redirect(fail);

      await verifyFolderOrder(razorpay_order_id, userId, folderId);

      const pre = await assertNativePaidPurchaseInstallation(db, userId, req);
      if (!pre.ok) return res.redirect(fail);

      await db.query(
        "INSERT INTO folder_purchases (user_id, folder_id, amount, payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, folder_id) DO NOTHING",
        [userId, folderId, null, razorpay_payment_id, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db, userId, req);

      return res.redirect(`${frontendBase}/test-folder/${folderId}?payment=success`);
    } catch (err) {
      console.error("Test folder verify-redirect error:", err);
      return res.redirect(fail);
    }
  });
}

