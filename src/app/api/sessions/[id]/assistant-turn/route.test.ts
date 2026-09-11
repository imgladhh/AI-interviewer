import { beforeEach, describe, expect, it, vi } from "vitest";

const generateAssistantTurn = vi.fn();
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
  generateAssistantTurn,
}));
vi.mock("@/lib/session/turn-commit", () => ({ claimAssistantTurn, completeAssistantTurn, failAssistantTurn }));

describe("assistant turn route", () => {
  beforeEach(() => {
    prisma.$transaction.mockReset().mockImplementation(async (callback: (client: typeof prisma) => unknown) => callback(prisma));
    prisma.interviewSession.findUnique.mockReset();
    prisma.interviewSession.update.mockReset();
    prisma.transcriptSegment.create.mockReset();
    prisma.transcriptSegment.findFirst.mockReset().mockResolvedValue(null);
    prisma.sessionEvent.create.mockReset();
    prisma.turnAssessment.findFirst.mockReset().mockResolvedValue(null);
    prisma.turnAssessment.create.mockReset().mockResolvedValue({ id: "assessment-1", assessmentVersion: 1 });
    generateAssistantTurn.mockReset();
    claimAssistantTurn.mockReset().mockResolvedValue({ status: "claimed" });
    completeAssistantTurn.mockReset().mockResolvedValue(undefined);
    failAssistantTurn.mockReset().mockResolvedValue(undefined);
  });

  it("returns 202 without invoking the provider when the same turn is in progress", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1", mode: "CODING", transcripts: [], executionRuns: [], events: [] });
    claimAssistantTurn.mockResolvedValue({ status: "in_progress", retryAfterMs: 750 });
    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    const response = await POST(assistantRequest(), { params: Promise.resolve({ id: "session-1" }) });
    expect(response.status).toBe(202);
    expect(generateAssistantTurn).not.toHaveBeenCalled();
    expect(prisma.transcriptSegment.create).not.toHaveBeenCalled();
  });

  it("calls the provider before the short commit transaction and marks a failed commit", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1", mode: "CODING", status: "IN_PROGRESS", endedAt: null,
      targetLevel: "SDE2", selectedLanguage: "PYTHON", question: { title: "Two Sum", prompt: "Solve it" }, interviewerContext: null,
      interviewerProfile: null, transcripts: [], executionRuns: [], events: [] });
    generateAssistantTurn.mockResolvedValue({ reply: "answer", source: "fallback", suggestedStage: null });
    prisma.transcriptSegment.create.mockResolvedValue({ id: "ai-1", segmentIndex: 0, speaker: "AI", text: "answer", isFinal: true });
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof prisma) => unknown) => callback({
      ...prisma,
      sessionEvent: { create: vi.fn().mockRejectedValue(new Error("event write failed")) },
    } as typeof prisma));
    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    await expect(POST(assistantRequest(), { params: Promise.resolve({ id: "session-1" }) })).rejects.toThrow("event write failed");
    expect(generateAssistantTurn.mock.invocationCallOrder[0]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
    expect(failAssistantTurn).toHaveBeenCalledWith("session-1", "11111111-1111-4111-8111-111111111111");
    expect(completeAssistantTurn).not.toHaveBeenCalled();
  });

  it("creates an AI transcript and stage event", async () => {
    prisma.transcriptSegment.findFirst.mockResolvedValue({ segmentIndex: 1 });
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      question: {
        title: "Merge Intervals",
        prompt: "Merge overlapping intervals.",
      },
      interviewerContext: {
        appliedPromptContext: "Use a rigorous style.",
      },
      interviewerProfile: {
        personaSummary: "Backend oriented interviewer.",
      },
      transcripts: [
        { segmentIndex: 0, speaker: "USER", text: "live partial", isFinal: false },
        { segmentIndex: 1, speaker: "USER", text: "I would first clarify the constraints and expected output.", isFinal: true },
      ],
      executionRuns: [],
      events: [],
    });
    generateAssistantTurn.mockResolvedValue({
      reply: "Walk me through a concrete example and then tell me the complexity.",
      suggestedStage: "IMPLEMENTATION",
      source: "fallback",
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-1",
      text: "Walk me through a concrete example and then tell me the complexity.",
      speaker: "AI",
      segmentIndex: 2,
    });
    prisma.sessionEvent.create
      .mockResolvedValueOnce({ id: "evt-1", eventType: "AI_SPOKE" })
      .mockResolvedValueOnce({ id: "evt-2", eventType: "STAGE_ADVANCED" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.meta.mode).toBe("CODING");
    expect(prisma.transcriptSegment.create).toHaveBeenCalledWith({
      data: {
        sessionId: "session-1",
        speaker: "AI",
        segmentIndex: 2,
        text: "Walk me through a concrete example and then tell me the complexity.",
        isFinal: true,
      },
    });
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.sessionEvent.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        sessionId: "session-1",
        eventType: "AI_SPOKE",
        payloadJson: {
          mode: "CODING",
        },
      },
    });
    expect(prisma.sessionEvent.create.mock.lastCall?.[0]).toMatchObject({
      data: {
        sessionId: "session-1",
        eventType: "STAGE_ADVANCED",
        payloadJson: {
          previousStage: "APPROACH_DISCUSSION",
          stage: "IMPLEMENTATION",
          source: "fallback",
        },
      },
    });
    expect(generateAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        recentTranscripts: [
          {
            speaker: "USER",
            text: "I would first clarify the constraints and expected output.",
          },
        ],
      }),
    );
  });

  it("ends the interview when the session budget cap has already been exceeded", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      endedAt: null,
      question: {
        title: "Merge Intervals",
        prompt: "Merge overlapping intervals.",
      },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [{ segmentIndex: 0, speaker: "USER", text: "I would use sorting." }],
      executionRuns: [],
      events: [
        {
          eventType: "LLM_USAGE_RECORDED",
          eventTime: new Date("2026-04-03T00:00:00.000Z"),
          payloadJson: { estimatedCostUsd: 1.6 },
        },
        {
          eventType: "STT_USAGE_RECORDED",
          eventTime: new Date("2026-04-03T00:00:02.000Z"),
          payloadJson: { estimatedCostUsd: 0.5 },
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

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.meta.budgetExceeded).toBe(true);
    expect(generateAssistantTurn).not.toHaveBeenCalled();
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(3);
    expect(prisma.interviewSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
      }),
    });
  });

  it("uses the latest committed correction instead of a superseded transcript", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      endedAt: null,
      question: {
        title: "Merge Intervals",
        prompt: "Merge overlapping intervals.",
      },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [
        { id: "seg-1", segmentIndex: 0, speaker: "USER", text: "I would use a mean heap.", isFinal: true },
        { id: "seg-2", segmentIndex: 1, speaker: "USER", text: "I would use a min heap.", isFinal: true },
      ],
      executionRuns: [],
      events: [
        {
          eventType: "CANDIDATE_TRANSCRIPT_REFINED",
          eventTime: new Date("2026-04-07T00:00:00.000Z"),
          payloadJson: {
            transcriptSegmentId: "seg-2",
            correctionOfId: "seg-1",
          },
        },
      ],
    });
    generateAssistantTurn.mockResolvedValue({
      reply: "What would the complexity be?",
      suggestedStage: "APPROACH_DISCUSSION",
      source: "fallback",
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-3",
      text: "What would the complexity be?",
      speaker: "AI",
      segmentIndex: 2,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-1" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(200);
    expect(generateAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        recentTranscripts: [
          {
            speaker: "USER",
            text: "I would use a min heap.",
          },
        ],
      }),
    );
  });

  it("records candidate DNA and shadow policy events when provided by the turn generator", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      endedAt: null,
      question: { title: "Two Sum", prompt: "Return indices." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [{ id: "u1", segmentIndex: 0, speaker: "USER", text: "Use a hash map.", isFinal: true }],
      executionRuns: [],
      events: [],
    });
    generateAssistantTurn.mockResolvedValue({
      reply: "Code it.",
      suggestedStage: "IMPLEMENTATION",
      source: "fallback",
      signals: { progress: "progressing" },
      candidateDna: {
        vector: { reasoning: 0.8, implementation: 0.7, coachability: 0.6, independence: 0.7 },
        dominantTraits: ["independent"],
        recommendedMode: "challenging",
        rationale: ["Strong signal."],
      },
      shadowPolicy: {
        archetype: "bar_raiser",
        action: "probe_correctness",
        target: "correctness",
        pressure: "challenging",
        timing: "ask_now",
        reason: "Shadow policy would probe harder.",
        diff: ["action", "pressure"],
      },
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-2",
      text: "Code it.",
      speaker: "AI",
      segmentIndex: 1,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-1", eventType: "GENERIC" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(200);
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "CANDIDATE_DNA_RECORDED",
          payloadJson: expect.objectContaining({
            candidateDna: expect.objectContaining({
              recommendedMode: "challenging",
            }),
          }),
        }),
      }),
    );
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "SHADOW_POLICY_EVALUATED",
          payloadJson: expect.objectContaining({
            shadowPolicy: expect.objectContaining({
              archetype: "bar_raiser",
            }),
          }),
        }),
      }),
    );
    expect(prisma.turnAssessment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ candidateTurnId: "u1", assessmentVersion: 1 }),
    }));
  });

  it("records turn reward with trace metadata when a decision exists", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      endedAt: null,
      question: { title: "Two Sum", prompt: "Return indices." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [{ id: "u1", segmentIndex: 0, speaker: "USER", text: "Use a hash map.", isFinal: true }],
      executionRuns: [],
      events: [],
    });
    generateAssistantTurn.mockResolvedValue({
      reply: "Can you justify the complexity with one concrete case?",
      source: "fallback",
      decision: {
        action: "ask_followup",
        target: "complexity",
        urgency: "high",
        interruptionCost: "low",
      },
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-2",
      text: "Can you justify the complexity with one concrete case?",
      speaker: "AI",
      segmentIndex: 1,
    });
    prisma.sessionEvent.create
      .mockResolvedValueOnce({ id: "evt-decision", eventType: "DECISION_RECORDED" })
      .mockResolvedValueOnce({ id: "evt-reward", eventType: "REWARD_RECORDED" })
      .mockResolvedValue({ id: "evt-generic", eventType: "GENERIC" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(200);
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "REWARD_RECORDED",
          payloadJson: expect.objectContaining({
            trace: expect.objectContaining({
              transcriptSegmentId: "seg-2",
              decisionEventId: "evt-decision",
            }),
            reward: expect.objectContaining({
              version: "v1",
            }),
          }),
        }),
      }),
    );
  });

  it("records echo detection and echo recovery events when present in signals/decision", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      mode: "CODING",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      endedAt: null,
      question: { title: "Two Sum", prompt: "Return indices." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [{ id: "u1", segmentIndex: 0, speaker: "USER", text: "What is your complexity?", isFinal: true }],
      executionRuns: [],
      events: [],
    });
    generateAssistantTurn.mockResolvedValue({
      reply: "Please answer in exactly two sentences.",
      source: "fallback",
      signals: {
        echoLikely: true,
        echoStrength: "high",
        echoOverlapRatio: 0.92,
      },
      decision: {
        action: "ask_for_clarification",
        target: "reasoning",
        echoRecoveryMode: "narrow_format",
        echoRecoveryAttempt: 2,
      },
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-echo",
      text: "Please answer in exactly two sentences.",
      speaker: "AI",
      segmentIndex: 1,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-echo", eventType: "GENERIC" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(200);
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "CANDIDATE_ECHO_DETECTED",
        }),
      }),
    );
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "ECHO_RECOVERY_PROMPTED",
        }),
      }),
    );
  });

  it("applies system design stage guard and routes to api contract check before deep dive", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-sd-1",
      mode: "SYSTEM_DESIGN",
      targetLevel: "SDE2",
      selectedLanguage: "PYTHON",
      endedAt: null,
      question: { title: "Design URL Shortener", prompt: "Design a URL shortener." },
      interviewerContext: null,
      interviewerProfile: null,
      transcripts: [
        { id: "u1", segmentIndex: 0, speaker: "USER", text: "We need APIs for global traffic with high availability.", isFinal: true },
      ],
      executionRuns: [],
      events: [],
    });
    generateAssistantTurn.mockResolvedValue({
      reply: "Let's go deeper into replication tradeoffs.",
      suggestedStage: "DEEP_DIVE",
      source: "fallback",
    });
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-sd-1",
      text: "Let's go deeper into replication tradeoffs.",
      speaker: "AI",
      segmentIndex: 1,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-sd-1", eventType: "AI_SPOKE" });

    const { POST } = await import("@/app/api/sessions/[id]/assistant-turn/route");
    const response = await POST(assistantRequest(), {
      params: Promise.resolve({ id: "session-sd-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.meta.currentStage).toBe("API_CONTRACT_CHECK");
    expect(payload.data.meta.suggestedStage).toBe("API_CONTRACT_CHECK");
    expect(prisma.sessionEvent.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "STAGE_ADVANCED",
        }),
      }),
    );
  });
});


