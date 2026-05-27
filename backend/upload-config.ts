/**
 * Centralised multer upload configurations.
 * All file uploads pass through memory storage — no disk writes.
 *
 * Three profiles:
 *  - upload      — generic images / attachments, 10 MB cap
 *  - uploadPdf   — PDF-only, 10 MB cap with mime-type filter
 *  - (no large upload profile; large assets must use direct presigned R2 PUT)
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
