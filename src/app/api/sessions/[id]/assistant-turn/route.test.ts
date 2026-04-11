import { beforeEach, describe, expect, it, vi } from "vitest";

const generateAssistantTurn = vi.fn();

const prisma = {
  interviewSession: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  transcriptSegment: {
    create: vi.fn(),
  },
  sessionEvent: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma,
}));

vi.mock("@/lib/assistant/generate-turn", () => ({
  generateAssistantTurn,
}));

describe("assistant turn route", () => {
  beforeEach(() => {
    prisma.interviewSession.findUnique.mockReset();
    prisma.interviewSession.update.mockReset();
    prisma.transcriptSegment.create.mockReset();
    prisma.sessionEvent.create.mockReset();
    generateAssistantTurn.mockReset();
  });

  it("creates an AI transcript and stage event", async () => {
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
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
});


