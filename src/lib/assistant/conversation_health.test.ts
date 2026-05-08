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
  it("stays normal when candidate turns keep adding novelty", () => {
    const health = assessConversationHealth({
      signals: baseSignals,
      recentEvents: [
        { eventType: "CANDIDATE_SPOKE", payloadJson: { text: "I would use BFS." } },
        { eventType: "CANDIDATE_SPOKE", payloadJson: { text: "I can precompute wildcard patterns." } },
      ],
    });

    expect(health.mode).toBe("NORMAL");
    expect(health.novelty).toBeGreaterThan(0.8);
  });

  it("escalates to rescue when echo and no-progress signals are concentrated", () => {
    const repeated = "please summarize your approach and complexity";
    const health = assessConversationHealth({
      signals: { ...baseSignals, echoLikely: true },
      recentEvents: [
        { eventType: "CANDIDATE_SPOKE", payloadJson: { text: repeated } },
        { eventType: "CANDIDATE_ECHO_DETECTED", payloadJson: {} },
        { eventType: "CANDIDATE_SPOKE", payloadJson: { text: repeated } },
        { eventType: "CANDIDATE_ECHO_DETECTED", payloadJson: {} },
        { eventType: "CANDIDATE_SPOKE", payloadJson: { text: repeated } },
      ],
    });

    expect(["GUIDED", "RESCUE", "TERMINATE_OR_REPLAN"]).toContain(health.mode);
    expect(health.noProgressTurns).toBeGreaterThanOrEqual(2);
    expect(health.echoRate).toBeGreaterThan(0.3);
  });

  it("counts near-repeated answers as no-progress even when wording changes", () => {
    const health = assessConversationHealth({
      signals: baseSignals,
      recentEvents: [
        { eventType: "CANDIDATE_SPOKE", payloadJson: { text: "I think I can use a hashmap for lookup here." } },
        { eventType: "CANDIDATE_SPOKE", payloadJson: { text: "I would use the hash map lookup for this." } },
        { eventType: "CANDIDATE_SPOKE", payloadJson: { text: "Still using a hash map lookup basically." } },
      ],
    });

    expect(health.noProgressTurns).toBeGreaterThanOrEqual(2);
    expect(["GUIDED", "RESCUE", "TERMINATE_OR_REPLAN"]).toContain(health.mode);
  });
});
