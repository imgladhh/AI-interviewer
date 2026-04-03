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
    expect(["move_on", "move_to_wrap_up", "close_topic"]).toContain(result.verdict);
    expect(["repeated_answered_target", "auto_captured_evidence", "evidence_saturated"]).toContain(result.reason);
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
    expect(["move_to_implementation", "close_topic"]).toContain(result.verdict);
    expect(["should_move_to_implementation", "auto_captured_evidence"]).toContain(result.reason);
    expect(result.questionWorthAsking).toBe(false);
    expect(result.revisedReply).toMatch(/implement|code|keep moving|proof story/i);
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
    expect(["rewrite", "move_to_wrap_up", "close_topic"]).toContain(result.verdict);
    expect(result.specificity).toBe("low");
    expect(typeof result.questionWorthAsking).toBe("boolean");
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
    expect(["move_on", "move_to_wrap_up", "close_topic"]).toContain(result.verdict);
    expect(["defer", "skip"]).toContain(result.timingVerdict);
    expect(["poor_timing", "auto_captured_evidence"]).toContain(result.reason);
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
    expect(["auto_captured_evidence", "evidence_saturated"]).toContain(result.reason);
    expect(Array.isArray(result.autoCapturedEvidence)).toBe(true);
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
    expect(["self_correction_window", "not_specific_enough"]).toContain(result.reason);
    expect(typeof result.shouldWaitBeforeIntervening).toBe("boolean");
    expect(typeof result.wouldLikelySelfCorrect).toBe("boolean");
    expect(result.selfCorrectionWindowSeconds == null || result.selfCorrectionWindowSeconds >= 30).toBe(true);
  });

  it("closes the question when wrap-up evidence is already saturated", () => {
    const result = reviewInterviewerReply({
      reply: "You have already supplied enough evidence on that point for now. Keep going.",
      decision: {
        ...baseDecision,
        action: "move_to_wrap_up",
        target: "summary",
        question: "Give me one final wrap-up.",
      },
      signals: {
        ...baseSignals,
        progress: "done",
      },
      currentStage: "WRAP_UP",
      latestExecutionRun: { status: "PASSED" },
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "summary", action: "move_to_wrap_up" } },
        },
      ],
    });

    expect(result.approved).toBe(false);
    expect(["evidence_saturated", "auto_captured_evidence"]).toContain(result.reason);
    expect(result.evidenceAlreadySaturated).toBe(true);
    expect(result.recommendedClosure).toBe("end_interview");
    expect(result.revisedReply).toMatch(/done here|done with this question/i);
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



