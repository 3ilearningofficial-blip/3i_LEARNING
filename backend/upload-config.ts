/**
 * Centralised multer upload configurations.
 * All file uploads pass through memory storage — no disk writes.
 *
 * Three profiles:
 *  - upload      — generic images / attachments, 10 MB cap
 *  - uploadPdf   — PDF-only, 10 MB cap with mime-type filter
 *  - uploadLarge — video / large assets, 500 MB cap
 */
import multer from "multer";

/** Generic 10 MB in-memory upload (images, attachments). */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** PDF-only 10 MB in-memory upload with strict mime-type guard. */
export const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mimetype = String(file?.mimetype || "").toLowerCase();
    if (mimetype === "application/pdf") return cb(null, true);
    return cb(new Error("Only PDF files are allowed"));
  },
});

/** Large-asset 500 MB in-memory upload (video files). */
export const uploadLarge = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});
