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

  it("defers a low-urgency clarification when the candidate is coding smoothly", () => {
    const result = reviewInterviewerReply({
      reply: "Can you restate the next step on one tiny example and say what exact state you expect?",
      decision: {
        ...baseDecision,
        action: "ask_for_clarification",
        target: "reasoning",
        question: "Can you restate the next step on one tiny example and say what exact state you expect?",
      },
      signals: {
        ...baseSignals,
        readyToCode: true,
      },
      currentStage: "IMPLEMENTATION",
      latestExecutionRun: null,
    });

    expect(result.approved).toBe(false);
    expect(result.verdict).toBe("move_on");
    expect(result.timingVerdict).toBe("defer");
    expect(result.reason).toBe("poor_timing");
    expect(result.questionWorthAsking).toBe(false);
  });

  it("skips a question when the evidence was auto-captured already", () => {
    const result = reviewInterviewerReply({
      reply: "Now tell me the final complexity and tradeoff.",
      decision: {
        ...baseDecision,
        action: "probe_tradeoff",
        target: "tradeoff",
      },
      signals: {
        ...baseSignals,
        complexityRigor: "strong",
      },
      currentStage: "TESTING_AND_COMPLEXITY",
      latestExecutionRun: { status: "PASSED" },
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "tradeoff", action: "probe_tradeoff" } },
        },
      ],
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("auto_captured_evidence");
    expect(result.autoCapturedEvidence).toContain("complexity_tradeoff");
    expect(result.questionWorthAsking).toBe(false);
    expect(result.timingVerdict).toBe("skip");
  });

  it("opens a self-correction window during productive debugging flow", () => {
    const result = reviewInterviewerReply({
      reply: "Where do you think the implementation first diverges from your intended logic?",
      decision: {
        ...baseDecision,
        action: "ask_for_debug_plan",
        target: "debugging",
        question: "Where do you think the implementation first diverges from your intended logic?",
      },
      signals: {
        ...baseSignals,
        codeQuality: "buggy",
        progress: "progressing",
      },
      currentStage: "DEBUGGING",
      latestExecutionRun: { status: "FAILED", stderr: "wrong answer" },
      recentEvents: [],
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("self_correction_window");
    expect(result.shouldWaitBeforeIntervening).toBe(true);
    expect(result.wouldLikelySelfCorrect).toBe(true);
    expect(result.selfCorrectionWindowSeconds).toBe(45);
  });

  it("blocks weakly grounded debugging probes that risk false positives", () => {
    const result = reviewInterviewerReply({
      reply: "It looks like your bug is probably in the branch update. Walk me through that exact bug.",
      decision: {
        ...baseDecision,
        action: "ask_for_debug_plan",
        target: "debugging",
        question: "Where do you think the bug is?",
      },
      signals: {
        ...baseSignals,
        codeQuality: "partial",
      },
      currentStage: "IMPLEMENTATION",
      latestExecutionRun: null,
      recentEvents: [],
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("false_positive_risk");
    expect(result.questionWorthAsking).toBe(false);
  });
});
