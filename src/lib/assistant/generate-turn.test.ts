import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSessionMemorySummary,
  generateAssistantTurn,
  resetProviderCooldownsForTests,
  streamAssistantTurn,
} from "@/lib/assistant/generate-turn";

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
    resetProviderCooldownsForTests();
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
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
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

    expect(result.policyAction).toBeTruthy();
    expect(result.reply).toMatch(/hint|nudge|reading your state correctly|exact state or output/i);
    expect(result.hintLevel == null || result.hintLevel === "MEDIUM").toBe(true);
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

    expect(["gemini", "fallback"]).toContain(result.source);
    expect(result.reply).toMatch(/validation cases|final wrap-up|close this question|edge cases|boundary conditions/i);
  });

  it("replaces praise-only provider output with the required decision question", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.LLM_PROVIDER = "gemini";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Great. Nice work so far." }],
            },
          },
        ],
      }),
    } as Response) as typeof fetch;

    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [{ speaker: "USER", text: "I would test empty input, duplicates, and then talk through runtime." }],
      latestExecutionRun: { status: "PASSED" },
    });

    expect(["gemini", "fallback"]).toContain(result.source);
    expect(result.reply).toMatch(/time complexity|space complexity|tradeoff/i);
  });

  it("uses the critic pass to avoid repeating complexity after that target was already answered", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.LLM_PROVIDER = "gemini";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Now that the implementation works, walk me through the final time and space complexity and the main tradeoff behind this approach." }],
            },
          },
        ],
      }),
    } as Response) as typeof fetch;

    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Two Sum",
      questionPrompt: "Return indices of two numbers that add up to target.",
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [{ speaker: "USER", text: "Time complexity is O(n), space complexity is O(n), and the tradeoff is extra hash-map space for linear runtime." }],
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "complexity",
              action: "ask_for_complexity",
            },
          },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "tradeoff",
              action: "probe_tradeoff",
            },
          },
        },
      ],
      latestExecutionRun: { status: "PASSED" },
    });

    expect(["gemini", "fallback"]).toContain(result.source);
    expect(result.reply).not.toMatch(/time complexity|space complexity|tradeoff/i);
    expect(result.reply).toMatch(/summary|production|watch carefully|implementation detail|final wrap-up|close this question/i);
  });

  it("does not repeat wrap-up once implementation, validation, and performance have already been summarized", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.LLM_PROVIDER = "gemini";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Good. You have already covered the implementation, validation, and performance story well enough. Give me a concise final wrap-up of the approach and one thing you would double-check in production." }],
            },
          },
        ],
      }),
    } as Response) as typeof fetch;

    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Two Sum",
      questionPrompt: "Return indices of two numbers that add up to target.",
      currentStage: "WRAP_UP",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "The final approach is a one-pass hash map with O(n) time and O(n) space, and in production I would still double-check empty input and numeric range assumptions.",
        },
      ],
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "summary",
              action: "move_stage",
            },
          },
        },
      ],
      latestExecutionRun: { status: "PASSED" },
    });

    expect(["gemini", "fallback"]).toContain(result.source);
    expect(result.criticVerdict?.questionWorthAsking).toBe(false);
    expect(result.criticVerdict?.timingVerdict).toBe("skip");
    expect(result.reply).not.toMatch(/final wrap-up|double-check in production/i);
  });

  it("turns repeated wrap-up keep-going language into an explicit closure", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.LLM_PROVIDER = "gemini";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "You have already supplied enough evidence on that point for now. Keep going." }],
            },
          },
        ],
      }),
    } as Response) as typeof fetch;

    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Two Sum",
      questionPrompt: "Return indices of two numbers that add up to target.",
      currentStage: "WRAP_UP",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "Single-pass hash lookup gives optimal performance, with a clean invariant and predictable behavior, and I would harden the edge-case behavior before shipping.",
        },
      ],
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "summary",
              action: "move_to_wrap_up",
            },
          },
        },
      ],
      latestExecutionRun: { status: "PASSED" },
    });

    expect(["gemini", "fallback"]).toContain(result.source);
    expect(result.criticVerdict?.reason).toBe("evidence_saturated");
    expect(result.reply).not.toMatch(/keep going/i);
    expect(result.reply).toMatch(/done here|done with this question/i);
  });

  it("uses a low-cost rewrite pass before falling back when gemini replies too generically", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.LLM_PROVIDER = "gemini";
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "That sounds like a good start. Keep going." }],
              },
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Be precise: which exact alternative would you compare against, and why is your memory/runtime tradeoff acceptable here?" }],
              },
            },
          ],
        }),
      } as Response) as typeof fetch;

    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Two Sum",
      questionPrompt: "Return indices of two numbers that add up to target.",
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [{ speaker: "USER", text: "The runtime is O(n) and the tradeoff is extra space for the hash map." }],
    });

    expect(["gemini", "fallback"]).toContain(result.source);
    expect(result.reply).toMatch(/exact alternative|tradeoff acceptable|boundary coverage|exact output/i);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.criticVerdict == null || typeof result.criticVerdict.reason === "string").toBe(true);
  });

  it("treats a concrete Two Sum walkthrough as enough evidence to move into implementation", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Two Sum",
      questionPrompt: "Return indices of two numbers that add up to target.",
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "We can use a hash table to store the index of the numbers while iterating the array. For any number x, we first check if target - x exists in the hash table. If yes, then we return the index of x and index of target - x. If not, we save x and its index in the hash table. If the iteration stops, we return empty array. Overall runtime is O(n) and overall space is O(n).",
        },
      ],
    });

    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
    expect(result.reply).toMatch(/implement|start coding|go ahead and implement|invariant explicitly|proof story|state the invariant explicitly/i);
    expect(result.reply).not.toMatch(/assumptions are you making|algorithmic strategy would you choose/i);
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

    expect(["openai", "fallback"]).toContain(result.source);
    expect(result.reply).toMatch(/edge cases|test next/i);
  });

  it("temporarily skips a rate-limited primary provider on the next turn", async () => {
    process.env.GEMINI_API_KEY = "fake-gemini-key";
    process.env.OPENAI_API_KEY = "fake-openai-key";
    process.env.LLM_PROVIDER = "gemini";

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "rate limit exceeded" } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output_text: "What edge cases would you test next before you call this solution done?" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output_text: "Now tell me the exact expected output for the highest-risk boundary case." }),
      } as Response) as typeof fetch;

    const first = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "IMPLEMENTATION",
      recentTranscripts: [{ speaker: "USER", text: "The code seems to work now." }],
      latestExecutionRun: { status: "PASSED" },
    });

    const second = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [{ speaker: "USER", text: "I would test empty input first." }],
      latestExecutionRun: { status: "PASSED" },
    });

    expect(["openai", "fallback"]).toContain(first.source);
    expect(["openai", "fallback"]).toContain(second.source);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a non-question provider reply when the decision is to hold and listen", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.LLM_PROVIDER = "gemini";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Keep coding and narrate the one branch you think is easiest to get wrong." }],
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
      recentTranscripts: [
        { speaker: "AI", text: "Walk me through the implementation at a high level." },
        { speaker: "USER", text: "I am filling the map now, and next I will build the result list from the most frequent entries." },
      ],
      recentEvents: [
        { eventType: "CANDIDATE_SPOKE", eventTime: "2026-03-28T00:01:00.000Z" },
        { eventType: "AI_SPOKE", eventTime: "2026-03-28T00:01:10.000Z" },
        { eventType: "CANDIDATE_SPOKE", eventTime: "2026-03-28T00:01:20.000Z" },
      ],
    });

    expect(["gemini", "fallback"]).toContain(result.source);
    expect(result.reply).toMatch(/keep coding|narrate|keep moving|proof story/i);
  });

  it("uses the new fallback reply strategy for tradeoff probes", async () => {
    const result = await generateAssistantTurn({
      mode: "CODING",
      questionTitle: "Top K Frequent Elements",
      questionPrompt: "Return the k most frequent elements.",
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        { speaker: "USER", text: "I could sort all frequencies after counting them in a map." },
      ],
    });

    expect(result.source).toBe("fallback");
    expect(result.reply).toMatch(/tradeoff|efficient alternative|runtime/i);
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

  it("includes unresolved issues and missing evidence in session memory summary", () => {
    const summary = buildSessionMemorySummary(
      [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "reasoning",
              specificIssue: "Proof sketch is still missing.",
            },
          },
        },
      ],
      createSignalSnapshot({
        reasoningDepth: "thin",
        testingDiscipline: "missing",
        structuredEvidence: [
          {
            area: "correctness",
            issue: "The candidate has intuition, but no proof sketch yet.",
            behavior: "The candidate described the idea without showing why it must stay correct.",
            evidence: "No proof sketch or invariant appeared in the latest turn.",
            impact: "Correctness confidence is still weak.",
            fix: "Ask for a short proof sketch or invariant.",
          },
        ],
      }),
      {
        action: "probe_correctness",
        target: "correctness",
        question: "What invariant makes this correct?",
        reason: "Need correctness evidence.",
        confidence: 0.9,
        policyAction: "PROBE_APPROACH",
      },
      "APPROACH_DISCUSSION",
      null,
    );

    expect(summary).toMatch(/Unresolved issues/i);
    expect(summary).toMatch(/Missing evidence/i);
    expect(summary).toMatch(/correctness_proof/i);
  });

  it("includes answered targets and collected evidence in session memory summary", () => {
    const summary = buildSessionMemorySummary(
      [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "testing",
              action: "ask_for_test_case",
            },
          },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "tradeoff",
              action: "probe_tradeoff",
            },
          },
        },
      ],
      createSignalSnapshot({
        testingDiscipline: "strong",
        edgeCaseAwareness: "present",
        complexityRigor: "strong",
      }),
      {
        action: "move_stage",
        target: "summary",
        question: "Wrap up.",
        reason: "The key evidence is already collected.",
        confidence: 0.9,
        policyAction: "WRAP_UP",
      },
      "TESTING_AND_COMPLEXITY",
      { status: "PASSED" },
    );

    expect(summary).toMatch(/Targets already answered recently/i);
    expect(summary).toMatch(/Collected evidence so far/i);
    expect(summary).toMatch(/complexity|tradeoff|testing/i);
  });
});

function createSignalSnapshot(overrides?: Partial<Parameters<typeof buildSessionMemorySummary>[1]>) {
  return {
    understanding: "clear" as const,
    progress: "progressing" as const,
    communication: "clear" as const,
    codeQuality: "partial" as const,
    algorithmChoice: "reasonable" as const,
    edgeCaseAwareness: "partial" as const,
    behavior: "structured" as const,
    readyToCode: false,
    reasoningDepth: "moderate" as const,
    testingDiscipline: "partial" as const,
    complexityRigor: "partial" as const,
    confidence: 0.78,
    evidence: ["Candidate explained the approach clearly."],
    structuredEvidence: [],
    summary: "Candidate is broadly progressing.",
    trendSummary: "Candidate state is broadly stable relative to the previous snapshot.",
    ...overrides,
  };
}



