import { describe, expect, it } from "vitest";
import {
  estimateNonLinearHintCost,
  resolveHintInitiator,
  resolveHintRequestTiming,
  resolveHintStrategy,
  resolveHintTier,
} from "@/lib/assistant/hint_strategy";
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

  it("makes early candidate-requested hints more expensive than system rescue", () => {
    const earlyCandidateCost = estimateNonLinearHintCost({
      tier: "L1_AREA",
      rescueMode: "conceptual_rescue",
      hintInitiator: "candidate_request",
      hintRequestTiming: "early",
      momentumAtHint: "productive",
    });
    const rescueCost = estimateNonLinearHintCost({
      tier: "L1_AREA",
      rescueMode: "conceptual_rescue",
      hintInitiator: "system_rescue",
      hintRequestTiming: "mid",
      momentumAtHint: "stalled",
    });

    expect(earlyCandidateCost).toBeGreaterThan(rescueCost);
  });

  it("detects candidate-requested hints from recent events", () => {
    expect(
      resolveHintInitiator([{ eventType: "HINT_REQUESTED", payloadJson: { source: "room-controls" } }]),
    ).toBe("candidate_request");
    expect(resolveHintInitiator([])).toBe("system_rescue");
  });

  it("classifies request timing by stage", () => {
    expect(resolveHintRequestTiming("APPROACH_DISCUSSION")).toBe("early");
    expect(resolveHintRequestTiming("IMPLEMENTATION")).toBe("mid");
    expect(resolveHintRequestTiming("WRAP_UP")).toBe("late");
  });

  it("resolves strategy with dynamic hint context and rescue mode together", () => {
    const result = resolveHintStrategy({
      currentStage: "DEBUGGING",
      signals: baseSignals,
      recentFailedRuns: 2,
      recentEvents: [{ eventType: "HINT_REQUESTED", payloadJson: { source: "room-controls" } }],
      hintStyle: "DEBUGGING_NUDGE",
      hintLevel: "STRONG",
    });

    expect(result.tier).toBe("L3_SOLUTION");
    expect(result.rescueMode).toBe("debug_rescue");
    expect(result.hintInitiator).toBe("candidate_request");
    expect(result.hintRequestTiming).toBe("mid");
    expect(result.momentumAtHint).toBe("stalled");
    expect(result.hintCost).toBeGreaterThan(5);
  });
});
