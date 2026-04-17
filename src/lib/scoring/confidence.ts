import type { ScoringInput } from "@/lib/scoring/types";

export type ConfidenceResult = {
  value: number;
  signalDensity: number;
  noiseRatio: number;
  gapCoverage: number;
  recoveryFailurePenalty: number;
  verbosityPenalty: number;
  qualityFactor: number;
};

export function calculateConfidence(input: {
  signals: ScoringInput["signals"];
  noiseTags: ScoringInput["noiseTags"];
  gapState: ScoringInput["gapState"];
  decisionTrace: ScoringInput["decisionTrace"];
  dimensionScores: {
    requirement_clarity: number;
    capacity_instinct: number;
    tradeoff_depth: number;
    reliability_awareness: number;
    bottleneck_sensitivity: number;
  };
}): ConfidenceResult {
  const explicitSignals = input.signals.filter((signal) => typeof signal.missing === "boolean").length;
  const signalDensity = clamp(explicitSignals / 5, 0, 1);

  const uniqueNoiseTags = [...new Set(input.noiseTags)];
  const noiseRatio = clamp(uniqueNoiseTags.length / 3, 0, 1);

  const openGaps = [
    input.gapState.missing_capacity,
    input.gapState.missing_tradeoff,
    input.gapState.missing_reliability,
    input.gapState.missing_bottleneck,
  ].filter(Boolean).length;
  const totalGaps = 4;
  const gapCoverage = clamp((totalGaps - openGaps) / totalGaps, 0, 1);

  const heavyRescueCount = input.decisionTrace.filter((item) => item.rescueMode === "heavy_rescue").length;
  const recoveryFailurePenalty = heavyRescueCount > 0 && openGaps > 0 ? clamp(0.12 + heavyRescueCount * 0.08, 0, 0.35) : 0;

  const qualityFactor =
    (input.dimensionScores.requirement_clarity +
      input.dimensionScores.capacity_instinct +
      input.dimensionScores.tradeoff_depth +
      input.dimensionScores.reliability_awareness +
      input.dimensionScores.bottleneck_sensitivity) /
    25;

  // talkative bullshitter guard: long trace + unresolved gaps + low quality => confidence should drop.
  const longTrace = input.decisionTrace.length >= 8;
  const lowQuality = qualityFactor < 0.6;
  const verbosityPenalty = longTrace && openGaps >= 2 && lowQuality ? 0.14 : 0;

  const value =
    signalDensity * 0.34 +
    gapCoverage * 0.28 +
    clamp(qualityFactor, 0, 1) * 0.3 -
    noiseRatio * 0.14 -
    recoveryFailurePenalty -
    verbosityPenalty;

  return {
    value: Number(clamp(value, 0, 1).toFixed(2)),
    signalDensity: Number(signalDensity.toFixed(2)),
    noiseRatio: Number(noiseRatio.toFixed(2)),
    gapCoverage: Number(gapCoverage.toFixed(2)),
    recoveryFailurePenalty: Number(recoveryFailurePenalty.toFixed(2)),
    verbosityPenalty: Number(verbosityPenalty.toFixed(2)),
    qualityFactor: Number(clamp(qualityFactor, 0, 1).toFixed(2)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
