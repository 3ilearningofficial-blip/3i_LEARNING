import type { Express, Request, Response } from "express";
import { canonicalMediaKey } from "./media-key-utils";

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

async function buildQuestionsPdfBuffer(
  title: string,
  subtitle: string,
  questions: any[],
): Promise<Buffer> {
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

  addLine(title || "Export", { bold: true, size: 16 });
  y += 8;
  if (subtitle) addLine(subtitle);
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

function normalizeMissionQuestions(raw: unknown): any[] {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((q: any) => {
    const options = Array.isArray(q?.options) ? q.options : [];
    return {
      question_text: String(q?.question || q?.question_text || "").trim(),
      option_a: String(options[0] ?? q?.option_a ?? "").trim(),
      option_b: String(options[1] ?? q?.option_b ?? "").trim(),
      option_c: String(options[2] ?? q?.option_c ?? "").trim(),
      option_d: String(options[3] ?? q?.option_d ?? "").trim(),
      correct_option: String(q?.correct || q?.correct_option || "").trim(),
      explanation: String(q?.solution || q?.explanation || "").trim(),
    };
  });
}

function guessDownloadExtension(key: string, contentType?: string | null, fallback = ""): string {
  const fromKey = key.match(/(\.[a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromKey) return fromKey;
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("mp4")) return ".mp4";
  if (ct.includes("mpeg")) return ".mp3";
  return fallback;
}

async function streamR2FileToResponse(
  getR2Client: () => Promise<any>,
  res: Response,
  key: string,
  downloadName: string,
): Promise<void> {
  const bucket = String(process.env.R2_BUCKET_NAME || "").trim();
  if (!bucket) {
    res.status(500).json({ message: "Storage not configured" });
    return;
  }
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = await getR2Client();
  const r2Response = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!r2Response.Body) {
    res.status(404).json({ message: "File not found in storage" });
    return;
  }

  const ext = guessDownloadExtension(key, r2Response.ContentType);
  const baseName = safeFilename(downloadName, "download");
  const filename = baseName.toLowerCase().endsWith(ext) || !ext ? baseName : `${baseName}${ext}`;

  res.setHeader("Content-Type", r2Response.ContentType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  if (r2Response.ContentLength != null) {
    res.setHeader("Content-Length", String(r2Response.ContentLength));
  }

  const stream = r2Response.Body as NodeJS.ReadableStream & {
    pipe?: (dest: Response) => Response;
    on?: (event: string, cb: (...args: any[]) => void) => void;
  };
  if (typeof stream.pipe !== "function") {
    res.status(500).json({ message: "Could not stream file" });
    return;
  }
  stream.pipe(res);
  stream.on?.("error", (err: Error) => {
    console.error("[admin-export] stream error:", err);
    if (!res.headersSent) res.status(500).json({ message: "Stream error" });
  });
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
      const pdf = await buildQuestionsPdfBuffer(
        test.title || "Test",
        `Type: ${test.test_type || "practice"} · Questions: ${qRes.rows.length}`,
        qRes.rows,
      );
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
      await streamR2FileToResponse(getR2Client, res, key, safeFilename(mat.title, `material-${materialId}`));
    } catch (err) {
      console.error("[admin-export] material:", err);
      res.status(500).json({ message: "Failed to export material" });
    }
  });

  app.get("/api/admin/export/mission/:id.pdf", requireAdmin, async (req: Request, res: Response) => {
    try {
      const missionId = Number(String(req.params.id).replace(/\.pdf$/i, ""));
      if (!Number.isFinite(missionId)) return res.status(400).json({ message: "Invalid mission id" });
      const missionRes = await db.query("SELECT * FROM daily_missions WHERE id = $1 LIMIT 1", [missionId]);
      if (!missionRes.rows.length) return res.status(404).json({ message: "Mission not found" });
      const mission = missionRes.rows[0];
      const questions = normalizeMissionQuestions(mission.questions);
      if (!questions.length) return res.status(400).json({ message: "Mission has no questions" });
      const pdf = await buildQuestionsPdfBuffer(
        mission.title || "Mission",
        `Type: ${mission.mission_type || "daily_drill"} · Questions: ${questions.length}`,
        questions,
      );
      const filename = safeFilename(mission.title, `mission-${missionId}`) + ".pdf";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err) {
      console.error("[admin-export] mission pdf:", err);
      res.status(500).json({ message: "Failed to export mission PDF" });
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
      await streamR2FileToResponse(getR2Client, res, key, safeFilename(lec.title, `lecture-${lectureId}`));
    } catch (err) {
      console.error("[admin-export] lecture mp4:", err);
      res.status(500).json({ message: "Failed to export lecture video" });
    }
  });
}
