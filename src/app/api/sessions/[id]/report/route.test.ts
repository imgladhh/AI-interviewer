import { beforeEach, describe, expect, it, vi } from "vitest";

const readSessionSnapshotBundle = vi.fn();

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
  readSessionSnapshotBundle,
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
    readSessionSnapshotBundle.mockReset();
  });

  it("generates and persists a v1 report", async () => {
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
        { id: "seg-1", speaker: "USER", text: "I would start with a hash map.", segmentIndex: 0, isFinal: true },
        { id: "seg-2", speaker: "AI", text: "Walk me through an example.", segmentIndex: 1, isFinal: true },
        { id: "seg-3", speaker: "USER", text: "Time complexity is O(n) and space is O(n).", segmentIndex: 2, isFinal: true },
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

    readSessionSnapshotBundle.mockResolvedValue({ candidateStates: [], decisions: [], intents: [], trajectories: [], health: { status: "healthy", diagnostics: [] } });
    prisma.sessionEvent.create
      .mockResolvedValueOnce({ id: "evt-eval", eventType: "EVALUATION_STARTED", eventTime: new Date() })
      .mockResolvedValueOnce({ id: "evt-report", eventType: "REPORT_GENERATED", eventTime: new Date() });
    prisma.evaluation.upsert.mockResolvedValue({ id: "eval-1" });
    prisma.evaluationDimensionScore.deleteMany.mockResolvedValue({ count: 0 });
    prisma.evaluationDimensionScore.createMany.mockResolvedValue({ count: 5 });
    prisma.feedbackReport.upsert.mockResolvedValue({
      id: "report-1",
      reportVersion: "v1",
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
    expect(prisma.feedbackReport.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        reportVersion: "v1",
        reportJson: expect.objectContaining({
          transcriptSummary: expect.objectContaining({
            userTurns: 2,
            aiTurns: 1,
          }),
        }),
      }),
    }));
    expect(prisma.sessionEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        sessionId: "session-1",
        eventType: "REPORT_GENERATED",
      }),
    });
  });

  it("ignores superseded committed transcripts when generating the report", async () => {
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
        { id: "seg-1", speaker: "USER", text: "I would use a mean heap.", segmentIndex: 0, isFinal: true },
        { id: "seg-2", speaker: "USER", text: "I would use a min heap.", segmentIndex: 1, isFinal: true },
        { id: "seg-3", speaker: "AI", text: "Walk me through an example.", segmentIndex: 2, isFinal: true },
      ],
      events: [
        { eventType: "CANDIDATE_TRANSCRIPT_REFINED", eventTime: new Date("2026-03-28T00:00:00.000Z"), payloadJson: { transcriptSegmentId: "seg-2", correctionOfId: "seg-1" } },
      ],
      executionRuns: [
        { id: "run-1", status: "PASSED", stdout: "ok", stderr: "", runtimeMs: 12, createdAt: new Date("2026-03-28T00:01:00.000Z") },
      ],
      evaluation: null,
      feedbackReport: null,
    });

    readSessionSnapshotBundle.mockResolvedValue({ candidateStates: [], decisions: [], intents: [], trajectories: [], health: { status: "healthy", diagnostics: [] } });
    prisma.sessionEvent.create
      .mockResolvedValueOnce({ id: "evt-eval", eventType: "EVALUATION_STARTED", eventTime: new Date() })
      .mockResolvedValueOnce({ id: "evt-report", eventType: "REPORT_GENERATED", eventTime: new Date() });
    prisma.evaluation.upsert.mockResolvedValue({ id: "eval-1" });
    prisma.evaluationDimensionScore.deleteMany.mockResolvedValue({ count: 0 });
    prisma.evaluationDimensionScore.createMany.mockResolvedValue({ count: 5 });
    prisma.feedbackReport.upsert.mockResolvedValue({
      id: "report-1",
      reportVersion: "v1",
      reportJson: { overallScore: 80 },
    });
    prisma.interviewSession.update.mockResolvedValue({ id: "session-1" });

    const { POST } = await import("@/app/api/sessions/[id]/report/route");
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(201);
    expect(prisma.feedbackReport.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        reportJson: expect.objectContaining({
          transcriptSummary: expect.objectContaining({
            userTurns: 1,
            aiTurns: 1,
          }),
        }),
      }),
    }));
  });
});
