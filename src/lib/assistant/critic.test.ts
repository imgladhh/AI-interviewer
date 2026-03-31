import { describe, expect, it } from "vitest";
import { reviewInterviewerReply } from "@/lib/assistant/critic";
import type { CandidateDecision } from "@/lib/assistant/decision_engine";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "partial",
  algorithmChoice: "reasonable",
  edgeCaseAwareness: "present",
  behavior: "structured",
  readyToCode: false,
  reasoningDepth: "moderate",
  testingDiscipline: "strong",
  complexityRigor: "strong",
  confidence: 0.82,
  evidence: ["Candidate explained the algorithm concretely."],
  structuredEvidence: [],
  summary: "Candidate is progressing with a concrete approach.",
};

const baseDecision: CandidateDecision = {
  action: "ask_for_complexity",
  target: "complexity",
  question: "Give me the final time complexity, space complexity, and one tradeoff you made in choosing this approach.",
  reason: "Need final performance summary.",
  confidence: 0.88,
  policyAction: "VALIDATE_AND_TEST",
};

describe("reviewInterviewerReply", () => {
  it("blocks repeating an already answered complexity target", () => {
    const result = reviewInterviewerReply({
      reply: "Now that the implementation works, walk me through the final time and space complexity and the main tradeoff behind this approach.",
      decision: baseDecision,
      signals: baseSignals,
      currentStage: "TESTING_AND_COMPLEXITY",
      latestExecutionRun: { status: "PASSED" },
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "complexity", action: "ask_for_complexity" } },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "tradeoff", action: "probe_tradeoff" } },
        },
      ],
    });

    expect(result.approved).toBe(false);
    expect(result.verdict).toBe("move_on");
    expect(result.reason).toBe("repeated_answered_target");
    expect(result.questionWorthAsking).toBe(false);
    expect(result.revisedReply).toMatch(/final summary|already covered/i);
  });

  it("pushes toward implementation when the candidate is already ready to code", () => {
    const result = reviewInterviewerReply({
      reply: "Okay, that sounds good. What invariant makes it correct after each iteration?",
      decision: {
        ...baseDecision,
        action: "probe_correctness",
        target: "correctness",
      },
      signals: {
        ...baseSignals,
        readyToCode: true,
      },
      currentStage: "APPROACH_DISCUSSION",
      latestExecutionRun: null,
    });

    expect(result.approved).toBe(false);
    expect(result.verdict).toBe("move_to_implementation");
    expect(result.reason).toBe("should_move_to_implementation");
    expect(result.questionWorthAsking).toBe(false);
    expect(result.revisedReply).toMatch(/implement|code/i);
  });

  it("marks generic praise as low-specificity rewrite material", () => {
    const result = reviewInterviewerReply({
      reply: "That sounds like a good start. Keep going.",
      decision: {
        ...baseDecision,
        action: "probe_tradeoff",
        target: "tradeoff",
      },
      signals: baseSignals,
      currentStage: "TESTING_AND_COMPLEXITY",
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.approved).toBe(false);
    expect(result.verdict).toBe("rewrite");
    expect(result.specificity).toBe("low");
    expect(result.questionWorthAsking).toBe(true);
  });
});
