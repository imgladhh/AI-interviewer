export type SystemDesignWeeklySnapshot = {
  generatedAt: string;
  calibration: {
    total: number;
    matched: number;
    accuracy: number;
  };
  calibrationCoverage?: {
    total: number;
    byLevel: Record<"Mid-level" | "Senior" | "Staff", number>;
    byHire: Record<"NO_HIRE" | "BORDERLINE" | "HIRE" | "STRONG_HIRE", number>;
  };
  regression: {
    health: {
      lateBloomerRecovered: boolean;
      bullshitterSuppressed: boolean;
      rigidCapped: boolean;
      passRate: number;
      summary: string;
    };
    stability?: {
      replayCount: number;
      scenarioCount: number;
      maxScoreVariance: number;
      maxRewardVariance: number;
      expectationFlipCount: number;
      summary: string;
    };
    reports: Array<{
      scenarioId: string;
      expectationMet: boolean;
      scoreDiffFromBest: number;
      rewardDiffFromBest: number;
    }>;
  };
};

export type SystemDesignDriftReport = {
  hasBaseline: boolean;
  calibrationAccuracyDelta: number;
  regressionPassRateDelta: number;
  expectationFlips: Array<{
    scenarioId: string;
    from: boolean;
    to: boolean;
  }>;
  summary: string;
};

export function buildSystemDesignDriftReport(input: {
  current: SystemDesignWeeklySnapshot;
  previous: SystemDesignWeeklySnapshot | null;
}): SystemDesignDriftReport {
  if (!input.previous) {
    return {
      hasBaseline: false,
      calibrationAccuracyDelta: 0,
      regressionPassRateDelta: 0,
      expectationFlips: [],
      summary: "No prior snapshot found. Baseline initialized.",
    };
  }

  const calibrationAccuracyDelta = round2(input.current.calibration.accuracy - input.previous.calibration.accuracy);
  const regressionPassRateDelta = round2(input.current.regression.health.passRate - input.previous.regression.health.passRate);
  const previousByScenario = new Map(
    input.previous.regression.reports.map((report) => [report.scenarioId, report.expectationMet]),
  );
  const expectationFlips = input.current.regression.reports
    .map((report) => {
      const previous = previousByScenario.get(report.scenarioId);
      if (typeof previous !== "boolean" || previous === report.expectationMet) {
        return null;
      }
      return {
        scenarioId: report.scenarioId,
        from: previous,
        to: report.expectationMet,
      };
    })
    .filter((item): item is { scenarioId: string; from: boolean; to: boolean } => item !== null);

  const summary =
    expectationFlips.length === 0
      ? `Drift stable. calibration_delta=${formatSigned(calibrationAccuracyDelta)}, pass_rate_delta=${formatSigned(regressionPassRateDelta)}.`
      : `Detected ${expectationFlips.length} expectation flip(s): ${expectationFlips.map((item) => `${item.scenarioId}:${item.from ? "pass" : "fail"}->${item.to ? "pass" : "fail"}`).join(", ")}.`;

  return {
    hasBaseline: true,
    calibrationAccuracyDelta,
    regressionPassRateDelta,
    expectationFlips,
    summary,
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatSigned(value: number) {
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}
