import { describe, expect, it } from "vitest";
import { estimateNonLinearHintCost, resolveHintStrategy, resolveHintTier } from "@/lib/assistant/hint_strategy";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "stuck",
  communication: "clear",
  codeQuality: "buggy",
  algorithmChoice: "reasonable",
  edgeCaseAwareness: "partial",
  behavior: "structured",
  readyToCode: true,
  reasoningDepth: "moderate",
  testingDiscipline: "partial",
  complexityRigor: "moderate",
  confidence: 0.72,
  evidence: [],
  structuredEvidence: [],
  summary: "Candidate needs bounded rescue.",
};

describe("hint_strategy", () => {
  it("maps light conceptual nudges to L0", () => {
    const tier = resolveHintTier({
      hintStyle: "CLARIFYING_NUDGE",
      hintLevel: "LIGHT",
      granularity: "conceptual",
    });

    expect(tier).toBe("L0_NUDGE");
  });

  it("uses nonlinear costs for stronger hints", () => {
    expect(estimateNonLinearHintCost({ tier: "L3_SOLUTION", rescueMode: "debug_rescue" })).toBeGreaterThan(
      estimateNonLinearHintCost({ tier: "L0_NUDGE", rescueMode: "conceptual_rescue" }),
    );
  });

  it("resolves strategy with rescue mode and tier together", () => {
    const result = resolveHintStrategy({
      currentStage: "DEBUGGING",
      signals: baseSignals,
      recentFailedRuns: 2,
      hintStyle: "DEBUGGING_NUDGE",
      hintLevel: "STRONG",
    });

    expect(result.tier).toBe("L3_SOLUTION");
    expect(result.rescueMode).toBe("debug_rescue");
    expect(result.hintCost).toBeGreaterThan(5);
  });
});
