import type { NoiseTag } from "@/lib/assistant/pivot";
import type { SystemDesignGapState } from "@/lib/assistant/system_design_gap";

export type UnifiedLevel = "L3" | "L4" | "L5" | "L6";

export type UnifiedVerdict = "NO_HIRE" | "BORDERLINE" | "HIRE" | "STRONG_HIRE";

export type DesignSignalKey =
  | "requirement_missing"
  | "capacity_missing"
  | "tradeoff_missed"
  | "spof_missed"
  | "bottleneck_unexamined";

export type Signal = {
  key: DesignSignalKey;
  missing: boolean | null;
  evidence?: string[];
};

export type PivotMomentInput = {
  turnId?: string | null;
  triggerAction?: "NONE" | "LIGHT" | "HEAVY" | null;
  impactScore: number;
};

export type DecisionResult = {
  turnId?: string | null;
  action?: string | null;
  systemDesignActionType?: string | null;
  rescueMode?: "none" | "light_rescue" | "heavy_rescue" | null;
};

export type RewardTrace = {
  turnId?: string | null;
  total?: number | null;
  noiseTags?: NoiseTag[];
};

export type SessionMetadata = {
  stage?: string | null;
  targetLevel?: string | null;
};

export interface ScoringInput {
  signals: Signal[];
  gapState: SystemDesignGapState;
  pivots: PivotMomentInput[];
  noiseTags: NoiseTag[];
  metadata: SessionMetadata;
  decisionTrace: DecisionResult[];
  rewardTrace: RewardTrace[];
}

export interface EvaluationResult {
  rawLevel: UnifiedLevel;
  cappedLevel: UnifiedLevel;
  verdict: UnifiedVerdict;
  confidence: number;
  dimensionScores: Record<string, number>;
  appliedCaps: string[];
  explanation: string[];
  pivotSummary?: {
    adjustment: number;
    detectedCount: number;
    nudgeConversionRate: number;
    timeToInsight: number | null;
    hintsBeforeInsight: number;
  };
  confidenceBreakdown?: {
    signalDensity: number;
    noiseRatio: number;
    gapCoverage: number;
    recoveryFailurePenalty: number;
    verbosityPenalty: number;
    qualityFactor: number;
  };
  gapBreakdown?: {
    totalPenalty: number;
    stageMultiplier: number;
    byGap: Record<"capacity" | "tradeoff" | "reliability" | "bottleneck", number>;
    openGapCount: number;
  };
}
