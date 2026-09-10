import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureSeedData = vi.fn();
const buildPersonaSnapshot = vi.fn();
const buildAppliedPromptContext = vi.fn();

const prisma = {
  user: {
    findFirst: vi.fn(),
  },
  interviewerProfile: {
    findUnique: vi.fn(),
  },
  question: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  interviewSession: {
    create: vi.fn(),
  },
  sessionInterviewerContext: {
    create: vi.fn(),
  },
  sessionEvent: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/seed", () => ({
  ensureSeedData,
}));

vi.mock("@/lib/db", () => ({
  prisma,
}));

vi.mock("@/lib/persona/build-persona-context", () => ({
  buildPersonaSnapshot,
  buildAppliedPromptContext,
}));

describe("POST /api/sessions", () => {
  beforeEach(() => {
    vi.resetModules();
    ensureSeedData.mockReset();
    buildPersonaSnapshot.mockReset();
    buildAppliedPromptContext.mockReset();

    prisma.user.findFirst.mockReset();
    prisma.interviewerProfile.findUnique.mockReset();
    prisma.question.findFirst.mockReset();
    prisma.question.findMany.mockReset();
    prisma.interviewSession.create.mockReset();
    prisma.sessionInterviewerContext.create.mockReset();
    prisma.sessionEvent.create.mockReset();
  });

  it("creates a generic session without interviewer context", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "demo@example.com",
    });
    prisma.question.findMany.mockResolvedValue([
      {
        id: "question-1",
        title: "Merge Intervals",
      },
    ]);
    prisma.interviewSession.create.mockResolvedValue({
      id: "session-1",
      status: "READY",
      personaStatus: null,
      questionId: "question-1",
    });
    prisma.sessionEvent.create.mockResolvedValue({
      id: "event-1",
    });

    const { POST } = await import("@/app/api/sessions/route");
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "CODING",
        targetLevel: "SDE2",
        selectedLanguage: "PYTHON",
        companyStyle: "GENERIC",
        voiceEnabled: true,
        personaEnabled: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data.interviewerContextApplied).toBe(false);
    expect(prisma.sessionInterviewerContext.create).not.toHaveBeenCalled();
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(3);
    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: {
        type: "CODING",
        isActive: true,
        companyStyle: "GENERIC",
        levelTarget: "SDE2",
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("uses an explicitly selected question when questionId is provided", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "demo@example.com",
    });
    prisma.question.findFirst.mockResolvedValue({
      id: "question-explicit",
      title: "Two Sum",
    });
    prisma.interviewSession.create.mockResolvedValue({
      id: "session-explicit",
      status: "READY",
      personaStatus: null,
      questionId: "question-explicit",
    });
    prisma.sessionEvent.create.mockResolvedValue({
      id: "event-explicit",
    });

    const { POST } = await import("@/app/api/sessions/route");
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: "question-explicit",
        mode: "CODING",
        targetLevel: "SDE2",
        selectedLanguage: "PYTHON",
        companyStyle: "GENERIC",
        voiceEnabled: true,
        personaEnabled: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.questionId).toBe("question-explicit");
    expect(prisma.question.findFirst).toHaveBeenCalledWith({
      where: {
        id: "question-explicit",
        isActive: true,
        type: "CODING",
      },
    });
    expect(prisma.question.findMany).not.toHaveBeenCalled();
  });

  it("falls back to generic questions when no company-specific question is available", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "demo@example.com",
    });
    prisma.question.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "question-generic-fallback",
          title: "Top K Frequent Elements",
        },
      ]);
    prisma.interviewSession.create.mockResolvedValue({
      id: "session-fallback",
      status: "READY",
      personaStatus: null,
      questionId: "question-generic-fallback",
    });
    prisma.sessionEvent.create.mockResolvedValue({
      id: "event-fallback",
    });

    const { POST } = await import("@/app/api/sessions/route");
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "CODING",
        targetLevel: "SDE2",
        selectedLanguage: "PYTHON",
        companyStyle: "AMAZON",
        difficulty: "HARD",
        voiceEnabled: true,
        personaEnabled: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.questionId).toBe("question-generic-fallback");
    expect(prisma.question.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        type: "CODING",
        isActive: true,
        difficulty: "HARD",
        companyStyle: "AMAZON",
        levelTarget: "SDE2",
      },
      orderBy: { createdAt: "asc" },
    });
    expect(prisma.question.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        type: "CODING",
        isActive: true,
        difficulty: "HARD",
        companyStyle: "GENERIC",
        levelTarget: "SDE2",
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("prefers company-specific questions when they exist", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "demo@example.com",
    });
    prisma.question.findMany.mockResolvedValueOnce([
      {
        id: "question-meta-1",
        title: "Number of Islands",
      },
    ]);
    prisma.interviewSession.create.mockResolvedValue({
      id: "session-meta",
      status: "READY",
      personaStatus: null,
      questionId: "question-meta-1",
    });
    prisma.sessionEvent.create.mockResolvedValue({
      id: "event-meta",
    });

    const { POST } = await import("@/app/api/sessions/route");
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "CODING",
        targetLevel: "SDE2",
        selectedLanguage: "PYTHON",
        companyStyle: "META",
        voiceEnabled: true,
        personaEnabled: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.questionId).toBe("question-meta-1");
    expect(prisma.question.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: {
        type: "CODING",
        isActive: true,
        companyStyle: "META",
        levelTarget: "SDE2",
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("creates interviewer context when a ready persona profile is provided", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "demo@example.com",
    });
    prisma.interviewerProfile.findUnique.mockResolvedValue({
      id: "profile-1",
      status: "READY",
      sourceUrl: "https://example.com/jane",
      fullName: "Jane Doe",
      seniorityEstimate: "senior",
      technicalFocus: ["backend"],
      likelyInterviewFocus: ["tradeoffs"],
      communicationStyleGuess: ["direct"],
      confidence: 0.7,
    });
    prisma.question.findMany.mockResolvedValue([
      {
        id: "question-1",
        title: "Top K Frequent Elements",
      },
    ]);
    prisma.interviewSession.create.mockResolvedValue({
      id: "session-2",
      status: "READY",
      personaStatus: "READY",
      questionId: "question-1",
    });
    prisma.sessionInterviewerContext.create.mockResolvedValue({
      id: "context-1",
    });
    prisma.sessionEvent.create.mockResolvedValue({
      id: "event-2",
    });
    buildPersonaSnapshot.mockReturnValue({
      interviewerName: "Jane Doe",
      seniorityEstimate: "senior",
      technicalFocus: ["backend"],
      likelyInterviewFocus: ["tradeoffs"],
      communicationStyleGuess: ["direct"],
      confidence: 0.7,
      sourceUrl: "https://example.com/jane",
    });
    buildAppliedPromptContext.mockReturnValue("prompt context");

    const { POST } = await import("@/app/api/sessions/route");
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "CODING",
        targetLevel: "SDE2",
        selectedLanguage: "PYTHON",
        companyStyle: "GENERIC",
        voiceEnabled: true,
        personaEnabled: true,
        interviewerProfileId: "profile-1",
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.interviewerContextApplied).toBe(true);
    expect(prisma.sessionInterviewerContext.create).toHaveBeenCalledWith({
      data: {
        sessionId: "session-2",
        interviewerProfileId: "profile-1",
        personaSnapshotJson: {
          interviewerName: "Jane Doe",
          seniorityEstimate: "senior",
          technicalFocus: ["backend"],
          likelyInterviewFocus: ["tradeoffs"],
          communicationStyleGuess: ["direct"],
          confidence: 0.7,
          sourceUrl: "https://example.com/jane",
        },
        appliedPromptContext: "prompt context",
      },
    });
  });

  it("returns 404 when persona mode references a missing interviewer profile", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "demo@example.com",
    });
    prisma.interviewerProfile.findUnique.mockResolvedValue(null);

    const { POST } = await import("@/app/api/sessions/route");
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "CODING",
        targetLevel: "SDE2",
        selectedLanguage: "PYTHON",
        companyStyle: "GENERIC",
        voiceEnabled: true,
        personaEnabled: true,
        interviewerProfileId: "missing-profile",
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.ok).toBe(false);
    expect(payload.message).toMatch(/Interviewer profile not found/i);
  });

  it("uses company style and level without forcing difficulty on the user", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "demo@example.com",
    });
    prisma.question.findMany.mockResolvedValue([
      {
        id: "question-two-sum",
        title: "Two Sum",
      },
    ]);
    prisma.interviewSession.create.mockResolvedValue({
      id: "session-two-sum",
      status: "READY",
      personaStatus: null,
      questionId: "question-two-sum",
    });
    prisma.sessionEvent.create.mockResolvedValue({
      id: "event-two-sum",
    });

    const { POST } = await import("@/app/api/sessions/route");
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "CODING",
        targetLevel: "SDE1",
        selectedLanguage: "C++",
        companyStyle: "GENERIC",
        voiceEnabled: true,
        personaEnabled: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.questionId).toBe("question-two-sum");
    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: {
        type: "CODING",
        isActive: true,
        companyStyle: "GENERIC",
        levelTarget: "SDE1",
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("filters coding questions by an explicitly requested difficulty", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "user-1", email: "demo@example.com" });
    prisma.question.findMany.mockResolvedValue([{ id: "question-hard", title: "Trapping Rain Water" }]);
    prisma.interviewSession.create.mockResolvedValue({
      id: "session-hard",
      status: "READY",
      personaStatus: null,
      questionId: "question-hard",
    });
    prisma.sessionEvent.create.mockResolvedValue({ id: "event-hard" });

    const { POST } = await import("@/app/api/sessions/route");
    const response = await POST(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "CODING",
          targetLevel: "SDE2",
          companyStyle: "GENERIC",
          difficulty: "HARD",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: {
        type: "CODING",
        isActive: true,
        difficulty: "HARD",
        levelTarget: "SDE2",
        companyStyle: "GENERIC",
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("rejects an explicit question that is not active for the requested mode", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "user-1", email: "demo@example.com" });
    prisma.question.findFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/sessions/route");
    const response = await POST(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "CODING",
          targetLevel: "SDE2",
          questionId: "system-design-question",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(prisma.question.findFirst).toHaveBeenCalledWith({
      where: {
        id: "system-design-question",
        isActive: true,
        type: "CODING",
      },
    });
    expect(prisma.interviewSession.create).not.toHaveBeenCalled();
    expect(prisma.sessionEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an empty question pool before creating session state", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "user-1", email: "demo@example.com" });
    prisma.question.findMany.mockResolvedValue([]);

    const { POST } = await import("@/app/api/sessions/route");
    const response = await POST(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "CODING",
          targetLevel: "SDE2",
          companyStyle: "GENERIC",
          difficulty: "HARD",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.message).toMatch(/No active question matches/i);
    expect(prisma.interviewSession.create).not.toHaveBeenCalled();
    expect(prisma.sessionInterviewerContext.create).not.toHaveBeenCalled();
    expect(prisma.sessionEvent.create).not.toHaveBeenCalled();
  });

  it("persists system design mode and queries a system design question pool", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "demo@example.com",
    });
    prisma.question.findMany.mockResolvedValue([
      {
        id: "question-sd-1",
        title: "Design URL Shortener",
      },
    ]);
    prisma.interviewSession.create.mockResolvedValue({
      id: "session-sd-1",
      status: "READY",
      personaStatus: null,
      questionId: "question-sd-1",
      mode: "SYSTEM_DESIGN",
    });
    prisma.sessionEvent.create.mockResolvedValue({
      id: "event-sd-1",
    });

    const { POST } = await import("@/app/api/sessions/route");
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "SYSTEM_DESIGN",
        targetLevel: "SDE2",
        selectedLanguage: "PYTHON",
        companyStyle: "GENERIC",
        difficulty: "MEDIUM",
        voiceEnabled: true,
        personaEnabled: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.sessionId).toBe("session-sd-1");
    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: {
        type: "SYSTEM_DESIGN",
        isActive: true,
        difficulty: "MEDIUM",
        companyStyle: "GENERIC",
      },
      orderBy: { createdAt: "asc" },
    });
    expect(prisma.interviewSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: "SYSTEM_DESIGN",
        }),
      }),
    );
    expect(prisma.sessionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "SESSION_CREATED",
          payloadJson: expect.objectContaining({
            mode: "SYSTEM_DESIGN",
          }),
        }),
      }),
    );
  });
});
