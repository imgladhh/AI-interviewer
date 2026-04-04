import { beforeEach, describe, expect, it, vi } from "vitest";

const readCandidateStateSnapshots = vi.fn();
const readInterviewerDecisionSnapshots = vi.fn();
const readIntentSnapshots = vi.fn();
const readTrajectorySnapshots = vi.fn();

const prisma = {
  interviewSession: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  sessionEvent: {
    create: vi.fn(),
  },
  evaluation: {
    upsert: vi.fn(),
  },
  evaluationDimensionScore: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  feedbackReport: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma,
}));

vi.mock("@/lib/session/snapshots", () => ({
  readCandidateStateSnapshots,
  readInterviewerDecisionSnapshots,
  readIntentSnapshots,
  readTrajectorySnapshots,
}));

describe("session report route", () => {
  beforeEach(() => {
    prisma.interviewSession.findUnique.mockReset();
    prisma.interviewSession.update.mockReset();
    prisma.sessionEvent.create.mockReset();
    prisma.evaluation.upsert.mockReset();
    prisma.evaluationDimensionScore.deleteMany.mockReset();
    prisma.evaluationDimensionScore.createMany.mockReset();
    prisma.feedbackReport.findUnique.mockReset();
    prisma.feedbackReport.upsert.mockReset();
    readCandidateStateSnapshots.mockReset();
    readInterviewerDecisionSnapshots.mockReset();
    readIntentSnapshots.mockReset();
    readTrajectorySnapshots.mockReset();
  });

  it("generates and persists a v0 report", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      question: {
        title: "Two Sum",
        prompt: "Find two indices that add up to a target.",
      },
      targetLevel: "SDE1",
      selectedLanguage: "PYTHON",
      endedAt: null,
      transcripts: [
        { speaker: "USER", text: "I would start with a hash map." },
        { speaker: "AI", text: "Walk me through an example." },
        { speaker: "USER", text: "Time complexity is O(n) and space is O(n)." },
      ],
      events: [
        { eventType: "STAGE_ADVANCED", eventTime: new Date("2026-03-28T00:00:00.000Z"), payloadJson: { stage: "APPROACH_DISCUSSION" } },
      ],
      executionRuns: [
        { status: "PASSED", stdout: "ok", stderr: "", runtimeMs: 12, createdAt: new Date("2026-03-28T00:01:00.000Z") },
      ],
      evaluation: null,
      feedbackReport: null,
    });

    readCandidateStateSnapshots.mockResolvedValue([]);
    readInterviewerDecisionSnapshots.mockResolvedValue([]);
    readIntentSnapshots.mockResolvedValue([]);
    readTrajectorySnapshots.mockResolvedValue([]);
    prisma.sessionEvent.create
      .mockResolvedValueOnce({ id: "evt-eval", eventType: "EVALUATION_STARTED", eventTime: new Date() })
      .mockResolvedValueOnce({ id: "evt-report", eventType: "REPORT_GENERATED", eventTime: new Date() });
    prisma.evaluation.upsert.mockResolvedValue({ id: "eval-1" });
    prisma.evaluationDimensionScore.deleteMany.mockResolvedValue({ count: 0 });
    prisma.evaluationDimensionScore.createMany.mockResolvedValue({ count: 5 });
    prisma.feedbackReport.upsert.mockResolvedValue({
      id: "report-1",
      reportVersion: "v0",
      reportJson: { overallScore: 80 },
    });
    prisma.interviewSession.update.mockResolvedValue({ id: "session-1" });

    const { POST } = await import("@/app/api/sessions/[id]/report/route");
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(prisma.evaluation.upsert).toHaveBeenCalled();
    expect(prisma.feedbackReport.upsert).toHaveBeenCalled();
    expect(prisma.sessionEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        sessionId: "session-1",
        eventType: "REPORT_GENERATED",
      }),
    });
  });
});
