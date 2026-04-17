import type { ScoringInput } from "@/lib/scoring/types";

export type PivotAdjustmentResult = {
  adjustment: number;
  detectedCount: number;
  nudgeConversionRate: number;
  timeToInsight: number | null;
  hintsBeforeInsight: number;
};

export function calculatePivotAdjustment(input: {
  pivots: ScoringInput["pivots"];
  decisionTrace: ScoringInput["decisionTrace"];
  noiseTags: ScoringInput["noiseTags"];
}): PivotAdjustmentResult {
  if (input.noiseTags.length > 0 || input.pivots.length === 0) {
    return {
      adjustment: 0,
      detectedCount: 0,
      nudgeConversionRate: 0,
      timeToInsight: null,
      hintsBeforeInsight: 0,
    };
  }

  const scoredPivots = input.pivots
    .map((pivot) => {
      const strengthMultiplier =
        pivot.triggerAction === "NONE"
          ? 1
          : pivot.triggerAction === "LIGHT"
            ? 0.6
            : pivot.triggerAction === "HEAVY"
              ? 0.15
              : 0.45;
      const thresholdedImpact = clamp(pivot.impactScore, 0, 1);
      if (thresholdedImpact < 0.25) {
        return 0;
      }
      return thresholdedImpact * strengthMultiplier;
    })
    .filter((value) => value > 0);

  if (scoredPivots.length === 0) {
    return {
      adjustment: 0,
      detectedCount: 0,
      nudgeConversionRate: 0,
      timeToInsight: null,
      hintsBeforeInsight: countNudges(input.decisionTrace),
    };
  }

  const hintsBeforeInsight = countHintsBeforeFirstInsight(input.decisionTrace, input.pivots);
  const nudgeCount = countNudges(input.decisionTrace);
  const nudgeConversionRate = nudgeCount === 0 ? 1 : clamp(scoredPivots.length / nudgeCount, 0, 1);
  const firstInsightTurn = input.pivots.find((pivot) => pivot.impactScore >= 0.25)?.turnId ?? null;
  const timeToInsight = computeTurnsToInsight(input.decisionTrace, firstInsightTurn);

  // Asymmetric reward: self-driven insight is boosted, heavy rescue produces near-zero lift.
  const base = scoredPivots.reduce((sum, value) => sum + value, 0) / scoredPivots.length;
  const rescueDamping = clamp(
    1 - input.decisionTrace.filter((item) => item.rescueMode === "heavy_rescue").length * 0.22,
    0.2,
    1,
  );
  const conversionMultiplier = 0.65 + 0.35 * nudgeConversionRate;
  const adjustment = clamp(Number((base * rescueDamping * conversionMultiplier).toFixed(2)), 0, 0.9);

  return {
    adjustment,
    detectedCount: scoredPivots.length,
    nudgeConversionRate: Number(nudgeConversionRate.toFixed(2)),
    timeToInsight,
    hintsBeforeInsight,
  };
}

function countNudges(decisions: ScoringInput["decisionTrace"]) {
  return decisions.filter((decision) => {
    const action = (decision.action ?? "").toLowerCase();
    return action.includes("hint") || action.includes("guide");
  }).length;
}

function countHintsBeforeFirstInsight(
  decisions: ScoringInput["decisionTrace"],
  pivots: ScoringInput["pivots"],
) {
  const firstTurnId = pivots.find((pivot) => pivot.impactScore >= 0.25)?.turnId ?? null;
  if (!firstTurnId) {
    return countNudges(decisions);
  }

  let hints = 0;
  for (const decision of decisions) {
    if ((decision.turnId ?? null) === firstTurnId) {
      break;
    }
    const action = (decision.action ?? "").toLowerCase();
    if (action.includes("hint") || action.includes("guide")) {
      hints += 1;
    }
  }
  return hints;
}

function computeTurnsToInsight(
  decisions: ScoringInput["decisionTrace"],
  pivotTurnId: string | null,
): number | null {
  if (!pivotTurnId || decisions.length === 0) {
    return null;
  }
  const index = decisions.findIndex((decision) => (decision.turnId ?? null) === pivotTurnId);
  if (index < 0) {
    return null;
  }
  return index + 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
