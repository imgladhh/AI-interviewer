import { describe, expect, it } from "vitest";
import { assessInterviewPacing, applyDecisionPressure } from "@/lib/assistant/pacing";
import type { CandidateDecision } from "@/lib/assistant/decision_engine";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "partial",
  algorithmChoice: "reasonable",
  edgeCaseAwareness: "present",
  behavior: "structured",
  readyToCode: true,
  reasoningDepth: "moderate",
  testingDiscipline: "strong",
  complexityRigor: "strong",
  confidence: 0.84,
  evidence: ["Candidate explained a concrete implementation path."],
  structuredEvidence: [],
  summary: "Candidate is ready to code.",
  trendSummary: "Candidate state is broadly stable relative to the previous snapshot.",
};

const baseDecision: CandidateDecision = {
  action: "ask_for_complexity",
  target: "complexity",
  question: "What is the final time and space complexity?",
  reason: "Need final performance summary.",
  confidence: 0.88,
  policyAction: "VALIDATE_AND_TEST",
};

describe("pacing", () => {
  it("marks additional pre-code probing as not worth asking when implementation should start", () => {
    const ledger = buildMemoryLedger({
      currentStage: "APPROACH_DISCUSSION",
      signals: baseSignals,
      recentEvents: [],
      latestExecutionRun: null,
    });

    const pacing = assessInterviewPacing({
      currentStage: "APPROACH_DISCUSSION",
      signals: baseSignals,
      ledger,
      latestExecutionRun: null,
      decision: {
        ...baseDecision,
        action: "probe_correctness",
        target: "correctness",
      },
    });

    expect(pacing.mustMoveToImplementation).toBe(true);
    expect(pacing.questionWorthAsking).toBe(false);
  });

  it("raises pressure on tradeoff probes when the algorithm choice is weak", () => {
    const signals = { ...baseSignals, readyToCode: false, algorithmChoice: "suboptimal" as const };
    const ledger = buildMemoryLedger({
      currentStage: "APPROACH_DISCUSSION",
      signals,
      recentEvents: [],
      latestExecutionRun: null,
    });
    const pacing = assessInterviewPacing({
      currentStage: "APPROACH_DISCUSSION",
      signals,
      ledger,
      latestExecutionRun: null,
      decision: {
        ...baseDecision,
        action: "probe_tradeoff",
        target: "tradeoff",
      },
    });

    const enriched = applyDecisionPressure({
      decision: {
        ...baseDecision,
        action: "probe_tradeoff",
        target: "tradeoff",
      },
      signals,
      ledger,
      pacing,
      latestExecutionRun: null,
    });

    expect(enriched.pressure).toBe("surgical");
  });

  it("defers optional probing when implementation flow is good and interruption cost is higher than urgency", () => {
    const decision: CandidateDecision = {
      ...baseDecision,
      action: "ask_for_clarification",
      target: "reasoning",
      question: "Can you restate the next step on a tiny example?",
    };
    const ledger = buildMemoryLedger({
      currentStage: "IMPLEMENTATION",
      signals: baseSignals,
      recentEvents: [],
      latestExecutionRun: null,
    });

    const pacing = assessInterviewPacing({
      currentStage: "IMPLEMENTATION",
      signals: baseSignals,
      ledger,
      latestExecutionRun: null,
      decision,
    });

    expect(pacing.questionWorthAsking).toBe(false);
    expect(pacing.timingVerdict).toBe("defer");
    expect(pacing.interruptionCost).toBe("high");
    expect(pacing.urgency).toBe("low");
  });
});
