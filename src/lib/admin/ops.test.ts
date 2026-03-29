import { describe, expect, it } from "vitest";
import { buildSessionEventDescription, buildUnifiedOpsFeed, type AdminProfileDetail } from "@/lib/admin/ops";

describe("buildUnifiedOpsFeed", () => {
  const detail: AdminProfileDetail = {
    profile: {
      id: "profile-1",
      sourceUrl: "https://example.com/jane",
      sourceType: "PERSONAL_SITE",
      status: "READY",
      fetchStatus: "SUCCEEDED",
      personaSummary: null,
      currentRole: null,
      currentCompany: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      updatedAt: "2026-03-28T00:00:00.000Z",
    },
    job: null,
    personaEvents: [
      {
        id: "p1",
        source: "persona",
        eventType: "JOB_ENQUEUED",
        createdAt: "2026-03-28T00:00:10.000Z",
        title: "Job Enqueued",
        description: "Queued.",
        payloadJson: null,
        interviewerProfileId: "profile-1",
      },
    ],
    sessionEvents: [
      {
        id: "s1",
        source: "session",
        eventType: "SESSION_CREATED",
        createdAt: "2026-03-28T00:00:20.000Z",
        title: "Session Created",
        description: "Session created.",
        payloadJson: null,
        sessionId: "session-1",
        interviewerProfileId: "profile-1",
      },
    ],
    sessionSummary: null,
  };

  it("returns all events sorted by newest first", () => {
    const result = buildUnifiedOpsFeed(detail, "all");
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("s1");
    expect(result[1]?.id).toBe("p1");
  });

  it("filters to persona events", () => {
    const result = buildUnifiedOpsFeed(detail, "persona");
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("persona");
  });

  it("filters to session events", () => {
    const result = buildUnifiedOpsFeed(detail, "session");
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("session");
  });

  it("describes stage transitions in a human-readable way", () => {
    const description = buildSessionEventDescription("STAGE_ADVANCED", {
      previousStage: "APPROACH_DISCUSSION",
      stage: "IMPLEMENTATION",
    });

    expect(description).toMatch(/Approach Discussion/);
    expect(description).toMatch(/Implementation/);
  });

  it("describes AI interruptions from new realtime events", () => {
    const description = buildSessionEventDescription("AI_INTERRUPTED_BY_CANDIDATE", {
      wasSpeaking: true,
    });

    expect(description).toMatch(/interrupted/i);
  });

  it("describes hints served by the interviewer", () => {
    const description = buildSessionEventDescription("HINT_SERVED", {
      stage: "APPROACH_DISCUSSION",
      hintStyle: "APPROACH_NUDGE",
      hintLevel: "MEDIUM",
      escalationReason: "stage_stall_detected",
    });

    expect(description).toMatch(/hint/i);
    expect(description).toMatch(/Approach Discussion/i);
    expect(description).toMatch(/medium/i);
    expect(description).toMatch(/stage stall detected/i);
  });

  it("describes dedicated STT transcript refinement", () => {
    const description = buildSessionEventDescription("CANDIDATE_TRANSCRIPT_REFINED", {
      transcriptProvider: "openai-stt",
    });

    expect(description).toMatch(/dedicated stt/i);
    expect(description).toMatch(/openai-stt/i);
  });

  it("describes signal snapshots in a readable way", () => {
    const description = buildSessionEventDescription("SIGNAL_SNAPSHOT_RECORDED", {
      signals: {
        understanding: "clear",
        progress: "stuck",
        edgeCaseAwareness: "missing",
      },
    });

    expect(description).toMatch(/understanding=clear/i);
    expect(description).toMatch(/progress=stuck/i);
    expect(description).toMatch(/edge cases=missing/i);
  });

  it("prefers the primary observed issue when structured evidence exists", () => {
    const description = buildSessionEventDescription("SIGNAL_SNAPSHOT_RECORDED", {
      signals: {
        understanding: "clear",
        progress: "progressing",
        structuredEvidence: [
          {
            area: "correctness",
            issue: "The correctness invariant is still underspecified.",
          },
        ],
      },
    });

    expect(description).toMatch(/primary observed issue/i);
    expect(description).toMatch(/invariant/i);
  });

  it("describes interviewer decisions in a readable way", () => {
    const description = buildSessionEventDescription("DECISION_RECORDED", {
      decision: {
        action: "ask_followup",
        target: "edge_case",
      },
    });

    expect(description).toMatch(/ask_followup/i);
    expect(description).toMatch(/edge_case/i);
  });

  it("mentions provider fallback details for AI replies", () => {
    const description = buildSessionEventDescription("AI_SPOKE", {
      source: "fallback",
      providerFailure: {
        provider: "gemini",
        message: "rate limit",
      },
    });

    expect(description).toMatch(/fallback/i);
    expect(description).toMatch(/gemini/i);
    expect(description).toMatch(/rate limit/i);
  });

  it("describes generated reports in a readable way", () => {
    const description = buildSessionEventDescription("REPORT_GENERATED", {
      recommendation: "HIRE",
      overallScore: 78,
    });

    expect(description).toMatch(/report generated/i);
    expect(description).toMatch(/hire/i);
    expect(description).toMatch(/78/);
  });
});
