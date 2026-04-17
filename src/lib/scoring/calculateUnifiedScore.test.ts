import { describe, expect, it } from "vitest";
import { calculateUnifiedScore } from "@/lib/scoring/calculateUnifiedScore";
import type { ScoringInput } from "@/lib/scoring/types";

function createInput(overrides?: Partial<ScoringInput>): ScoringInput {
  return {
    signals: [
      { key: "requirement_missing", missing: false },
      { key: "capacity_missing", missing: false },
      { key: "tradeoff_missed", missing: false },
      { key: "spof_missed", missing: false },
      { key: "bottleneck_unexamined", missing: false },
    ],
    gapState: {
      missing_capacity: false,
      missing_tradeoff: false,
      missing_reliability: false,
      missing_bottleneck: false,
    },
    pivots: [{ turnId: "t-1", triggerAction: "NONE", impactScore: 0.8 }],
    noiseTags: [],
    metadata: {
      stage: "DEEP_DIVE",
      targetLevel: "SENIOR",
    },
    decisionTrace: [],
    rewardTrace: [],
    ...overrides,
  };
}

describe("calculateUnifiedScore", () => {
  it("is deterministic and idempotent for identical input", () => {
    const input = createInput();
    const first = calculateUnifiedScore(input);
    const second = calculateUnifiedScore(input);

    expect(first).toEqual(second);
  });

  it("keeps confidence and level low when there is no evidence", () => {
    const result = calculateUnifiedScore(
      createInput({
        signals: [],
        pivots: [],
        gapState: {
          missing_capacity: true,
          missing_tradeoff: true,
          missing_reliability: true,
          missing_bottleneck: true,
        },
      }),
    );

    expect(result.rawLevel).toBe("L3");
    expect(result.cappedLevel).toBe("L3");
    expect(result.confidence).toBeLessThanOrEqual(0.25);
  });

  it("applies hard caps when core dimensions are weak even if pivots are strong", () => {
    const result = calculateUnifiedScore(
      createInput({
        signals: [
          { key: "requirement_missing", missing: false },
          { key: "capacity_missing", missing: true },
          { key: "tradeoff_missed", missing: true },
          { key: "spof_missed", missing: false },
          { key: "bottleneck_unexamined", missing: true },
        ],
        pivots: [{ turnId: "t-9", triggerAction: "NONE", impactScore: 1 }],
      }),
    );

    expect(result.rawLevel === "L5" || result.rawLevel === "L6" || result.rawLevel === "L4").toBe(true);
    expect(["L4", "L3"]).toContain(result.cappedLevel);
    expect(result.appliedCaps).toEqual(
      expect.arrayContaining(["capacity_instinct", "tradeoff_depth", "bottleneck_sensitivity"]),
    );
  });

  it("adds stronger pivot lift for self-driven insight than hint-driven rescue", () => {
    const selfDriven = calculateUnifiedScore(
      createInput({
        pivots: [{ turnId: "t-2", triggerAction: "NONE", impactScore: 0.78 }],
        decisionTrace: [{ turnId: "t-1", action: "ask_requirement", rescueMode: "none" }],
      }),
    );
    const rescueDriven = calculateUnifiedScore(
      createInput({
        pivots: [{ turnId: "t-2", triggerAction: "HEAVY", impactScore: 0.9 }],
        decisionTrace: [
          { turnId: "t-1", action: "give_hint", rescueMode: "heavy_rescue" },
          { turnId: "t-2", action: "give_hint", rescueMode: "heavy_rescue" },
        ],
      }),
    );

    expect((selfDriven.pivotSummary?.adjustment ?? 0)).toBeGreaterThan((rescueDriven.pivotSummary?.adjustment ?? 0) + 0.3);
  });

  it("reduces confidence when heavy rescue persists while key gaps remain open", () => {
    const strong = calculateUnifiedScore(createInput());
    const weak = calculateUnifiedScore(
      createInput({
        signals: [
          { key: "requirement_missing", missing: false },
          { key: "capacity_missing", missing: true },
          { key: "tradeoff_missed", missing: true },
          { key: "spof_missed", missing: true },
          { key: "bottleneck_unexamined", missing: true },
        ],
        gapState: {
          missing_capacity: true,
          missing_tradeoff: true,
          missing_reliability: true,
          missing_bottleneck: true,
        },
        decisionTrace: [
          { action: "give_hint", rescueMode: "heavy_rescue" },
          { action: "give_hint", rescueMode: "heavy_rescue" },
          { action: "ask_for_clarification", rescueMode: "heavy_rescue" },
          { action: "probe_tradeoff", rescueMode: "none" },
          { action: "probe_tradeoff", rescueMode: "none" },
          { action: "ask_capacity", rescueMode: "none" },
          { action: "ask_capacity", rescueMode: "none" },
          { action: "ask_capacity", rescueMode: "none" },
          { action: "ask_capacity", rescueMode: "none" },
        ],
      }),
    );

    expect(weak.confidence).toBeLessThan(strong.confidence);
    expect((weak.confidenceBreakdown?.recoveryFailurePenalty ?? 0)).toBeGreaterThan(0);
  });

  it("applies stronger causal penalty when capacity is skipped at deep-dive than at requirements", () => {
    const baseSignals = [
      { key: "requirement_missing", missing: false as const },
      { key: "capacity_missing", missing: true as const },
      { key: "tradeoff_missed", missing: false as const },
      { key: "spof_missed", missing: false as const },
      { key: "bottleneck_unexamined", missing: false as const },
    ];
    const early = calculateUnifiedScore(
      createInput({
        metadata: { stage: "REQUIREMENTS", targetLevel: "SDE2" },
        signals: baseSignals,
        gapState: {
          missing_capacity: true,
          missing_tradeoff: false,
          missing_reliability: false,
          missing_bottleneck: false,
        },
        pivots: [],
      }),
    );
    const late = calculateUnifiedScore(
      createInput({
        metadata: { stage: "DEEP_DIVE", targetLevel: "SDE2" },
        signals: baseSignals,
        gapState: {
          missing_capacity: true,
          missing_tradeoff: false,
          missing_reliability: false,
          missing_bottleneck: false,
        },
        pivots: [],
      }),
    );

    expect((early.gapBreakdown?.totalPenalty ?? 0)).toBeLessThan(late.gapBreakdown?.totalPenalty ?? 0);
    expect(late.rawLevel).not.toBe("L6");
    expect(late.confidence).toBeLessThanOrEqual(early.confidence);
  });
});
