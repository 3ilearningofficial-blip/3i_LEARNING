import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterBookRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getAuthUser: (req: Request) => Promise<any>;
  getRazorpay: () => any;
  verifyPaymentSignature: (orderId: string, paymentId: string, signature: string) => boolean;
};

export function registerBookRoutes({
  app,
  db,
  requireAdmin,
  getAuthUser,
  getRazorpay,
  verifyPaymentSignature,
}: RegisterBookRoutesDeps): void {
  app.get("/api/books", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const isAdmin = user?.role === "admin";
      const result = await db.query(
        isAdmin
          ? "SELECT * FROM books ORDER BY created_at DESC"
          : "SELECT * FROM books WHERE is_published = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL) ORDER BY created_at DESC"
      );
      const books = result.rows;
      if (user) {
        const purchased = await db.query("SELECT book_id FROM book_purchases WHERE user_id = $1", [user.id]);
        const purchasedIds = new Set(purchased.rows.map((r: any) => r.book_id));
        books.forEach((b: any) => {
          b.isPurchased = purchasedIds.has(b.id);
        });
      }
      res.json(books);
    } catch {
      res.status(500).json({ message: "Failed to fetch books" });
    }
  });

  app.get("/api/my-books", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT b.*, bp.purchased_at FROM books b
         JOIN book_purchases bp ON b.id = bp.book_id
         WHERE bp.user_id = $1 ORDER BY bp.purchased_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch purchased books" });
    }
  });

  app.get("/api/admin/books", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM books ORDER BY created_at DESC");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch books" });
    }
  });

  app.post("/api/admin/books", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });
      const result = await db.query(
        `INSERT INTO books (title, description, author, price, original_price, cover_url, file_url, is_published, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, description || "", author || "", price || 0, originalPrice || 0, coverUrl || null, fileUrl || null, isPublished !== false, Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create book" });
    }
  });

  app.put("/api/admin/books/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished } = req.body;
      await db.query(
        `UPDATE books SET title=$1, description=$2, author=$3, price=$4, original_price=$5, cover_url=$6, file_url=$7, is_published=$8 WHERE id=$9`,
        [title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished, req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update book" });
    }
  });

  app.put("/api/admin/books/:id/hide", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { hidden } = req.body;
      await db.query("UPDATE books SET is_hidden = $1 WHERE id = $2", [hidden, req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update book" });
    }
  });

  app.delete("/api/admin/books/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM book_purchases WHERE book_id = $1", [req.params.id]);
      await db.query("DELETE FROM book_click_tracking WHERE book_id = $1", [req.params.id]).catch(() => {});
      await db.query("DELETE FROM books WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete book" });
    }
  });

  app.post("/api/books/track-click", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ ok: true });
      const { bookId } = req.body;
      if (!bookId) return res.json({ ok: true });
      const purchased = await db.query("SELECT id FROM book_purchases WHERE user_id = $1 AND book_id = $2", [user.id, bookId]);
      if (purchased.rows.length > 0) return res.json({ ok: true });
      const result = await db.query(
        `
        INSERT INTO book_click_tracking (user_id, book_id, click_count, created_at)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (user_id, book_id) DO UPDATE SET click_count = book_click_tracking.click_count + 1
        RETURNING click_count
      `,
        [user.id, bookId, Date.now()]
      );
      console.log(`[BookClick] user=${user.id} book=${bookId} count=${result.rows[0]?.click_count}`);
      res.json({ ok: true });
    } catch (err) {
      console.error("[BookBuyNow] track-click error:", err);
      res.json({ ok: true });
    }
  });

  app.post("/api/books/create-order", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { bookId } = req.body;
      if (!bookId) return res.status(400).json({ message: "Book ID required" });
      console.log(`[BookOrder] user=${user.id} bookId=${bookId}`);
      const bookResult = await db.query("SELECT * FROM books WHERE id = $1", [bookId]);
      if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
      const book = bookResult.rows[0];
      if (parseFloat(book.price) === 0) return res.status(400).json({ message: "This book is free" });
      const alreadyPurchased = await db.query("SELECT id FROM book_purchases WHERE user_id = $1 AND book_id = $2", [user.id, bookId]);
      if (alreadyPurchased.rows.length > 0) return res.status(400).json({ message: "Already purchased" });
      const amount = Math.round(parseFloat(book.price) * 100);
      const razorpay = getRazorpay();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `book_${bookId}_user_${user.id}_${Date.now()}`,
        notes: {
          bookId: String(bookId),
          userId: String(user.id),
          bookTitle: book.title,
          kind: "book",
        },
      });
      console.log(`[BookOrder] created orderId=${order.id} amount=${amount}`);
      res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, bookTitle: book.title, bookId });
    } catch (err) {
      console.error("Book create-order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  app.post("/api/books/verify-redirect", async (req: Request, res: Response) => {
    const frontendBase = process.env.FRONTEND_URL || "https://3ilearning.in";
    const fail = `${frontendBase}/store?payment=failed`;
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
      if (n.kind !== "book") return res.redirect(fail);
      const bookId = parseInt(n.bookId || "0", 10);
      const userId = parseInt(n.userId || "0", 10);
      if (!bookId || !userId) return res.redirect(fail);
      await db.query(
        "INSERT INTO book_purchases (user_id, book_id, purchased_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, book_id) DO NOTHING",
        [userId, bookId, Date.now()]
      );
      await db.query("DELETE FROM book_click_tracking WHERE user_id = $1 AND book_id = $2", [userId, bookId]).catch(() => {});
      return res.redirect(`${frontendBase}/store?payment=success&bookId=${bookId}`);
    } catch (err) {
      console.error("Book verify-redirect error:", err);
      return res.redirect(fail);
    }
  });

  app.post("/api/books/verify-payment", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { bookId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
      const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      await db.query("INSERT INTO book_purchases (user_id, book_id, purchased_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, book_id) DO NOTHING", [user.id, bookId, Date.now()]);
      await db.query("DELETE FROM book_click_tracking WHERE user_id = $1 AND book_id = $2", [user.id, bookId]).catch(() => {});
      res.json({ success: true });
    } catch (err) {
      console.error("Book verify-payment error:", err);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });
}

