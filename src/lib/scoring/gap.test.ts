import { describe, expect, it } from "vitest";
import { calculateGapPenalty } from "@/lib/scoring/gap";

describe("calculateGapPenalty", () => {
  it("applies lighter penalty in early stage and heavier penalty in late stage", () => {
    const gapState = {
      missing_capacity: true,
      missing_tradeoff: false,
      missing_reliability: true,
      missing_bottleneck: false,
    };

    const early = calculateGapPenalty({
      gapState,
      stage: "REQUIREMENTS",
    });
    const late = calculateGapPenalty({
      gapState,
      stage: "WRAP_UP",
    });

    expect(early.totalPenalty).toBeLessThan(late.totalPenalty);
    expect(early.stageMultiplier).toBeLessThan(late.stageMultiplier);
  });

  it("penalizes missing capacity most strongly among open gaps", () => {
    const result = calculateGapPenalty({
      gapState: {
        missing_capacity: true,
        missing_tradeoff: true,
        missing_reliability: true,
        missing_bottleneck: true,
      },
      stage: "DEEP_DIVE",
    });

    expect(result.byGap.capacity).toBeGreaterThan(result.byGap.tradeoff);
    expect(result.byGap.capacity).toBeGreaterThan(result.byGap.bottleneck);
  });
});
