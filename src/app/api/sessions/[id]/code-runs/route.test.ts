import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCode = vi.fn();

const prisma = {
  interviewSession: {
    findUnique: vi.fn(),
  },
  codeSnapshot: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  executionRun: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  sessionEvent: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma,
}));

vi.mock("@/lib/sandbox/execute", () => ({
  executeCode,
}));

describe("session code run routes", () => {
  beforeEach(() => {
    prisma.interviewSession.findUnique.mockReset();
    prisma.codeSnapshot.findFirst.mockReset();
    prisma.codeSnapshot.create.mockReset();
    prisma.executionRun.findMany.mockReset();
    prisma.executionRun.create.mockReset();
    prisma.sessionEvent.create.mockReset();
    executeCode.mockReset();
  });

  it("lists recent code runs for a session", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1" });
    prisma.executionRun.findMany.mockResolvedValue([{ id: "run-1", status: "PASSED" }]);

    const { GET } = await import("@/app/api/sessions/[id]/code-runs/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.executionRuns).toHaveLength(1);
  });

  it("creates a code snapshot, executes code, and records run events", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1" });
    prisma.interviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      transcripts: [{ id: "seg-u1", segmentIndex: 0, speaker: "USER", text: "I will start coding now." }],
      executionRuns: [],
      events: [
        {
          id: "evt-stage-1",
          eventType: "STAGE_ADVANCED",
          eventTime: new Date("2026-03-27T21:00:00.000Z"),
          payloadJson: { stage: "IMPLEMENTATION" },
        },
      ],
    });
    prisma.codeSnapshot.findFirst.mockResolvedValue({ snapshotIndex: 3 });
    prisma.codeSnapshot.create.mockResolvedValue({
      id: "snapshot-4",
      sessionId: "session-1",
      language: "PYTHON",
      content: "print('hello')",
      snapshotIndex: 4,
      source: "RUN",
    });
    executeCode.mockResolvedValue({
      status: "PASSED",
      stdout: "hello",
      stderr: "",
      runtimeMs: 18,
      memoryKb: null,
    });
    prisma.executionRun.create.mockResolvedValue({
      id: "run-1",
      sessionId: "session-1",
      status: "PASSED",
      stdout: "hello",
      stderr: "",
      runtimeMs: 18,
      memoryKb: null,
      createdAt: new Date("2026-03-27T21:10:00.000Z"),
      codeSnapshot: {
        id: "snapshot-4",
        language: "PYTHON",
        snapshotIndex: 4,
        source: "RUN",
      },
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-1" });

    const { POST } = await import("@/app/api/sessions/[id]/code-runs/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "PYTHON",
          code: "print('hello')",
          source: "RUN",
        }),
      }),
      {
        params: Promise.resolve({ id: "session-1" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(prisma.codeSnapshot.create).toHaveBeenCalledWith({
      data: {
        sessionId: "session-1",
        language: "PYTHON",
        content: "print('hello')",
        snapshotIndex: 4,
        source: "RUN",
      },
    });
    expect(executeCode).toHaveBeenCalledWith({
      language: "PYTHON",
      code: "print('hello')",
      stdin: undefined,
    });
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(4);
    expect(prisma.sessionEvent.create).toHaveBeenLastCalledWith({
      data: {
        sessionId: "session-1",
        eventType: "STAGE_ADVANCED",
        payloadJson: {
          previousStage: "IMPLEMENTATION",
          stage: "TESTING_AND_COMPLEXITY",
          source: "code-run-policy",
          reason:
            "A passing run completed implementation/debugging, so the interview should move into testing and complexity.",
        },
      },
    });
  });
});
