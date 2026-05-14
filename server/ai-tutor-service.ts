type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

/** `auto` tries Gemini first, then OpenAI. `openai` / `gemini` force a single provider. */
export type AiProviderMode = "auto" | "gemini" | "openai";

export function getAiProviderMode(): AiProviderMode {
  const raw = (process.env.AI_PROVIDER || "auto").trim().toLowerCase();
  if (raw === "openai" || raw === "gemini" || raw === "auto") return raw;
  return "auto";
}

/** Non-secret snapshot for `/api/health/ai-providers` and ops checks. */
export function getAiTutorHealthSnapshot(): {
  geminiConfigured: boolean;
  openaiConfigured: boolean;
  openaiModel: string;
  aiProvider: AiProviderMode;
  resolvedOrder: string[];
} {
  const geminiConfigured = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
  const openaiConfigured = !!process.env.OPENAI_API_KEY?.trim();
  const openaiModel = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const aiProvider = getAiProviderMode();
  let resolvedOrder: string[] = [];
  if (aiProvider === "openai") {
    resolvedOrder = openaiConfigured ? ["openai"] : [];
  } else if (aiProvider === "gemini") {
    resolvedOrder = geminiConfigured ? ["gemini"] : [];
  } else {
    if (geminiConfigured) resolvedOrder.push("gemini");
    if (openaiConfigured) resolvedOrder.push("openai");
  }
  return { geminiConfigured, openaiConfigured, openaiModel, aiProvider, resolvedOrder };
}

const TRANSCRIPT_CONTEXT_CHARS = 8000;

export function createGenerateAIAnswer(db: DbClient) {
  return async function generateAIAnswer(question: string, topic?: string, userId?: number): Promise<string> {
    const q = String(question || "").trim();
    const t = String(topic || "").trim();
    if (!q) return "Please share your full question so I can help step by step.";

    const tokenize = (text: string): string[] =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2);

    const stop = new Set([
      "the", "and", "for", "with", "that", "this", "from", "what", "when", "where", "which", "into",
      "about", "have", "has", "had", "how", "why", "are", "can", "could", "would", "should", "your",
      "you", "our", "their", "there", "then", "than", "also", "just", "some", "solve", "find", "show",
      "math", "question", "doubt", "topic",
    ]);
    const keywords = Array.from(new Set([...tokenize(q), ...tokenize(t)].filter((w) => !stop.has(w))));

    type Snippet = { source: string; title: string; text: string; score: number };
    const scoreSnippet = (text: string): number => {
      if (!keywords.length) return 0;
      const lower = text.toLowerCase();
      let score = 0;
      for (const k of keywords) {
        if (lower.includes(k)) score += 1;
      }
      return score;
    };

    const snippets: Snippet[] = [];
    try {
      if (userId) {
        const lectures = await db.query(
          `SELECT l.title, COALESCE(l.description, '') AS description, COALESCE(l.transcript, '') AS transcript,
                  COALESCE(c.title, '') AS course_title
           FROM lectures l
           JOIN enrollments e ON e.course_id = l.course_id AND e.user_id = $1
           LEFT JOIN courses c ON c.id = l.course_id
           WHERE (e.status = 'active' OR e.status IS NULL)
           ORDER BY l.created_at DESC
           LIMIT 120`,
          [userId]
        );
        for (const row of lectures.rows) {
          const transcriptPart = String(row.transcript || "").trim();
          const transcriptChunk = transcriptPart ? transcriptPart.slice(0, TRANSCRIPT_CONTEXT_CHARS) : "";
          const text = [String(row.title || "").trim(), String(row.description || "").trim(), transcriptChunk]
            .filter(Boolean)
            .join(". ");
          snippets.push({
            source: "lecture",
            title: `${row.course_title || "Course"} - ${row.title || "Lecture"}`,
            text: text || String(row.title || ""),
            score: scoreSnippet(text),
          });
        }

        const materials = await db.query(
          `SELECT sm.title, COALESCE(sm.description, '') AS description, COALESCE(c.title, '') AS course_title
           FROM study_materials sm
           JOIN enrollments e ON e.course_id = sm.course_id AND e.user_id = $1
           LEFT JOIN courses c ON c.id = sm.course_id
           WHERE (e.status = 'active' OR e.status IS NULL)
           ORDER BY sm.created_at DESC
           LIMIT 120`,
          [userId]
        );
        for (const row of materials.rows) {
          const text = `${row.title}. ${row.description}`.trim();
          snippets.push({
            source: "material",
            title: `${row.course_title || "Course"} - ${row.title || "Material"}`,
            text,
            score: scoreSnippet(text),
          });
        }

        const questions = await db.query(
          `SELECT q.question_text, COALESCE(q.explanation, '') AS explanation, COALESCE(q.topic, '') AS topic,
                  COALESCE(t.title, '') AS test_title, COALESCE(c.title, '') AS course_title
           FROM questions q
           JOIN tests t ON t.id = q.test_id
           JOIN enrollments e ON e.course_id = t.course_id AND e.user_id = $1
           LEFT JOIN courses c ON c.id = t.course_id
           WHERE (e.status = 'active' OR e.status IS NULL)
           ORDER BY q.id DESC
           LIMIT 150`,
          [userId]
        );
        for (const row of questions.rows) {
          const text = `${row.topic}. ${row.question_text}. ${row.explanation}`.trim();
          snippets.push({
            source: "question",
            title: `${row.course_title || "Course"} - ${row.test_title || "Test"} question`,
            text,
            score: scoreSnippet(text),
          });
        }
      }
    } catch (err) {
      console.warn("[AI Tutor] context fetch failed:", err);
    }

    const selected = snippets
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((s, i) => `[${i + 1}] ${s.title} (${s.source})\n${s.text.slice(0, 450)}`);

    const contextBlock = selected.length
      ? selected.join("\n\n")
      : "No specific class snippet found. Use general mathematics reasoning.";

    const systemPrompt =
      "You are a rigorous math tutor for Indian competitive exam students. " +
      "Give accurate, step-by-step solutions. If relevant context exists, use it. " +
      "If context is insufficient, still solve using correct math methods. " +
      "Do not fabricate references. Keep answer clear and practical.";

    const userPrompt =
      `Student topic: ${t || "General"}\n` +
      `Student question: ${q}\n\n` +
      `Course context snippets:\n${contextBlock}\n\n` +
      "Answer format:\n" +
      "1) Short concept summary\n2) Step-by-step solution\n3) Final answer\n4) One similar practice question";

    const logLlmHttpFailure = (provider: string, status: number, bodyPreview: string) => {
      console.warn(`[AI Tutor] ${provider} HTTP ${status}`, bodyPreview.slice(0, 500));
    };

    const callGemini = async (): Promise<string | null> => {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey?.trim()) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0.25, maxOutputTokens: 900 },
            }),
          }
        );
        if (!res.ok) {
          let preview = "";
          try {
            preview = JSON.stringify(await res.json());
          } catch {
            preview = await res.text().catch(() => "");
          }
          logLlmHttpFailure("Gemini", res.status, preview);
          return null;
        }
        const data = (await res.json()) as any;
        const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("\n").trim();
        return text || null;
      } catch (e) {
        console.warn("[AI Tutor] Gemini request failed:", e instanceof Error ? e.message : e);
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const callOpenAI = async (): Promise<string | null> => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey?.trim()) return null;
      const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.25,
            max_tokens: 900,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        if (!res.ok) {
          let preview = "";
          try {
            preview = JSON.stringify(await res.json());
          } catch {
            preview = await res.text().catch(() => "");
          }
          logLlmHttpFailure("OpenAI", res.status, preview);
          return null;
        }
        const data = (await res.json()) as any;
        return data?.choices?.[0]?.message?.content?.trim() || null;
      } catch (e) {
        console.warn("[AI Tutor] OpenAI request failed:", e instanceof Error ? e.message : e);
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const mode = getAiProviderMode();
    let llmAnswer: string | null = null;
    if (mode === "openai") {
      llmAnswer = await callOpenAI();
    } else if (mode === "gemini") {
      llmAnswer = await callGemini();
    } else {
      llmAnswer = (await callGemini()) || (await callOpenAI());
    }
    if (llmAnswer) return llmAnswer;

    const topicContext = t ? `Topic: ${t}. ` : "";
    return `${topicContext}I could not reach the AI model right now, but here is a structured way to solve it:\n\n` +
      "1. Identify the known values and what is asked.\n" +
      "2. Write the core formula/concept used in this chapter.\n" +
      "3. Substitute carefully and simplify step by step.\n" +
      "4. Recheck units/signs and verify the final value.\n\n" +
      `Question focus: "${q.slice(0, 80)}".`;
  };
}
