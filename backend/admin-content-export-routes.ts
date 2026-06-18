import type { Express, Request, Response } from "express";
import { canonicalMediaKey } from "./media-key-utils";
import { presignR2GetObject } from "./r2-presign-read";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminContentExportRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getR2Client: () => Promise<any>;
};

function safeFilename(raw: string, fallback: string): string {
  const base = String(raw || fallback).replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120);
  return base || fallback;
}

async function buildTestPdfBuffer(test: any, questions: any[]): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;
  const lineHeight = 14;
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;

  const addLine = (text: string, opts?: { bold?: boolean; size?: number }) => {
    const size = opts?.size ?? 11;
    doc.setFontSize(size);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(String(line), margin, y);
      y += lineHeight + (size > 11 ? 4 : 0);
    }
  };

  addLine(test.title || "Test", { bold: true, size: 16 });
  y += 8;
  addLine(`Type: ${test.test_type || "practice"} · Questions: ${questions.length}`);
  y += 12;

  questions.forEach((q, idx) => {
    addLine(`Q${idx + 1}. ${q.question_text || ""}`, { bold: true });
    ["A", "B", "C", "D"].forEach((letter) => {
      const key = `option_${letter.toLowerCase()}` as keyof typeof q;
      const val = q[key];
      if (val) addLine(`(${letter}) ${val}`);
    });
    if (q.correct_option) addLine(`Answer: ${q.correct_option}`);
    if (q.explanation) addLine(`Explanation: ${q.explanation}`);
    y += 10;
  });

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

export function registerAdminContentExportRoutes({
  app,
  db,
  requireAdmin,
  getR2Client,
}: RegisterAdminContentExportRoutesDeps): void {
  app.get("/api/admin/export/test/:id.pdf", requireAdmin, async (req: Request, res: Response) => {
    try {
      const testId = Number(req.params.id);
      if (!Number.isFinite(testId)) return res.status(400).json({ message: "Invalid test id" });
      const testRes = await db.query("SELECT * FROM tests WHERE id = $1 LIMIT 1", [testId]);
      if (!testRes.rows.length) return res.status(404).json({ message: "Test not found" });
      const test = testRes.rows[0];
      const qRes = await db.query(
        "SELECT * FROM questions WHERE test_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC",
        [testId]
      );
      const pdf = await buildTestPdfBuffer(test, qRes.rows);
      const filename = safeFilename(test.title, `test-${testId}`) + ".pdf";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err) {
      console.error("[admin-export] test pdf:", err);
      res.status(500).json({ message: "Failed to export test PDF" });
    }
  });

  app.get("/api/admin/export/material/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const materialId = Number(req.params.id);
      if (!Number.isFinite(materialId)) return res.status(400).json({ message: "Invalid material id" });
      const matRes = await db.query("SELECT * FROM study_materials WHERE id = $1 LIMIT 1", [materialId]);
      if (!matRes.rows.length) return res.status(404).json({ message: "Material not found" });
      const mat = matRes.rows[0];
      const key = canonicalMediaKey(mat.file_url || "");
      if (!key) return res.status(400).json({ message: "Material has no file" });
      const url = await presignR2GetObject(getR2Client, key, 3600);
      if (!url) return res.status(502).json({ message: "Could not presign material file" });
      const filename = safeFilename(mat.title, `material-${materialId}`) + (String(mat.file_type || "pdf").includes("pdf") ? ".pdf" : "");
      res.redirect(url);
    } catch (err) {
      console.error("[admin-export] material:", err);
      res.status(500).json({ message: "Failed to export material" });
    }
  });

  app.get("/api/admin/export/lecture/:id.mp4", requireAdmin, async (req: Request, res: Response) => {
    try {
      const lectureId = Number(String(req.params.id).replace(/\.mp4$/i, ""));
      if (!Number.isFinite(lectureId)) return res.status(400).json({ message: "Invalid lecture id" });
      const lecRes = await db.query("SELECT * FROM lectures WHERE id = $1 LIMIT 1", [lectureId]);
      if (!lecRes.rows.length) return res.status(404).json({ message: "Lecture not found" });
      const lec = lecRes.rows[0];
      const key = canonicalMediaKey(lec.video_url || "");
      if (!key) return res.status(400).json({ message: "Lecture has no video file" });
      const url = await presignR2GetObject(getR2Client, key, 3600);
      if (!url) return res.status(502).json({ message: "Could not presign lecture video" });
      res.redirect(url);
    } catch (err) {
      console.error("[admin-export] lecture mp4:", err);
      res.status(500).json({ message: "Failed to export lecture video" });
    }
  });
}
