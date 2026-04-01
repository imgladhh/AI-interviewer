import type { CodingInterviewHintLevel, CodingInterviewHintStyle } from "@/lib/assistant/policy";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

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
  byGranularity: Record<HintGranularity, number>;
  byRescueMode: Record<RescueMode, number>;
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
  const levelWeight =
    input.hintLevel === "STRONG" ? 3 : input.hintLevel === "MEDIUM" ? 2 : 1;
  const styleWeight =
    input.hintStyle === "IMPLEMENTATION_NUDGE" || input.hintStyle === "DEBUGGING_NUDGE"
      ? 1.35
      : input.hintStyle === "APPROACH_NUDGE" || input.hintStyle === "TESTING_NUDGE"
        ? 1.15
        : 1;

  return Number((levelWeight * styleWeight).toFixed(2));
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
      const rescueMode =
        typeof payload.rescueMode === "string"
          ? (payload.rescueMode as RescueMode)
          : "none";
      const cost =
        typeof payload.hintCost === "number"
          ? payload.hintCost
          : estimateHintCost({ hintStyle, hintLevel });

      return {
        hintLevel: hintLevel ?? null,
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

  let strongestHintLevel: CodingInterviewHintLevel | null = null;
  let totalHintCost = 0;

  for (const hint of servedHints) {
    byGranularity[hint.granularity] += 1;
    byRescueMode[hint.rescueMode] += 1;
    totalHintCost += hint.cost;
    strongestHintLevel = strongerHintLevel(strongestHintLevel, hint.hintLevel);
  }

  const totalHints = servedHints.length;

  return {
    totalHints,
    totalHintCost: Number(totalHintCost.toFixed(2)),
    averageHintCost: totalHints > 0 ? Number((totalHintCost / totalHints).toFixed(2)) : 0,
    strongestHintLevel,
    byGranularity,
    byRescueMode,
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
