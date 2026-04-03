import { beforeEach, describe, expect, it, vi } from "vitest";

const generateAssistantTurn = vi.fn();

const prisma = {
  interviewSession: {
    findUnique: vi.fn(),
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
      transcripts: [{ segmentIndex: 0, speaker: "USER", text: "I would first clarify the constraints and expected output." }],
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
      segmentIndex: 1,
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
        segmentIndex: 1,
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
  });
});


