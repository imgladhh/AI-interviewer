import { describe, expect, it } from "vitest";
import { calculateConfidence } from "@/lib/scoring/confidence";

describe("calculateConfidence", () => {
  it("keeps confidence low for talkative bullshitter pattern", () => {
    const result = calculateConfidence({
      signals: [
        { key: "requirement_missing", missing: false },
        { key: "capacity_missing", missing: true },
        { key: "tradeoff_missed", missing: true },
      ],
      noiseTags: ["PARTIAL_TRANSCRIPT"],
      gapState: {
        missing_capacity: true,
        missing_tradeoff: true,
        missing_reliability: true,
        missing_bottleneck: false,
      },
      decisionTrace: [
        { action: "ask_for_clarification", rescueMode: "heavy_rescue" },
        { action: "ask_for_clarification", rescueMode: "heavy_rescue" },
        { action: "give_hint", rescueMode: "heavy_rescue" },
        { action: "give_hint", rescueMode: "heavy_rescue" },
        { action: "probe_tradeoff", rescueMode: "none" },
        { action: "probe_tradeoff", rescueMode: "none" },
        { action: "ask_capacity", rescueMode: "none" },
        { action: "ask_capacity", rescueMode: "none" },
        { action: "ask_capacity", rescueMode: "none" },
      ],
      dimensionScores: {
        requirement_clarity: 4.5,
        capacity_instinct: 2,
        tradeoff_depth: 2,
        reliability_awareness: 2,
        bottleneck_sensitivity: 2,
      },
    });

    expect(result.value).toBeLessThanOrEqual(0.45);
    expect(result.recoveryFailurePenalty).toBeGreaterThan(0);
    expect(result.verbosityPenalty).toBeGreaterThan(0);
  });

  it("keeps confidence high for silent strong pattern", () => {
    const result = calculateConfidence({
      signals: [
        { key: "requirement_missing", missing: false },
        { key: "capacity_missing", missing: false },
        { key: "tradeoff_missed", missing: false },
        { key: "spof_missed", missing: false },
        { key: "bottleneck_unexamined", missing: false },
      ],
      noiseTags: [],
      gapState: {
        missing_capacity: false,
        missing_tradeoff: false,
        missing_reliability: false,
        missing_bottleneck: false,
      },
      decisionTrace: [{ action: "probe_tradeoff", rescueMode: "none" }],
      dimensionScores: {
        requirement_clarity: 4.5,
        capacity_instinct: 4.5,
        tradeoff_depth: 4.5,
        reliability_awareness: 4.5,
        bottleneck_sensitivity: 4.5,
      },
    });

    expect(result.value).toBeGreaterThanOrEqual(0.85);
    expect(result.noiseRatio).toBe(0);
    expect(result.recoveryFailurePenalty).toBe(0);
  });
});
