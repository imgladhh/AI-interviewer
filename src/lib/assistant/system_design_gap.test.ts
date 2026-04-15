import { describe, expect, it } from "vitest";
import {
  deriveSystemDesignGapState,
  pickPrimarySystemDesignGap,
  routeSystemDesignActionByGap,
} from "@/lib/assistant/system_design_gap";

describe("system design gap routing", () => {
  it("derives gap state from signals and handwave categories", () => {
    const gap = deriveSystemDesignGapState({
      signals: {
        capacity_missing: false,
        tradeoff_missed: false,
        spof_missed: true,
        bottleneck_unexamined: false,
      },
      handwaveCategories: ["unquantified_scaling_claim", "tradeoff_evasion"],
    });

    expect(gap.missing_capacity).toBe(true);
    expect(gap.missing_tradeoff).toBe(true);
    expect(gap.missing_reliability).toBe(true);
    expect(gap.missing_bottleneck).toBe(false);
  });

  it("prefers snapshot gap state when provided", () => {
    const gap = deriveSystemDesignGapState({
      signals: {
        capacity_missing: true,
        tradeoff_missed: true,
        spof_missed: true,
        bottleneck_unexamined: true,
      },
      snapshotGapState: {
        missing_capacity: false,
        missing_tradeoff: false,
        missing_reliability: true,
        missing_bottleneck: false,
      },
    });

    expect(gap).toEqual({
      missing_capacity: false,
      missing_tradeoff: false,
      missing_reliability: true,
      missing_bottleneck: false,
    });
  });

  it("routes to action by primary gap priority", () => {
    expect(
      pickPrimarySystemDesignGap({
        missing_capacity: true,
        missing_tradeoff: true,
        missing_reliability: true,
        missing_bottleneck: true,
      }),
    ).toBe("capacity");
    expect(
      routeSystemDesignActionByGap({
        missing_capacity: false,
        missing_tradeoff: true,
        missing_reliability: false,
        missing_bottleneck: false,
      }),
    ).toBe("PROBE_TRADEOFF");
  });
});

