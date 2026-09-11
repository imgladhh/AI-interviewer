import { describe, expect, it } from "vitest";
import { assessConversationHealth } from "@/lib/assistant/conversation_health";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "partial",
  algorithmChoice: "reasonable",
  edgeCaseAwareness: "partial",
  behavior: "structured",
  readyToCode: false,
  reasoningDepth: "moderate",
  testingDiscipline: "partial",
  complexityRigor: "partial",
  confidence: 0.7,
  evidence: [],
  structuredEvidence: [],
  summary: "stable",
  trendSummary: "stable",
};

describe("assessConversationHealth", () => {
  const assessment = (id: string, signals: CandidateSignalSnapshot, version = 1) => ({
    eventType: "TURN_ASSESSMENT_RECORDED",
    payloadJson: { candidateTurnId: id, assessmentVersion: version, adjudicated: signals },
  });

  it("stays normal when candidate turns keep adding novelty", () => {
    const health = assessConversationHealth({
      signals: baseSignals,
      recentEvents: [
        assessment("u1", baseSignals),
        assessment("u2", baseSignals),
      ],
    });

    expect(health.mode).toBe("NORMAL");
    expect(health.novelty).toBeGreaterThan(0.8);
  });

  it("escalates to rescue when echo and no-progress signals are concentrated", () => {
    const health = assessConversationHealth({
      signals: { ...baseSignals, echoLikely: true },
      recentEvents: [
        assessment("u1", { ...baseSignals, progress: "stuck", echoLikely: true }),
        assessment("u2", { ...baseSignals, progress: "stuck", echoLikely: true }),
      ],
    });

    expect(["GUIDED", "RESCUE", "TERMINATE_OR_REPLAN"]).toContain(health.mode);
    expect(health.noProgressTurns).toBeGreaterThanOrEqual(2);
    expect(health.echoRate).toBeGreaterThan(0.3);
  });

  it("uses only adjudicated progress and ignores duplicate assessment versions", () => {
    const health = assessConversationHealth({
      signals: { ...baseSignals, progress: "stuck" },
      recentEvents: [
        assessment("u1", { ...baseSignals, progress: "stuck" }),
        assessment("u1", { ...baseSignals, progress: "stuck" }, 2),
        assessment("u2", { ...baseSignals, progress: "stuck" }),
      ],
    });

    expect(health.noProgressTurns).toBeGreaterThanOrEqual(2);
    expect(["GUIDED", "RESCUE", "TERMINATE_OR_REPLAN"]).toContain(health.mode);
  });

  it("marks historical sessions without assessments unavailable without throwing", () => {
    const health = assessConversationHealth({ signals: baseSignals, recentEvents: [{ eventType: "SIGNAL_SNAPSHOT_RECORDED", payloadJson: { signals: { echoLikely: true } } }] });
    expect(health.assessmentStatus).toBe("unavailable");
    expect(health.mode).toBe("NORMAL");
  });
});
