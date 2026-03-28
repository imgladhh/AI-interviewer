import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAssistantTurn, streamAssistantTurn } from "@/lib/assistant/generate-turn";

describe("generateAssistantTurn", () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalProvider = process.env.LLM_PROVIDER;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    process.env.LLM_PROVIDER = "fallback";
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalGeminiKey;
    process.env.OPENAI_API_KEY = originalOpenAiKey;
    process.env.LLM_PROVIDER = originalProvider;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("opens the interview when no conversation exists", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Merge Intervals",
      questionPrompt: "Merge overlapping intervals.",
      recentTranscripts: [],
    });

    expect(result.source).toBe("fallback");
    expect(result.reply).toMatch(/first-pass approach|restate/i);
  });

  it("asks about debugging after an execution error", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Merge Intervals",
      questionPrompt: "Merge overlapping intervals.",
      recentTranscripts: [{ speaker: "USER", text: "I think the code should work." }],
      latestExecutionRun: {
        status: "ERROR",
        stderr: "NameError",
      },
    });

    expect(result.source).toBe("fallback");
    expect(result.reply).toMatch(/causing it|debug/i);
    expect(result.suggestedStage).toBe("DEBUGGING");
  });

  it("falls back locally when no provider key is configured", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      recentTranscripts: [{ speaker: "USER", text: "I think a hash map would help." }],
    });

    expect(result.source).toBe("fallback");
    expect(result.reply).toMatch(/example|starting point/i);
  });

  it("asks for more specificity when the candidate reply is too short", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      recentTranscripts: [{ speaker: "USER", text: "Maybe sorting?" }],
    });

    expect(result.source).toBe("fallback");
    expect(result.reply).toMatch(/constraint|output|assumption|example/i);
  });

  it("varies the wording if the previous AI turn was the same follow-up", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      recentTranscripts: [
        {
          speaker: "AI",
          text: "That sounds like a reasonable direction. Walk me through one concrete example and then tell me the expected time and space complexity.",
        },
        {
          speaker: "USER",
          text: "I would use a hash map first and then maybe sort by frequency.",
        },
      ],
    });

    expect(result.source).toBe("fallback");
    expect(result.reply).not.toBe(
      "That sounds like a reasonable direction. Walk me through one concrete example and then tell me the expected time and space complexity.",
    );
  });

  it("returns a complete sentence ending", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      recentTranscripts: [{ speaker: "USER", text: "I am not sure." }],
    });

    expect(/[.!?]["']?$/.test(result.reply)).toBe(true);
  });

  it("respects the current stage when implementation is already underway", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "IMPLEMENTATION",
      recentTranscripts: [{ speaker: "USER", text: "I would use a hash map and then fill the result array." }],
    });

    expect(result.reply).toMatch(/implement|code|branch|pointer|loop/i);
    expect(result.suggestedStage).toBe("IMPLEMENTATION");
  });

  it("serves a hint when the candidate explicitly asked for one", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [{ speaker: "USER", text: "Can I get a hint? I am stuck." }],
      recentEvents: [{ eventType: "HINT_REQUESTED", eventTime: "2026-03-28T00:00:00.000Z" }],
    });

    expect(result.hintServed).toBe(true);
    expect(result.reply).toMatch(/hint|nudge/i);
    expect(result.hintLevel).toBe("MEDIUM");
  });

  it("switches to a constrained follow-up when the stage has stalled", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [{ speaker: "USER", text: "Maybe I would use a map, I am not sure, maybe then sort?" }],
      recentEvents: [
        { eventType: "STAGE_ADVANCED", eventTime: "2026-03-28T00:00:00.000Z" },
        { eventType: "CANDIDATE_SPOKE", eventTime: "2026-03-28T00:01:00.000Z" },
        { eventType: "AI_SPOKE", eventTime: "2026-03-28T00:01:10.000Z" },
        { eventType: "CANDIDATE_SPOKE", eventTime: "2026-03-28T00:01:20.000Z" },
        { eventType: "AI_SPOKE", eventTime: "2026-03-28T00:01:30.000Z" },
      ],
    });

    expect(result.reply).toMatch(/exact information|state|one step|condition/i);
  });

  it("enforces the decision question when a provider returns a generic reply", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.LLM_PROVIDER = "gemini";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Keep going. Explain your approach step by step." }],
            },
          },
        ],
      }),
    } as Response) as typeof fetch;

    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "IMPLEMENTATION",
      recentTranscripts: [{ speaker: "USER", text: "My code passes now but I have not talked about edge cases yet." }],
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.source).toBe("gemini");
    expect(result.reply).toMatch(/edge cases|boundary conditions|test next/i);
  });

  it("falls through from gemini to openai before using local fallback", async () => {
    process.env.GEMINI_API_KEY = "fake-gemini-key";
    process.env.OPENAI_API_KEY = "fake-openai-key";
    process.env.LLM_PROVIDER = "gemini";

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "rate limit" } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output_text: "What edge cases would you test next before you call this solution done?" }),
      } as Response) as typeof fetch;

    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "IMPLEMENTATION",
      recentTranscripts: [{ speaker: "USER", text: "The code seems to work now." }],
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.source).toBe("openai");
    expect(result.reply).toMatch(/edge cases|test next/i);
  });

  it("falls back during streaming when the configured provider yields nothing", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.LLM_PROVIDER = "gemini";
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as typeof fetch;

    const chunks: Array<{ textDelta?: string; final?: { reply: string; source: string } }> = [];
    for await (const chunk of streamAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      recentTranscripts: [{ speaker: "USER", text: "I would use a hash map first." }],
    })) {
      chunks.push(chunk as { textDelta?: string; final?: { reply: string; source: string } });
    }

    const finalChunk = chunks.find((chunk) => chunk.final)?.final;
    expect(finalChunk?.source).toBe("fallback");
    expect(finalChunk?.reply).toMatch(/example|starting point|step by step/i);
  });
});
