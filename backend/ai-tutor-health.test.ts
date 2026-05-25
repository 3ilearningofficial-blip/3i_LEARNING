import { describe, it, expect, vi, afterEach } from "vitest";

describe("AI tutor provider config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("auto lists gemini then openai when both keys are set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini");
    vi.stubEnv("OPENAI_API_KEY", "test-openai");
    vi.stubEnv("AI_PROVIDER", "auto");
    const { getAiTutorHealthSnapshot } = await import("./ai-tutor-service");
    const h = getAiTutorHealthSnapshot();
    expect(h.resolvedOrder).toEqual(["gemini", "openai"]);
    expect(h.geminiConfigured).toBe(true);
    expect(h.openaiConfigured).toBe(true);
    expect(h.aiProvider).toBe("auto");
  });

  it("openai-only mode exposes only openai in resolvedOrder", async () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENAI_API_KEY", "y");
    vi.stubEnv("AI_PROVIDER", "openai");
    const { getAiTutorHealthSnapshot } = await import("./ai-tutor-service");
    expect(getAiTutorHealthSnapshot().resolvedOrder).toEqual(["openai"]);
  });

  it("isolates OpenAI: gemini-only mode skips openai even when key present", async () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENAI_API_KEY", "y");
    vi.stubEnv("AI_PROVIDER", "gemini");
    const { getAiTutorHealthSnapshot } = await import("./ai-tutor-service");
    expect(getAiTutorHealthSnapshot().resolvedOrder).toEqual(["gemini"]);
  });

  it("invalid AI_PROVIDER falls back to auto", async () => {
    vi.stubEnv("AI_PROVIDER", "bogus");
    const { getAiProviderMode } = await import("./ai-tutor-service");
    expect(getAiProviderMode()).toBe("auto");
  });
});

describe("sanitizeLectureRowForClient", () => {
  it("strips transcript for API responses", async () => {
    const { sanitizeLectureRowForClient } = await import("./lecture-payload-utils");
    const row = { id: 1, title: "A", transcript: "secret text" };
    const out = sanitizeLectureRowForClient(row);
    expect(out).not.toHaveProperty("transcript");
    expect((out as { title: string }).title).toBe("A");
  });
});

describe("generateAIAnswer (smoke)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns fallback template when no LLM keys and no user context", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const { createGenerateAIAnswer } = await import("./ai-tutor-service");
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const gen = createGenerateAIAnswer(mockDb as any);
    const out = await gen("What is 2+2?", "General", undefined);
    expect(out).toMatch(/could not reach the AI model/i);
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it("calls OpenAI when AI_PROVIDER=openai and key is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("AI_PROVIDER", "openai");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Four." } }] }),
    });
    vi.stubGlobal("fetch", fetchMock as any);
    const { createGenerateAIAnswer } = await import("./ai-tutor-service");
    const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const gen = createGenerateAIAnswer(mockDb as any);
    const out = await gen("What is 2+2?", "General", undefined);
    expect(out).toBe("Four.");
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] || "");
    expect(url).toContain("api.openai.com");
  });
});
