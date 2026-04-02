import type { CodingInterviewHintLevel, CodingInterviewHintStyle } from "@/lib/assistant/policy";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";
import {
  classifyHintGranularity,
  resolveRescueMode,
  type HintGranularity,
  type RescueMode,
} from "@/lib/assistant/hinting_ledger";

export type HintTier = "L0_NUDGE" | "L1_AREA" | "L2_SPECIFIC" | "L3_SOLUTION";

export type HintStrategy = {
  tier: HintTier;
  granularity: HintGranularity;
  rescueMode: RescueMode;
  hintCost: number;
};

export function resolveHintStrategy(input: {
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  recentFailedRuns?: number;
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
}) {
  const granularity = classifyHintGranularity(input.hintStyle, input.hintLevel);
  const rescueMode = resolveRescueMode({
    currentStage: input.currentStage,
    signals: input.signals,
    recentFailedRuns: input.recentFailedRuns,
    hintStyle: input.hintStyle,
  });

  const tier = resolveHintTier({
    hintStyle: input.hintStyle,
    hintLevel: input.hintLevel,
    granularity,
  });

  return {
    tier,
    granularity,
    rescueMode,
    hintCost: estimateNonLinearHintCost({ tier, rescueMode }),
  } satisfies HintStrategy;
}

export function resolveHintTier(input: {
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
  granularity: HintGranularity;
}): HintTier {
  if (input.hintLevel === "LIGHT" && input.granularity === "conceptual") {
    return "L0_NUDGE";
  }
  if (input.granularity === "directional" || input.hintStyle === "TESTING_NUDGE") {
    return "L1_AREA";
  }
  if (input.granularity === "implementation") {
    return "L2_SPECIFIC";
  }
  return "L3_SOLUTION";
}

export function estimateNonLinearHintCost(input: {
  tier: HintTier;
  rescueMode: RescueMode;
}) {
  const base =
    input.tier === "L0_NUDGE"
      ? 0.4
      : input.tier === "L1_AREA"
        ? 1.15
        : input.tier === "L2_SPECIFIC"
          ? 2.8
          : 5.6;
  const rescueMultiplier =
    input.rescueMode === "debug_rescue"
      ? 1.35
      : input.rescueMode === "implementation_rescue"
        ? 1.2
        : input.rescueMode === "conceptual_rescue"
          ? 1.05
          : 1;
  return Number((base * rescueMultiplier).toFixed(2));
}
