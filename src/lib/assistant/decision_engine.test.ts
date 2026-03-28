import { describe, expect, it } from "vitest";
import { makeCandidateDecision } from "@/lib/assistant/decision_engine";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "partial",
  algorithmChoice: "reasonable",
  edgeCaseAwareness: "partial",
  behavior: "structured",
  confidence: 0.76,
  evidence: ["Candidate explained the approach clearly."],
  summary: "Understanding is clear and progress is progressing.",
};

const basePolicy = {
  currentStage: "IMPLEMENTATION",
  recommendedAction: "LET_IMPLEMENT",
  shouldServeHint: false,
  nextStage: "IMPLEMENTATION",
  exitCriteria: ["Keep coding"],
  checklist: [],
  checklistProgress: { completed: 0, total: 0, remaining: 0 },
  explanation: "Continue implementation.",
} as const;

describe("makeCandidateDecision", () => {
  it("forces a narrow debug move after repeated failures", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        progress: "stuck",
        codeQuality: "buggy",
      },
      recentEvents: [
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "FAILED" } },
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "ERROR" } },
      ],
      latestExecutionRun: { status: "ERROR", stderr: "IndexError" },
    });

    expect(result.action).toBe("ask_for_debug_plan");
    expect(result.target).toBe("debugging");
    expect(result.suggestedStage).toBe("DEBUGGING");
  });

  it("pushes on tradeoffs when understanding is clear but algorithm choice is weak", () => {
    const result = makeCandidateDecision({
      currentStage: "APPROACH_DISCUSSION",
      policy: {
        ...basePolicy,
        currentStage: "APPROACH_DISCUSSION",
        nextStage: "APPROACH_DISCUSSION",
        recommendedAction: "PROBE_APPROACH",
      },
      signals: {
        ...baseSignals,
        algorithmChoice: "suboptimal",
      },
    });

    expect(result.action).toBe("ask_followup");
    expect(result.target).toBe("tradeoff");
    expect(result.question).toMatch(/runtime|efficient|alternative|tradeoff/i);
  });

  it("asks for edge cases when implementation is complete but validation is thin", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        codeQuality: "correct",
        edgeCaseAwareness: "missing",
      },
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.action).toBe("ask_for_test_case");
    expect(result.target).toBe("edge_case");
    expect(result.suggestedStage).toBe("TESTING_AND_COMPLEXITY");
  });
});
