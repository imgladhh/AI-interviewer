import type { HandwaveCategory } from "@/lib/assistant/depth";
import type { SystemDesignPolicyAction } from "@/lib/assistant/policy";

export type SystemDesignGapState = {
  missing_capacity: boolean;
  missing_tradeoff: boolean;
  missing_reliability: boolean;
  missing_bottleneck: boolean;
};

export type SystemDesignGapKind = "capacity" | "tradeoff" | "reliability" | "bottleneck";

export function deriveSystemDesignGapState(input: {
  signals: {
    capacity_missing: boolean;
    tradeoff_missed: boolean;
    spof_missed: boolean;
    bottleneck_unexamined: boolean;
  };
  handwaveCategories?: HandwaveCategory[];
  snapshotGapState?: Partial<SystemDesignGapState> | null;
}): SystemDesignGapState {
  if (input.snapshotGapState) {
    return {
      missing_capacity: Boolean(input.snapshotGapState.missing_capacity),
      missing_tradeoff: Boolean(input.snapshotGapState.missing_tradeoff),
      missing_reliability: Boolean(input.snapshotGapState.missing_reliability),
      missing_bottleneck: Boolean(input.snapshotGapState.missing_bottleneck),
    };
  }

  const categories = input.handwaveCategories ?? [];
  return {
    missing_capacity:
      input.signals.capacity_missing ||
      categories.includes("unquantified_scaling_claim"),
    missing_tradeoff:
      input.signals.tradeoff_missed ||
      categories.includes("tradeoff_evasion") ||
      categories.includes("unjustified_component_choice"),
    missing_reliability: input.signals.spof_missed,
    missing_bottleneck: input.signals.bottleneck_unexamined,
  };
}

export function pickPrimarySystemDesignGap(
  gapState: SystemDesignGapState,
): SystemDesignGapKind | null {
  if (gapState.missing_capacity) {
    return "capacity";
  }
  if (gapState.missing_reliability) {
    return "reliability";
  }
  if (gapState.missing_tradeoff) {
    return "tradeoff";
  }
  if (gapState.missing_bottleneck) {
    return "bottleneck";
  }
  return null;
}

export function countOpenSystemDesignGaps(gapState: SystemDesignGapState) {
  return [
    gapState.missing_capacity,
    gapState.missing_tradeoff,
    gapState.missing_reliability,
    gapState.missing_bottleneck,
  ].filter(Boolean).length;
}

export function routeSystemDesignActionByGap(
  gapState: SystemDesignGapState,
): SystemDesignPolicyAction | null {
  const primaryGap = pickPrimarySystemDesignGap(gapState);
  switch (primaryGap) {
    case "capacity":
      return "ASK_CAPACITY";
    case "reliability":
      return "CHALLENGE_SPOF";
    case "tradeoff":
      return "PROBE_TRADEOFF";
    case "bottleneck":
      return "ZOOM_IN";
    default:
      return null;
  }
}
