import { beforeEach, describe, expect, it, vi } from "vitest";

const streamAssistantTurn = vi.fn();

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
  streamAssistantTurn,
}));

describe("assistant turn stream route", () => {
  beforeEach(() => {
    prisma.interviewSession.findUnique.mockReset();
    prisma.interviewSession.update.mockReset();
    prisma.transcriptSegment.create.mockReset();
    prisma.sessionEvent.create.mockReset();
    streamAssistantTurn.mockReset();
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "session-1" }),
    });

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(text).toContain("event: delta");
    expect(text).toContain("event: done");
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
      transcripts: [{ id: "u1", speaker: "USER", text: "I would use sorting.", segmentIndex: 0 }],
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "session-1" }),
    });

    await response.text();

    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.sessionEvent.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        sessionId: "session-1",
        eventType: "AI_SPOKE",
        payloadJson: {
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
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "session-1" }),
    });

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("event: done");
    expect(text).toContain("\"budgetExceeded\":true");
    expect(streamAssistantTurn).not.toHaveBeenCalled();
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(3);
  });
});


