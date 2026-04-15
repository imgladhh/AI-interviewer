import { describe, expect, it } from "vitest";
import { buildSystemDesignDriftReport, type SystemDesignWeeklySnapshot } from "@/lib/evaluation/system-design-drift";

function makeSnapshot(overrides?: Partial<SystemDesignWeeklySnapshot>): SystemDesignWeeklySnapshot {
  return {
    generatedAt: "2026-04-15T00:00:00.000Z",
    calibration: {
      total: 10,
      matched: 8,
      accuracy: 0.8,
    },
    regression: {
      health: {
        lateBloomerRecovered: true,
        bullshitterSuppressed: true,
        rigidCapped: true,
        passRate: 1,
        summary: "all pass",
      },
      reports: [
        { scenarioId: "late_bloomer", expectationMet: true, scoreDiffFromBest: 0.4, rewardDiffFromBest: 0 },
        { scenarioId: "confident_bullshitter", expectationMet: true, scoreDiffFromBest: 0.8, rewardDiffFromBest: 0.1 },
        { scenarioId: "rigid_coder", expectationMet: true, scoreDiffFromBest: 0, rewardDiffFromBest: 0.2 },
      ],
    },
    ...overrides,
  };
}

describe("buildSystemDesignDriftReport", () => {
  it("initializes baseline when no previous snapshot exists", () => {
    const report = buildSystemDesignDriftReport({
      current: makeSnapshot(),
      previous: null,
    });

    expect(report.hasBaseline).toBe(false);
    expect(report.calibrationAccuracyDelta).toBe(0);
    expect(report.regressionPassRateDelta).toBe(0);
    expect(report.expectationFlips).toHaveLength(0);
  });

  it("computes deltas and detects expectation flips", () => {
    const previous = makeSnapshot({
      calibration: { total: 10, matched: 9, accuracy: 0.9 },
      regression: {
        health: {
          lateBloomerRecovered: true,
          bullshitterSuppressed: true,
          rigidCapped: false,
          passRate: 0.67,
          summary: "2/3",
        },
        reports: [
          { scenarioId: "late_bloomer", expectationMet: true, scoreDiffFromBest: 0.2, rewardDiffFromBest: 0 },
          { scenarioId: "confident_bullshitter", expectationMet: false, scoreDiffFromBest: 1.2, rewardDiffFromBest: 0.3 },
          { scenarioId: "rigid_coder", expectationMet: false, scoreDiffFromBest: 0.1, rewardDiffFromBest: 0.2 },
        ],
      },
    });
    const current = makeSnapshot();

    const report = buildSystemDesignDriftReport({ current, previous });

    expect(report.hasBaseline).toBe(true);
    expect(report.calibrationAccuracyDelta).toBe(-0.1);
    expect(report.regressionPassRateDelta).toBe(0.33);
    expect(report.expectationFlips.some((item) => item.scenarioId === "confident_bullshitter")).toBe(true);
    expect(report.expectationFlips.some((item) => item.scenarioId === "rigid_coder")).toBe(true);
  });
});

