import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminQuestionBulkRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  upload: any;
  PDFParse: any;
};

function parseQuestionsFromText(text: string): Array<{ questionText: string; optionA: string; optionB: string; optionC: string; optionD: string; correctOption: string }> {
  type Q = { questionText: string; optionA: string; optionB: string; optionC: string; optionD: string; correctOption: string };
  const questions: Q[] = [];

  const normalized = text
    .replace(/\f/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, "")
    .replace(/^[\s\-\*\>\•]+/gm, (m) => m.replace(/[\-\*\>\•]/g, "").trimStart());

  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const isQuestion = (l: string) => /^(Q\.?\s*\d+|Q\d+|Question\s*\d+|\d+[\.\)\:])\s*[\.\)\:]?\s*.+/i.test(l);
  const isOptionLetter = (l: string) => /^[AaBbCcDd][\.\)\:]?\s*$/.test(l);
  const isOption = (l: string) =>
    /^[\(\[]?[AaBbCcDd][\)\]\.\:][\s\)]/.test(l) ||
    /^\([AaBbCcDd]\)/.test(l) ||
    /^[AaBbCcDd]\s*[\.\)]\s*/.test(l) ||
    /^[AaBbCcDd]\s+\S/.test(l);

  const getOptionLetter = (l: string): string => {
    const m = l.match(/^[\(\[]?([AaBbCcDd])[\)\]\.\:]/);
    if (m) return m[1].toUpperCase();
    const m2 = l.match(/^\(([AaBbCcDd])\)/);
    if (m2) return m2[1].toUpperCase();
    const m3 = l.match(/^([AaBbCcDd])\s+\S/);
    if (m3) return m3[1].toUpperCase();
    return "";
  };

  const stripOptionPrefix = (l: string) => l.replace(/^[\(\[]?[AaBbCcDd][\)\]\.\:]\s*/, "").replace(/^\([AaBbCcDd]\)\s*/, "").replace(/^[AaBbCcDd]\s+/, "").trim();
  const stripQuestionPrefix = (l: string) => l.replace(/^(Q\.?\s*\d+|Q\d+|Question\s*\d+|\d+)[\.\)\:]?\s*/i, "").trim();
  const isAnswer = (l: string) =>
    /^(Answer|Ans|Correct\s*Answer|Key|Sol|Solution)[\s\:\.\-]*[:\-]?\s*[\(\[]?[A-Da-d][\)\]]?/i.test(l) ||
    /^Correct[\s:]+[A-Da-d]/i.test(l) ||
    /^Answer\s*-\s*[A-Da-d]/i.test(l);

  const getAnswerLetter = (l: string): string => {
    const m = l.match(/[:\-\s]\s*[\(\[]?([A-Da-d])[\)\]]?\s*$/i);
    if (m) return m[1].toUpperCase();
    const m2 = l.match(/[\(\[]?([A-Da-d])[\)\]]?\s*$/);
    if (m2) return m2[1].toUpperCase();
    return "A";
  };

  let curQ = "";
  const tryParseInline = (l: string): Q | null => {
    const inlineMatch = l.match(/^(?:Q\.?\s*\d+[\.\)]?\s*|Q\d+[\.\)]?\s*|\d+[\.\)]\s*)(.+?)\s*[\(\[](A)[\)\]]\s*(.+?)\s*[\(\[](B)[\)\]]\s*(.+?)\s*[\(\[](C)[\)\]]\s*(.+?)\s*[\(\[](D)[\)\]]\s*(.+?)(?:\s*(?:Ans|Answer|Key)[\s:\-]*[\(\[]?([A-Da-d])[\)\]]?)?$/i);
    if (inlineMatch) {
      return {
        questionText: inlineMatch[1].trim(),
        optionA: inlineMatch[3].trim(),
        optionB: inlineMatch[5].trim(),
        optionC: inlineMatch[7].trim(),
        optionD: inlineMatch[9].trim(),
        correctOption: inlineMatch[10] ? inlineMatch[10].toUpperCase() : "A",
      };
    }
    const lcInline = l.match(/\(([aAbB])\)\s*(.+?)\s*\(([bBcC])\)\s*(.+?)\s*\(([cCdD])\)\s*(.+?)\s*\(([dD])\)\s*(.+?)(?:\s*(?:Ans(?:wer)?|Key|Correct)[\s:\-]+[\(\[]?([A-Da-d])[\)\]]?)?$/i);
    if (lcInline && curQ) {
      return {
        questionText: curQ,
        optionA: lcInline[2].trim(),
        optionB: lcInline[4].trim(),
        optionC: lcInline[6].trim(),
        optionD: lcInline[8].trim(),
        correctOption: lcInline[9] ? lcInline[9].toUpperCase() : "A",
      };
    }
    return null;
  };

  let opts: Record<string, string> = {};
  let correct = "A";
  let pendingOptionLetter = "";

  const flush = () => {
    if (curQ && (opts["A"] || opts["B"])) {
      questions.push({
        questionText: curQ,
        optionA: opts["A"] || "",
        optionB: opts["B"] || "",
        optionC: opts["C"] || "",
        optionD: opts["D"] || "",
        correctOption: correct,
      });
    }
    curQ = "";
    opts = {};
    correct = "A";
    pendingOptionLetter = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (pendingOptionLetter) {
      opts[pendingOptionLetter] = line;
      pendingOptionLetter = "";
      continue;
    }

    const inline = tryParseInline(line);
    if (inline) {
      flush();
      questions.push(inline);
      continue;
    }

    if (isQuestion(line)) {
      flush();
      curQ = stripQuestionPrefix(line);
      const inlineAfterQ = tryParseInline(line);
      if (inlineAfterQ) {
        questions.push(inlineAfterQ);
        curQ = "";
        opts = {};
        correct = "A";
        pendingOptionLetter = "";
      }
    } else if (isOptionLetter(line)) {
      pendingOptionLetter = line.replace(/[\.\)\:]/g, "").trim().toUpperCase();
    } else if (isOption(line)) {
      const letter = getOptionLetter(line);
      if (letter) opts[letter] = stripOptionPrefix(line);
    } else if (isAnswer(line)) {
      correct = getAnswerLetter(line);
    } else if (curQ && Object.keys(opts).length === 0) {
      curQ += " " + line;
    }
  }
  flush();

  return questions;
}

export function registerAdminQuestionBulkRoutes({
  app,
  db,
  requireAdmin,
  upload,
  PDFParse,
}: RegisterAdminQuestionBulkRoutesDeps): void {
  app.post("/api/admin/questions/bulk-text", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { testId, text, defaultMarks, defaultNegativeMarks, save } = req.body;
      if (!testId || !text) {
        return res.status(400).json({ message: "testId and text are required" });
      }

      const parsed = parseQuestionsFromText(text);
      if (parsed.length === 0) {
        return res.status(400).json({ message: "No questions could be parsed from the provided text" });
      }

      if (save) {
        const maxOrderResult = await db.query("SELECT COALESCE(MAX(order_index), 0) as max_order FROM questions WHERE test_id = $1", [testId]);
        let idx = maxOrderResult.rows[0]?.max_order || 0;
        for (const q of parsed) {
          idx++;
          await db.query(
            `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, marks, negative_marks, order_index) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption, (q as any).explanation || "", "medium", defaultMarks || 4, defaultNegativeMarks || 1, idx]
          );
        }
        await db.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [testId]);
      }

      res.json({ success: true, count: parsed.length, questions: parsed });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to parse and add questions" });
    }
  });

  app.post("/api/admin/questions/bulk-pdf", requireAdmin, upload.single("pdf"), async (req: Request, res: Response) => {
    try {
      const testId = req.body.testId;
      const defaultMarks = parseInt(req.body.defaultMarks) || 4;
      const defaultNegativeMarks = parseFloat(req.body.defaultNegativeMarks) || 1;

      console.log("[bulk-pdf] upload received", { testId, fileName: req.file?.originalname, size: req.file?.size });

      if (!testId || !req.file) {
        return res.status(400).json({ message: !testId ? "testId is required" : "PDF file is required — make sure you selected a .pdf file" });
      }

      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      const text = result.text;
      console.log("[bulk-pdf] extracted text length:", text.length);

      const parsed = parseQuestionsFromText(text);
      console.log("[bulk-pdf] parsed questions:", parsed.length);
      if (parsed.length === 0) {
        return res.status(400).json({
          message: "No questions could be parsed from the PDF. Make sure questions are numbered (Q1, 1., etc.) with options labeled A, B, C, D.",
          rawTextPreview: text.substring(0, 500),
        });
      }

      res.json({ success: true, count: parsed.length, questions: parsed });
    } catch (err: any) {
      console.error("[bulk-pdf] error:", err);
      res.status(500).json({ message: `Failed to parse PDF: ${err?.message || "unknown error"}` });
    }
  });

  app.post("/api/admin/questions/bulk-save", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { testId, questions, defaultMarks, defaultNegativeMarks } = req.body;
      if (!testId || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "testId and questions array are required" });
      }
      const maxOrderResult = await db.query("SELECT COALESCE(MAX(order_index), 0) as max_order FROM questions WHERE test_id = $1", [testId]);
      let idx = maxOrderResult.rows[0]?.max_order || 0;
      for (const q of questions) {
        idx++;
        await db.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, marks, negative_marks, order_index, image_url, solution_image_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption || "A", q.explanation || "", "medium", defaultMarks || 4, defaultNegativeMarks || 1, idx, q.imageUrl || null, q.solutionImageUrl || null]
        );
      }
      await db.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [testId]);
      res.json({ success: true, count: questions.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to save questions" });
    }
  });
}

