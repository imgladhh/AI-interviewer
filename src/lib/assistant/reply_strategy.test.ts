import { describe, expect, it } from "vitest";
import { buildFallbackReplyFromDecision, describeReplyStrategy } from "@/lib/assistant/reply_strategy";
import type { CandidateDecision } from "@/lib/assistant/decision_engine";
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
  confidence: 0.8,
  evidence: ["Candidate state is progressing."],
  structuredEvidence: [],
  summary: "Understanding is clear, progress is progressing.",
  trendSummary: "Candidate state is broadly stable relative to the previous snapshot.",
};

const baseDecision: CandidateDecision = {
  action: "probe_correctness",
  target: "correctness",
  question: "Why does this stay correct?",
  reason: "Need stronger correctness evidence.",
  confidence: 0.9,
  policyAction: "PROBE_APPROACH",
};

describe("reply strategy issue shaping", () => {
  it("pushes for a proof sketch when the issue says intuition without proof", () => {
    const reply = buildFallbackReplyFromDecision({
      decision: {
        ...baseDecision,
        specificIssue: "The candidate is giving intuition, but not a real proof sketch.",
      },
      signals: baseSignals,
      currentStage: "APPROACH_DISCUSSION",
    });

    expect(reply).toMatch(/proof sketch|intuition/i);
  });

  it("pushes for exact expected outputs when testing precision is weak", () => {
    const reply = buildFallbackReplyFromDecision({
      decision: {
        ...baseDecision,
        action: "ask_for_test_case",
        target: "testing",
        specificIssue: "Test cases were mentioned, but the expected outputs stayed imprecise.",
      },
      signals: baseSignals,
      currentStage: "TESTING_AND_COMPLEXITY",
    });

    expect(reply).toMatch(/exact output|exact result/i);
  });

  it("describes a constraint-justification strategy for shallow tradeoff issues", () => {
    const strategy = describeReplyStrategy(
      {
        ...baseDecision,
        action: "probe_tradeoff",
        target: "tradeoff",
        specificIssue: "A tradeoff was named, but not justified against the actual constraints.",
      },
      baseSignals,
    );

    expect(strategy).toMatch(/acceptable under the actual constraints|justify/i);
  });

  it("uses sharper fallback wording for surgical tradeoff probes", () => {
    const reply = buildFallbackReplyFromDecision({
      decision: {
        ...baseDecision,
        action: "probe_tradeoff",
        target: "tradeoff",
        pressure: "surgical",
      },
      signals: baseSignals,
      currentStage: "APPROACH_DISCUSSION",
    });

    expect(reply).toMatch(/be precise|exact|alternative|tradeoff/i);
  });

  it("keeps clarification gentle when pressure is soft", () => {
    const reply = buildFallbackReplyFromDecision({
      decision: {
        ...baseDecision,
        action: "ask_for_clarification",
        target: "understanding",
        pressure: "soft",
      },
      signals: baseSignals,
      currentStage: "PROBLEM_UNDERSTANDING",
    });

    expect(reply).toMatch(/tiny example|what you expect/i);
    expect(reply).not.toMatch(/be precise/i);
  });

  it("uses graceful wrap-up wording for move_to_wrap_up", () => {
    const reply = buildFallbackReplyFromDecision({
      decision: {
        ...baseDecision,
        action: "move_to_wrap_up",
        target: "summary",
        pressure: "soft",
        intent: "close",
        question: "Give me one concise final wrap-up, then we will close this question.",
      },
      signals: baseSignals,
      currentStage: "WRAP_UP",
    });

    expect(reply).toMatch(/wrap-up|close this question|stop here/i);
  });

  it("mentions intent in the reply strategy description", () => {
    const strategy = describeReplyStrategy(
      {
        ...baseDecision,
        action: "probe_tradeoff",
        target: "tradeoff",
        intent: "validate",
      },
      baseSignals,
    );

    expect(strategy).toMatch(/Intent=validate/i);
  });
});
