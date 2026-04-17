import type { ScoringInput } from "@/lib/scoring/types";

type GapKey = "capacity" | "tradeoff" | "reliability" | "bottleneck";

const BASE_SEVERITY: Record<GapKey, number> = {
  // Capacity is a hard precondition for deep design reasoning.
  capacity: 0.38,
  tradeoff: 0.3,
  reliability: 0.34,
  bottleneck: 0.28,
};

const STAGE_MULTIPLIER: Array<{ pattern: RegExp; multiplier: number }> = [
  { pattern: /REQUIREMENTS|API_CONTRACT_CHECK/i, multiplier: 0.7 },
  { pattern: /CAPACITY/i, multiplier: 0.9 },
  { pattern: /HIGH_LEVEL/i, multiplier: 1.0 },
  { pattern: /DEEP_DIVE/i, multiplier: 1.25 },
  { pattern: /REFINEMENT/i, multiplier: 1.35 },
  { pattern: /WRAP_UP/i, multiplier: 1.5 },
];

export function calculateGapPenalty(input: {
  gapState: ScoringInput["gapState"];
  stage?: string | null;
}) {
  const stage = input.stage ?? "";
  const stageMultiplier = resolveStageMultiplier(stage);
  const byGap: Record<GapKey, number> = {
    capacity: input.gapState.missing_capacity ? BASE_SEVERITY.capacity * stageMultiplier : 0,
    tradeoff: input.gapState.missing_tradeoff ? BASE_SEVERITY.tradeoff * stageMultiplier : 0,
    reliability: input.gapState.missing_reliability ? BASE_SEVERITY.reliability * stageMultiplier : 0,
    bottleneck: input.gapState.missing_bottleneck ? BASE_SEVERITY.bottleneck * stageMultiplier : 0,
  };

  const totalPenalty = clamp(
    Number((byGap.capacity + byGap.tradeoff + byGap.reliability + byGap.bottleneck).toFixed(2)),
    0,
    2.4,
  );
  const openGapCount = [
    input.gapState.missing_capacity,
    input.gapState.missing_tradeoff,
    input.gapState.missing_reliability,
    input.gapState.missing_bottleneck,
  ].filter(Boolean).length;

  return {
    totalPenalty,
    stageMultiplier,
    byGap: {
      capacity: Number(byGap.capacity.toFixed(2)),
      tradeoff: Number(byGap.tradeoff.toFixed(2)),
      reliability: Number(byGap.reliability.toFixed(2)),
      bottleneck: Number(byGap.bottleneck.toFixed(2)),
    },
    openGapCount,
  };
}

function resolveStageMultiplier(stage: string) {
  for (const item of STAGE_MULTIPLIER) {
    if (item.pattern.test(stage)) {
      return item.multiplier;
    }
  }
  return 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
