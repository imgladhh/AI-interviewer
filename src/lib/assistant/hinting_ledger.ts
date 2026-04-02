import type { CodingInterviewHintLevel, CodingInterviewHintStyle } from "@/lib/assistant/policy";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";
import { estimateNonLinearHintCost, resolveHintTier, type HintTier } from "@/lib/assistant/hint_strategy";

type SessionEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

export type HintGranularity = "conceptual" | "directional" | "implementation" | "near_solution";
export type RescueMode = "none" | "conceptual_rescue" | "implementation_rescue" | "debug_rescue";

export type HintLedger = {
  totalHints: number;
  totalHintCost: number;
  averageHintCost: number;
  strongestHintLevel: CodingInterviewHintLevel | null;
  strongestHintTier: HintTier | null;
  byGranularity: Record<HintGranularity, number>;
  byRescueMode: Record<RescueMode, number>;
  byTier: Record<HintTier, number>;
};

export function classifyHintGranularity(
  hintStyle?: CodingInterviewHintStyle,
  hintLevel?: CodingInterviewHintLevel,
): HintGranularity {
  if (hintLevel === "STRONG" && hintStyle === "DEBUGGING_NUDGE") {
    return "near_solution";
  }

  switch (hintStyle) {
    case "CLARIFYING_NUDGE":
      return "conceptual";
    case "APPROACH_NUDGE":
      return hintLevel === "STRONG" ? "directional" : "conceptual";
    case "IMPLEMENTATION_NUDGE":
    case "DEBUGGING_NUDGE":
      return hintLevel === "STRONG" ? "near_solution" : "implementation";
    case "TESTING_NUDGE":
      return "directional";
    default:
      return "directional";
  }
}

export function estimateHintCost(input: {
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
}) {
  const granularity = classifyHintGranularity(input.hintStyle, input.hintLevel);
  const tier = resolveHintTier({
    hintStyle: input.hintStyle,
    hintLevel: input.hintLevel,
    granularity,
  });
  return estimateNonLinearHintCost({
    tier,
    rescueMode: "none",
  });
}

export function resolveRescueMode(input: {
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  recentFailedRuns?: number;
  hintStyle?: CodingInterviewHintStyle;
}): RescueMode {
  if (input.currentStage === "DEBUGGING" || (input.recentFailedRuns ?? 0) >= 2 || input.hintStyle === "DEBUGGING_NUDGE") {
    return "debug_rescue";
  }

  if (
    input.currentStage === "IMPLEMENTATION" ||
    input.hintStyle === "IMPLEMENTATION_NUDGE" ||
    input.signals.progress === "stuck"
  ) {
    return "implementation_rescue";
  }

  if (input.hintStyle === "CLARIFYING_NUDGE" || input.hintStyle === "APPROACH_NUDGE") {
    return "conceptual_rescue";
  }

  return "none";
}

export function buildHintingLedger(events: SessionEventLike[]) {
  const servedHints = events
    .filter((event) => event.eventType === "HINT_SERVED")
    .map((event) => {
      const payload =
        typeof event.payloadJson === "object" && event.payloadJson !== null
          ? (event.payloadJson as Record<string, unknown>)
          : {};
      const hintStyle = typeof payload.hintStyle === "string" ? (payload.hintStyle as CodingInterviewHintStyle) : undefined;
      const hintLevel = typeof payload.hintLevel === "string" ? (payload.hintLevel as CodingInterviewHintLevel) : undefined;
      const granularity =
        typeof payload.hintGranularity === "string"
          ? (payload.hintGranularity as HintGranularity)
          : classifyHintGranularity(hintStyle, hintLevel);
      const tier =
        typeof payload.hintTier === "string"
          ? (payload.hintTier as HintTier)
          : resolveHintTier({
              hintStyle,
              hintLevel,
              granularity,
            });
      const rescueMode =
        typeof payload.rescueMode === "string"
          ? (payload.rescueMode as RescueMode)
          : "none";
      const cost =
        typeof payload.hintCost === "number"
          ? payload.hintCost
          : estimateNonLinearHintCost({ tier, rescueMode });

      return {
        hintLevel: hintLevel ?? null,
        tier,
        granularity,
        rescueMode,
        cost,
      };
    });

  const byGranularity: Record<HintGranularity, number> = {
    conceptual: 0,
    directional: 0,
    implementation: 0,
    near_solution: 0,
  };
  const byRescueMode: Record<RescueMode, number> = {
    none: 0,
    conceptual_rescue: 0,
    implementation_rescue: 0,
    debug_rescue: 0,
  };
  const byTier: Record<HintTier, number> = {
    L0_NUDGE: 0,
    L1_AREA: 0,
    L2_SPECIFIC: 0,
    L3_SOLUTION: 0,
  };

  let strongestHintLevel: CodingInterviewHintLevel | null = null;
  let strongestHintTier: HintTier | null = null;
  let totalHintCost = 0;

  for (const hint of servedHints) {
    byGranularity[hint.granularity] += 1;
    byRescueMode[hint.rescueMode] += 1;
    byTier[hint.tier] += 1;
    totalHintCost += hint.cost;
    strongestHintLevel = strongerHintLevel(strongestHintLevel, hint.hintLevel);
    strongestHintTier = strongerHintTier(strongestHintTier, hint.tier);
  }

  const totalHints = servedHints.length;

  return {
    totalHints,
    totalHintCost: Number(totalHintCost.toFixed(2)),
    averageHintCost: totalHints > 0 ? Number((totalHintCost / totalHints).toFixed(2)) : 0,
    strongestHintLevel,
    strongestHintTier,
    byGranularity,
    byRescueMode,
    byTier,
  } satisfies HintLedger;
}

function strongerHintLevel(
  current: CodingInterviewHintLevel | null,
  candidate: CodingInterviewHintLevel | null,
): CodingInterviewHintLevel | null {
  const score = {
    LIGHT: 1,
    MEDIUM: 2,
    STRONG: 3,
  } as const;

  if (!candidate) {
    return current;
  }

  if (!current || score[candidate] > score[current]) {
    return candidate;
  }

  return current;
}

function strongerHintTier(current: HintTier | null, candidate: HintTier | null) {
  const score = {
    L0_NUDGE: 1,
    L1_AREA: 2,
    L2_SPECIFIC: 3,
    L3_SOLUTION: 4,
  } as const;

  if (!candidate) {
    return current;
  }

  if (!current || score[candidate] > score[current]) {
    return candidate;
  }

  return current;
}
