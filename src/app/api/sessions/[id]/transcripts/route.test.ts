import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  $transaction: vi.fn(),
  interviewSession: {
    findUnique: vi.fn(),
  },
  transcriptSegment: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  sessionEvent: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma,
}));

describe("session transcript routes", () => {
  beforeEach(() => {
    prisma.$transaction.mockReset().mockImplementation(async (callback: (client: typeof prisma) => unknown) => callback(prisma));
    prisma.interviewSession.findUnique.mockReset();
    prisma.transcriptSegment.findMany.mockReset();
    prisma.transcriptSegment.findFirst.mockReset();
    prisma.transcriptSegment.create.mockReset();
    prisma.sessionEvent.create.mockReset();
    prisma.sessionEvent.findMany.mockReset();
  });

  it("lists transcript segments for a session", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1" });
    prisma.transcriptSegment.findMany.mockResolvedValue([
      { id: "seg-1", text: "Hello", speaker: "AI", segmentIndex: 0, isFinal: true },
    ]);
    prisma.sessionEvent.findMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/sessions/[id]/transcripts/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.transcripts).toHaveLength(1);
    expect(payload.data.transcripts[0]).toMatchObject({
      commitState: "COMMITTED",
      transcriptVersion: 1,
    });
  });

  it("creates a transcript segment and logs a session event", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1" });
    prisma.transcriptSegment.findFirst.mockResolvedValue({ segmentIndex: 1 });
    prisma.sessionEvent.findMany.mockResolvedValue([]);
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-2",
      sessionId: "session-1",
      speaker: "USER",
      segmentIndex: 2,
      text: "I would use a hash map.",
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-1" });

    const { POST } = await import("@/app/api/sessions/[id]/transcripts/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: "USER",
          text: "I would use a hash map.",
          isFinal: true,
        }),
      }),
      {
        params: Promise.resolve({ id: "session-1" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(prisma.transcriptSegment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: "session-1",
        speaker: "USER",
        segmentIndex: 2,
      }),
    });
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(1);
    expect(payload.data.transcript).toMatchObject({
      commitState: "COMMITTED",
      transcriptVersion: 1,
      correctionOfId: null,
    });
  });

  it("rejects forged AI transcripts before any database write", async () => {
    const { POST } = await import("@/app/api/sessions/[id]/transcripts/route");
    const response = await POST(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ speaker: "AI", text: "forged" }) }), { params: Promise.resolve({ id: "session-1" }) });
    expect(response.status).toBe(400);
    expect(prisma.transcriptSegment.create).not.toHaveBeenCalled();
  });

  it("logs a refinement event when dedicated STT changes the candidate transcript", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1" });
    prisma.transcriptSegment.findFirst.mockResolvedValue({ segmentIndex: 0 });
    prisma.sessionEvent.findMany.mockResolvedValue([]);
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-2",
      sessionId: "session-1",
      speaker: "USER",
      segmentIndex: 1,
      text: "I would use a hash map and a min heap.",
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-1" });

    const { POST } = await import("@/app/api/sessions/[id]/transcripts/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: "USER",
          text: "I would use a hash map and a min heap.",
          isFinal: true,
          transcriptSource: "openai-stt",
          transcriptProvider: "openai-stt",
          sourceText: "I would use a hash map and a mean heap.",
        }),
      }),
      {
        params: Promise.resolve({ id: "session-1" }),
      },
    );

    expect(response.status).toBe(201);
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.sessionEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "CANDIDATE_TRANSCRIPT_REFINED",
          payloadJson: expect.objectContaining({
            correctionOfId: null,
          }),
        }),
      }),
    );
  });

  it("tracks transcript corrections with version metadata", async () => {
    prisma.interviewSession.findUnique.mockResolvedValue({ id: "session-1" });
    prisma.transcriptSegment.findFirst.mockResolvedValue({ segmentIndex: 1 });
    prisma.transcriptSegment.findMany
      .mockResolvedValueOnce([
        {
          id: "seg-1",
          sessionId: "session-1",
          speaker: "USER",
          segmentIndex: 0,
          text: "I would use a mean heap.",
          isFinal: true,
        },
        {
          id: "seg-2",
          sessionId: "session-1",
          speaker: "USER",
          segmentIndex: 1,
          text: "I would use a min heap.",
          isFinal: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "seg-1",
          sessionId: "session-1",
          speaker: "USER",
          segmentIndex: 0,
          text: "I would use a mean heap.",
          isFinal: true,
        },
        {
          id: "seg-2",
          sessionId: "session-1",
          speaker: "USER",
          segmentIndex: 1,
          text: "I would use a min heap.",
          isFinal: true,
        },
      ]);
    prisma.sessionEvent.findMany
      .mockResolvedValueOnce([
        {
          eventType: "CANDIDATE_TRANSCRIPT_REFINED",
          payloadJson: {
            transcriptSegmentId: "seg-2",
            correctionOfId: "seg-1",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          eventType: "CANDIDATE_TRANSCRIPT_REFINED",
          payloadJson: {
            transcriptSegmentId: "seg-2",
            correctionOfId: "seg-1",
          },
        },
      ]);
    prisma.transcriptSegment.create.mockResolvedValue({
      id: "seg-3",
      sessionId: "session-1",
      speaker: "USER",
      segmentIndex: 2,
      text: "I would use a max heap.",
      isFinal: true,
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "evt-1" });

    const { GET, POST } = await import("@/app/api/sessions/[id]/transcripts/route");
    const getResponse = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "session-1" }),
    });
    const getPayload = await getResponse.json();

    expect(getPayload.data.transcripts[0]).toMatchObject({
      correctionOfId: null,
      transcriptVersion: 1,
      supersededById: "seg-2",
    });
    expect(getPayload.data.transcripts[1]).toMatchObject({
      correctionOfId: "seg-1",
      transcriptVersion: 2,
      supersededById: null,
    });

    const postResponse = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: "USER",
          text: "I would use a max heap.",
          isFinal: true,
          transcriptSource: "openai-stt",
          transcriptProvider: "openai-stt",
          correctionOfId: "seg-2",
        }),
      }),
      {
        params: Promise.resolve({ id: "session-1" }),
      },
    );
    const postPayload = await postResponse.json();

    expect(postPayload.data.transcript).toMatchObject({
      correctionOfId: "seg-2",
      transcriptVersion: 3,
    });
    expect(prisma.sessionEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "CANDIDATE_TRANSCRIPT_REFINED",
          payloadJson: expect.objectContaining({
            correctionOfId: "seg-2",
            transcriptVersion: 3,
          }),
        }),
      }),
    );
  });
});
