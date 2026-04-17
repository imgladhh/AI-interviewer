import type { UnifiedLevel } from "@/lib/scoring/types";

export type HardCap = {
  capLevel: UnifiedLevel;
  reason: string;
  key: "capacity_instinct" | "tradeoff_depth" | "bottleneck_sensitivity";
};

const LEVEL_ORDER: UnifiedLevel[] = ["L3", "L4", "L5", "L6"];

export function capByCapacityInstinct(dimensionScores: Record<string, number>): HardCap | null {
  const value = dimensionScores.capacity_instinct;
  if (typeof value !== "number") {
    return null;
  }
  if (value < 3.2) {
    return {
      capLevel: "L4",
      key: "capacity_instinct",
      reason: "Capacity instinct is below invariant threshold; cap at L4.",
    };
  }
  return null;
}

export function capByTradeoffDepth(dimensionScores: Record<string, number>): HardCap | null {
  const value = dimensionScores.tradeoff_depth;
  if (typeof value !== "number") {
    return null;
  }
  if (value < 3.6) {
    return {
      capLevel: "L5",
      key: "tradeoff_depth",
      reason: "Tradeoff depth is below invariant threshold; cap at L5.",
    };
  }
  return null;
}

export function capByBottleneckSensitivity(dimensionScores: Record<string, number>): HardCap | null {
  const value = dimensionScores.bottleneck_sensitivity;
  if (typeof value !== "number") {
    return null;
  }
  if (value < 3.2) {
    return {
      capLevel: "L4",
      key: "bottleneck_sensitivity",
      reason: "Bottleneck sensitivity is below invariant threshold; cap at L4.",
    };
  }
  return null;
}

export function minLevel(left: UnifiedLevel, right: UnifiedLevel): UnifiedLevel {
  const leftIndex = LEVEL_ORDER.indexOf(left);
  const rightIndex = LEVEL_ORDER.indexOf(right);
  return leftIndex <= rightIndex ? left : right;
}
