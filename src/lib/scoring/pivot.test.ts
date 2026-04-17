import { describe, expect, it } from "vitest";
import { calculatePivotAdjustment } from "@/lib/scoring/pivot";

describe("calculatePivotAdjustment", () => {
  it("boosts adjustment when insight is self-driven without hint dependency", () => {
    const result = calculatePivotAdjustment({
      pivots: [
        { turnId: "t-2", triggerAction: "NONE", impactScore: 0.72 },
        { turnId: "t-4", triggerAction: "NONE", impactScore: 0.68 },
      ],
      decisionTrace: [
        { turnId: "t-1", action: "ask_requirement", rescueMode: "none" },
        { turnId: "t-2", action: "probe_tradeoff", rescueMode: "none" },
      ],
      noiseTags: [],
    });

    expect(result.adjustment).toBeGreaterThanOrEqual(0.6);
    expect(result.nudgeConversionRate).toBe(1);
    expect(result.hintsBeforeInsight).toBe(0);
  });

  it("keeps adjustment near zero when pivots happen only after heavy rescue", () => {
    const result = calculatePivotAdjustment({
      pivots: [{ turnId: "t-6", triggerAction: "HEAVY", impactScore: 0.92 }],
      decisionTrace: [
        { turnId: "t-1", action: "give_hint", rescueMode: "heavy_rescue" },
        { turnId: "t-2", action: "give_hint", rescueMode: "heavy_rescue" },
        { turnId: "t-3", action: "ask_capacity", rescueMode: "heavy_rescue" },
      ],
      noiseTags: [],
    });

    expect(result.adjustment).toBeLessThanOrEqual(0.08);
    expect(result.nudgeConversionRate).toBeLessThanOrEqual(0.5);
  });
});
