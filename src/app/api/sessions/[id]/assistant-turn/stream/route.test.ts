import { beforeEach, describe, expect, it, vi } from "vitest";

const streamAssistantTurn = vi.fn();
const claimAssistantTurn = vi.fn();
const completeAssistantTurn = vi.fn();
const failAssistantTurn = vi.fn();
const assistantRequest = () => new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turnId: "11111111-1111-4111-8111-111111111111" }) });

const prisma = {
  $transaction: vi.fn(),
  interviewSession: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  transcriptSegment: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  sessionEvent: {
    create: vi.fn(),
  },
  turnAssessment: { findFirst: vi.fn(), create: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  prisma,
}));

vi.mock("@/lib/assistant/generate-turn", () => ({
  streamAssistantTurn,
}));
vi.mock("@/lib/session/turn-commit", () => ({ claimAssistantTurn, completeAssistantTurn, failAssistantTurn }));

describe("assistant turn stream route", () => {
  beforeEach(() => {
    prisma.$transaction.mockReset().mockImplementation(async (callback: (client: typeof prisma) => unknown) => callback(prisma));
    prisma.interviewSession.findUnique.mockReset();
    prisma.interviewSession.update.mockReset();
    prisma.transcriptSegment.create.mockReset();
    prisma.transcriptSegment.findFirst.mockReset().mockResolvedValue(null);
    prisma.sessionEvent.create.mockReset();
    prisma.turnAssessment.findFirst.mockReset().mockResolvedValue(null);
    prisma.turnAssessment.create.mockReset().mockResolvedValue({ id: "assessment-1", assessmentVersion: 1 });
    streamAssistantTurn.mockReset();
    claimAssistantTurn.mockReset().mockResolvedValue({ status: "claimed" });
    completeAssistantTurn.mockReset().mockResolvedValue(undefined);
    failAssistantTurn.mockReset().mockResolvedValue(undefined);
  });

  it("streams delta and done events", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      question: { title: "Merge Intervals", prompt: "Merge overlapping intervals." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [],
      executionRuns: [],
      events: [],
    });
    streamAssistantTurn.mockImplementation(async function* () {
      yield { meta: { thinkingDelayMs: 420, action: "ask_followup", pressure: "neutral" } };
      yield { textDelta: "Walk me through one example. " };
      yield {
        final: {
          reply: "Walk me through one example. Then tell me the complexity.",
          suggestedStage: "APPROACH_DISCUSSION",
          source: "fallback",
        },
      };
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-1",
      text: "Walk me through one example. Then tell me the complexity.",
      speaker: "AI",
      segmentIndex: 0,
    });
    prisma.sessionEvent.create
      .mockResolvedValueOnce({ id: "evt-1", eventType: "AI_SPOKE" })
      .mockResolvedValueOnce({ id: "evt-2", eventType: "STAGE_ADVANCED" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/stream/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(text).toContain("event: meta");
    expect(text).toContain("event: delta");
    expect(text).toContain("event: done");
    expect(text).toContain("\"mode\":\"CODING\"");
  });

  it("returns the stable 202 protocol without invoking the provider", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1", mode: "CODING", transcripts: [], executionRuns: [], events: [] });
    claimAssistantTurn.mockResolvedValue({ status: "in_progress", retryAfterMs: 750 });
    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/stream/route");
    const response = await POST(assistantRequest(), { params: Promise.resolve({ id: "session-1" }) });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "in_progress", retryAfterMs: 750 } });
    expect(streamAssistantTurn).not.toHaveBeenCalled();
  });

  it("replays a completed stream result as a done event without invoking the provider", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1", mode: "CODING", transcripts: [], executionRuns: [], events: [] });
    claimAssistantTurn.mockResolvedValue({ status: "completed", result: { transcript: { id: "ai-1" }, events: [] } });
    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/stream/route");
    const response = await POST(assistantRequest(), { params: Promise.resolve({ id: "session-1" }) });
    expect(await response.text()).toContain("event: done");
    expect(streamAssistantTurn).not.toHaveBeenCalled();
  });

  it("marks an aborted stream failed without writing an authoritative transcript", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1", mode: "CODING", status: "IN_PROGRESS", endedAt: null,
      targetLevel: "SDE2", selectedLanguage: "PYTHON", question: { title: "Two Sum", prompt: "Solve it" }, interviewerContext: null,
      interviewerProfile: null, transcripts: [], executionRuns: [], events: [] });
    streamAssistantTurn.mockImplementation(async function* () { yield { textDelta: "draft" }; });
    const abort = new AbortController();
    abort.abort();
    const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId: "11111111-1111-4111-8111-111111111111" }), signal: abort.signal });
    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/stream/route");
    const response = await POST(request, { params: Promise.resolve({ id: "session-1" }) });
    await response.text();
    expect(failAssistantTurn).toHaveBeenCalled();
    expect(prisma.transcriptSegment.create).not.toHaveBeenCalled();
  });

  it("does not create a duplicate stage event when the assistant stays in the same stage", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      question: { title: "Merge Intervals", prompt: "Merge overlapping intervals." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [
        { id: "u0", speaker: "USER", text: "sorting maybe", segmentIndex: 0, isFinal: false },
        { id: "u1", speaker: "USER", text: "I would use sorting.", segmentIndex: 1, isFinal: true },
      ],
      executionRuns: [],
      events: [
        {
          id: "evt-current-stage",
          eventType: "STAGE_ADVANCED",
          eventTime: new Date("2026-03-28T00:00:00.000Z"),
          payloadJson: { stage: "APPROACH_DISCUSSION" },
        },
      ],
    });
    streamAssistantTurn.mockImplementation(async function* () {
      yield {
        final: {
          reply: "Walk me through one example and tell me why sorting helps here.",
          suggestedStage: "APPROACH_DISCUSSION",
          source: "fallback",
        },
      };
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-1",
      text: "Walk me through one example and tell me why sorting helps here.",
      speaker: "AI",
      segmentIndex: 1,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-1", eventType: "AI_SPOKE" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/stream/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });

    await response.text();

    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(1);
    expect(streamAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        recentTranscripts: [
          {
            speaker: "USER",
            text: "I would use sorting.",
          },
        ],
      }),
      expect.any(Object),
    );
    expect(prisma.sessionEvent.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        sessionId: "session-1",
        eventType: "AI_SPOKE",
        payloadJson: {
          mode: "CODING",
          transcriptSegmentId: "seg-1",
          source: "fallback",
        },
      },
    });
  });

  it("short-circuits the stream when the session budget has already been exceeded", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      endedAt: null,
      question: { title: "Merge Intervals", prompt: "Merge overlapping intervals." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [{ id: "u1", speaker: "USER", text: "I would use sorting.", segmentIndex: 0 }],
      executionRuns: [],
      events: [
        {
          id: "usage-1",
          eventType: "LLM_USAGE_RECORDED",
          eventTime: new Date("2026-04-03T00:00:00.000Z"),
          payloadJson: { estimatedCostUsd: 2.02 },
        },
      ],
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-budget",
      text: "budget hit",
      speaker: "AI",
      segmentIndex: 1,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-budget" });
    prisma.interviewSession.update.mockResolvedValue({ id: "session-1" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/stream/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("event: done");
    expect(text).toContain("\"budgetExceeded\":true");
    expect(streamAssistantTurn).not.toHaveBeenCalled();
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(3);
  });

  it("records candidate DNA and shadow policy events from the streamed final turn", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      question: { title: "Two Sum", prompt: "Return indices." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [{ id: "u1", segmentIndex: 0, speaker: "USER", text: "Use a hash map.", isFinal: true }],
      executionRuns: [],
      events: [],
    });
    streamAssistantTurn.mockImplementation(async function* () {
      yield {
        final: {
          reply: "Code it.",
          suggestedStage: "IMPLEMENTATION",
          source: "fallback",
          signals: { progress: "progressing" },
          candidateDna: {
            vector: { reasoning: 0.84, implementation: 0.72, coachability: 0.68, independence: 0.75 },
            dominantTraits: ["reasoning-heavy", "independent"],
            recommendedMode: "challenging",
            rationale: ["Strong signal."],
          },
          shadowPolicy: {
            archetype: "bar_raiser",
            action: "probe_tradeoff",
            target: "tradeoff",
            pressure: "challenging",
            timing: "ask_now",
            reason: "Shadow policy would probe tradeoffs earlier.",
            diff: ["action", "target"],
          },
        },
      };
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-1",
      text: "Code it.",
      speaker: "AI",
      segmentIndex: 0,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-1", eventType: "GENERIC" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/stream/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });

    await response.text();

    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "CANDIDATE_DNA_RECORDED",
        }),
      }),
    );
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "SHADOW_POLICY_EVALUATED",
        }),
      }),
    );
    expect(prisma.turnAssessment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateTurnId: "u1", assessmentVersion: 1 }),
    }));
  });

  it("guards system design stage transitions in streaming route with api contract gate", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-sd-1",
      mode: "SYSTEM_DESIGN",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      question: { title: "Design URL Shortener", prompt: "Design a URL shortener." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [{ id: "u1", speaker: "USER", text: "We need APIs for global traffic and high availability.", segmentIndex: 0, isFinal: true }],
      executionRuns: [],
      events: [],
    });
    streamAssistantTurn.mockImplementation(async function* () {
      yield {
        final: {
          reply: "Let's go deeper into replication tradeoffs.",
          suggestedStage: "DEEP_DIVE",
          source: "fallback",
        },
      };
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-sd-1",
      text: "Let's go deeper into replication tradeoffs.",
      speaker: "AI",
      segmentIndex: 1,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-sd-1", eventType: "GENERIC" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/stream/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-sd-1" }),
    });

    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("\"currentStage\":\"API_CONTRACT_CHECK\"");
    expect(text).toContain("\"suggestedStage\":\"API_CONTRACT_CHECK\"");
  });
});


