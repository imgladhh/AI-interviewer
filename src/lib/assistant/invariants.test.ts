import { describe, expect, it } from "vitest";
import { applyDecisionInvariants, buildDecisionJustification } from "@/lib/assistant/invariants";
import { getPolicyPreset } from "@/lib/assistant/policy-config";
import type { CandidateDecision } from "@/lib/assistant/decision_engine";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "partial",
  algorithmChoice: "strong",
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
  action: "probe_correctness",
  target: "correctness",
  question: "What invariant guarantees this stays correct?",
  reason: "Need correctness evidence.",
  confidence: 0.88,
  pressure: "surgical",
  timing: "ask_now",
  worthAskingNow: true,
  policyAction: "PROBE_APPROACH",
};

describe("decision invariants", () => {
  it("forces hold_and_listen during steady implementation progress", () => {
    const memory = buildMemoryLedger({
      currentStage: "IMPLEMENTATION",
      signals: baseSignals,
      recentEvents: [],
      latestExecutionRun: null,
    });

    const result = applyDecisionInvariants({
      decision: baseDecision,
      currentStage: "IMPLEMENTATION",
      signals: baseSignals,
      memory,
      trajectory: {
        candidateTrajectory: "steady_progress",
        expectedWithNoIntervention: "will_finish",
        interventionValue: "low",
        bestIntervention: "none",
        interruptionCost: "high",
        evidenceGainIfAskNow: "low",
        confidence: 0.8,
      },
      policyConfig: getPolicyPreset("collaborative"),
    });

    expect(result.blockedByInvariant).toBe("flow_preservation");
    expect(result.decision.action).toBe("hold_and_listen");
    expect(result.decision.target).toBe("implementation");
    expect(result.decisionPathway).toEqual([
      "Policy(collaborative)",
      "Invariant(flow_preservation)",
      "Action(hold_and_listen)",
    ]);
  });

  it("blocks repeated probing of an answered target", () => {
    const memory = buildMemoryLedger({
      currentStage: "TESTING_AND_COMPLEXITY",
      signals: baseSignals,
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "complexity",
              action: "ask_for_complexity",
            },
          },
        },
      ],
      latestExecutionRun: { status: "PASSED" },
    });

    const result = applyDecisionInvariants({
      decision: {
        ...baseDecision,
        action: "ask_for_complexity",
        target: "complexity",
      },
      currentStage: "TESTING_AND_COMPLEXITY",
      signals: baseSignals,
      memory,
      trajectory: {
        candidateTrajectory: "plateauing",
        expectedWithNoIntervention: "may_finish_with_gaps",
        interventionValue: "medium",
        bestIntervention: "ask_for_complexity",
        interruptionCost: "low",
        evidenceGainIfAskNow: "medium",
        confidence: 0.82,
      },
      policyConfig: getPolicyPreset("bar_raiser"),
    });

    expect(result.blockedByInvariant).toBe("anti_repetition");
    expect(result.decision.worthAskingNow).toBe(false);
  });

  it("adds explainable decision justification including the blocked invariant", () => {
    const memory = buildMemoryLedger({
      currentStage: "IMPLEMENTATION",
      signals: baseSignals,
      recentEvents: [],
      latestExecutionRun: null,
    });

    const justification = buildDecisionJustification({
      decision: {
        ...baseDecision,
        action: "hold_and_listen",
        target: "implementation",
        timing: "defer",
        worthAskingNow: false,
      },
      signals: baseSignals,
      memory,
      trajectory: {
        candidateTrajectory: "steady_progress",
        expectedWithNoIntervention: "will_finish",
        interventionValue: "low",
        bestIntervention: "none",
        interruptionCost: "high",
        evidenceGainIfAskNow: "low",
        confidence: 0.8,
      },
      blockedByInvariant: "flow_preservation",
    });

    expect(justification.whyNow).toMatch(/poor time|defer|interruption/i);
    expect(justification.supportingSignals).toContain("ready_to_code");
    expect(justification.blockedByInvariant).toBe("flow_preservation");
  });
});
