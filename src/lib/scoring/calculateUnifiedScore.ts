import {
  capByBottleneckSensitivity,
  capByCapacityInstinct,
  capByTradeoffDepth,
  minLevel,
  type HardCap,
} from "@/lib/scoring/caps";
import { calculateConfidence as calculateConfidenceEngine } from "@/lib/scoring/confidence";
import { calculateGapPenalty as calculateGapPenaltyEngine } from "@/lib/scoring/gap";
import { calculatePivotAdjustment as calculatePivotEngine } from "@/lib/scoring/pivot";
import type {
  DesignSignalKey,
  EvaluationResult,
  ScoringInput,
  Signal,
  UnifiedLevel,
  UnifiedVerdict,
} from "@/lib/scoring/types";

type CleanContext = {
  signals: Signal[];
  gapState: ScoringInput["gapState"];
  pivots: ScoringInput["pivots"];
  noiseTags: ScoringInput["noiseTags"];
  metadata: ScoringInput["metadata"];
  decisionTrace: ScoringInput["decisionTrace"];
  rewardTrace: ScoringInput["rewardTrace"];
};

const SIGNAL_TO_DIMENSION: Record<DesignSignalKey, keyof DimensionScores> = {
  requirement_missing: "requirement_clarity",
  capacity_missing: "capacity_instinct",
  tradeoff_missed: "tradeoff_depth",
  spof_missed: "reliability_awareness",
  bottleneck_unexamined: "bottleneck_sensitivity",
};

type DimensionScores = {
  requirement_clarity: number;
  capacity_instinct: number;
  tradeoff_depth: number;
  reliability_awareness: number;
  bottleneck_sensitivity: number;
};

export function calculateUnifiedScore(input: ScoringInput): EvaluationResult {
  const clean = prepareCleanContext(input);
  const dimensionScores = aggregateDimensions(clean);
  const pivotResult = calculatePivotEngine({
    pivots: clean.pivots,
    decisionTrace: clean.decisionTrace,
    noiseTags: clean.noiseTags,
  });
  const gapResult = calculateGapPenaltyEngine({
    gapState: clean.gapState,
    stage: clean.metadata.stage,
  });

  const averageDimensionScore =
    (dimensionScores.requirement_clarity +
      dimensionScores.capacity_instinct +
      dimensionScores.tradeoff_depth +
      dimensionScores.reliability_awareness +
      dimensionScores.bottleneck_sensitivity) /
    5;

  const compositeScore = clamp(averageDimensionScore + pivotResult.adjustment - gapResult.totalPenalty, 0, 5);
  const rawLevel = mapScoreToLevel(compositeScore);
  const capResult = applyHardCaps(rawLevel, dimensionScores);
  const confidenceResult = calculateConfidenceEngine({
    signals: clean.signals,
    noiseTags: clean.noiseTags,
    gapState: clean.gapState,
    decisionTrace: clean.decisionTrace,
    dimensionScores,
  });

  const explanation: string[] = [
    `Composite score=${compositeScore.toFixed(2)} (avg=${averageDimensionScore.toFixed(2)}, pivot=+${pivotResult.adjustment.toFixed(2)}, gap=-${gapResult.totalPenalty.toFixed(2)}).`,
    `Pivot conversion=${pivotResult.nudgeConversionRate.toFixed(2)}, hints_before_insight=${pivotResult.hintsBeforeInsight}, time_to_insight=${pivotResult.timeToInsight ?? "n/a"}.`,
    `Gap penalty stage_multiplier=${gapResult.stageMultiplier.toFixed(2)}, open_gaps=${gapResult.openGapCount}, capacity_gap_penalty=${gapResult.byGap.capacity.toFixed(2)}.`,
    ...capResult.reasons,
    `Confidence=${confidenceResult.value.toFixed(2)} (signal_density=${confidenceResult.signalDensity.toFixed(2)}, noise_ratio=${confidenceResult.noiseRatio.toFixed(2)}, gap_coverage=${confidenceResult.gapCoverage.toFixed(2)}).`,
  ];

  return {
    rawLevel,
    cappedLevel: capResult.level,
    verdict: levelToVerdict(capResult.level),
    confidence: confidenceResult.value,
    dimensionScores,
    appliedCaps: capResult.appliedCaps,
    explanation,
    pivotSummary: {
      adjustment: pivotResult.adjustment,
      detectedCount: pivotResult.detectedCount,
      nudgeConversionRate: pivotResult.nudgeConversionRate,
      timeToInsight: pivotResult.timeToInsight,
      hintsBeforeInsight: pivotResult.hintsBeforeInsight,
    },
    confidenceBreakdown: {
      signalDensity: confidenceResult.signalDensity,
      noiseRatio: confidenceResult.noiseRatio,
      gapCoverage: confidenceResult.gapCoverage,
      recoveryFailurePenalty: confidenceResult.recoveryFailurePenalty,
      verbosityPenalty: confidenceResult.verbosityPenalty,
      qualityFactor: confidenceResult.qualityFactor,
    },
    gapBreakdown: {
      totalPenalty: gapResult.totalPenalty,
      stageMultiplier: gapResult.stageMultiplier,
      byGap: gapResult.byGap,
      openGapCount: gapResult.openGapCount,
    },
  };
}

export function prepareCleanContext(input: ScoringInput): CleanContext {
  const uniqueNoise = [...new Set(input.noiseTags)];
  const noiseTagSet = new Set(uniqueNoise);
  const filteredRewards = input.rewardTrace.filter((reward) => {
    const tags = reward.noiseTags ?? [];
    return !tags.some((tag) => noiseTagSet.has(tag));
  });

  return {
    ...input,
    noiseTags: uniqueNoise,
    rewardTrace: filteredRewards,
    signals: [...input.signals].sort((left, right) => left.key.localeCompare(right.key)),
    pivots: [...input.pivots].sort((left, right) => (left.turnId ?? "").localeCompare(right.turnId ?? "")),
    decisionTrace: [...input.decisionTrace],
  };
}

export function aggregateDimensions(context: CleanContext): DimensionScores {
  const base: DimensionScores = {
    requirement_clarity: 0.5,
    capacity_instinct: 0.5,
    tradeoff_depth: 0.5,
    reliability_awareness: 0.5,
    bottleneck_sensitivity: 0.5,
  };

  const byKey = new Map<DesignSignalKey, boolean | null>();
  for (const signal of context.signals) {
    byKey.set(signal.key, signal.missing);
  }

  for (const [signalKey, dimensionKey] of Object.entries(SIGNAL_TO_DIMENSION) as Array<
    [DesignSignalKey, keyof DimensionScores]
  >) {
    const missing = byKey.get(signalKey) ?? null;
    if (missing === false) {
      base[dimensionKey] = 4.5;
    } else if (missing === true) {
      base[dimensionKey] = 2;
    }
  }

  // If there are no explicit signals at all, keep neutral-low baseline to avoid false positives.
  if (context.signals.length === 0) {
    return {
      requirement_clarity: 0,
      capacity_instinct: 0,
      tradeoff_depth: 0,
      reliability_awareness: 0,
      bottleneck_sensitivity: 0,
    };
  }

  return base;
}

export function applyHardCaps(rawLevel: UnifiedLevel, dimensionScores: DimensionScores): {
  level: UnifiedLevel;
  appliedCaps: string[];
  reasons: string[];
} {
  const candidates: HardCap[] = [
    capByCapacityInstinct(dimensionScores),
    capByTradeoffDepth(dimensionScores),
    capByBottleneckSensitivity(dimensionScores),
  ].filter((item): item is HardCap => item !== null);

  if (candidates.length === 0) {
    return {
      level: rawLevel,
      appliedCaps: [],
      reasons: [],
    };
  }

  let level = rawLevel;
  for (const cap of candidates) {
    level = minLevel(level, cap.capLevel);
  }

  return {
    level,
    appliedCaps: candidates.map((cap) => cap.key),
    reasons: candidates.map((cap) => cap.reason),
  };
}

function mapScoreToLevel(score: number): UnifiedLevel {
  if (score >= 4.4) {
    return "L6";
  }
  if (score >= 3.6) {
    return "L5";
  }
  if (score >= 2.8) {
    return "L4";
  }
  return "L3";
}

function levelToVerdict(level: UnifiedLevel): UnifiedVerdict {
  switch (level) {
    case "L6":
      return "STRONG_HIRE";
    case "L5":
      return "HIRE";
    case "L4":
      return "BORDERLINE";
    default:
      return "NO_HIRE";
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
