import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { PolicyConfig } from "@/lib/assistant/policy-config";

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
};

type MemoryLedgerLike = {
  recentHints: number;
  recentFailedRuns: number;
  repeatedFailurePattern?: string | null;
  unresolvedIssues: string[];
  answeredTargets: string[];
  collectedEvidence: string[];
};

export type CandidateDnaVector = {
  reasoning: number;
  implementation: number;
  coachability: number;
  independence: number;
};

export type CandidateDnaProfile = {
  vector: CandidateDnaVector;
  dominantTraits: string[];
  recommendedMode: "guided" | "balanced" | "challenging";
  rationale: string[];
};

export type CandidateDnaPolicyAdaptation = {
  policyConfig: PolicyConfig;
  policyMode: CandidateDnaProfile["recommendedMode"] | "persona_default";
  reason: string;
};

export function assessCandidateDna(input: {
  signals: CandidateSignalSnapshot;
  memory: MemoryLedgerLike;
  latestExecutionRun?: ExecutionRunLike | null;
}): CandidateDnaProfile {
  const { signals, memory, latestExecutionRun } = input;

  const reasoning =
    clamp01(
      scoreFromBand(signals.reasoningDepth, {
        deep: 0.92,
        moderate: 0.68,
        thin: 0.34,
        missing: 0.18,
      }) +
        scoreFromBand(signals.complexityRigor, {
          strong: 0.08,
          partial: 0.03,
          missing: 0,
        }),
    );

  const implementation =
    clamp01(
      scoreFromBand(signals.codeQuality, {
        correct: 0.9,
        partial: 0.62,
        buggy: 0.28,
        missing: 0.12,
      }) +
        (latestExecutionRun?.status === "PASSED"
          ? 0.08
          : latestExecutionRun?.status === "FAILED" || latestExecutionRun?.status === "ERROR" || latestExecutionRun?.status === "TIMEOUT"
            ? -0.05
            : 0),
    );

  const coachability = clamp01(
    0.72 -
      memory.recentHints * 0.08 -
      Math.min(memory.recentFailedRuns, 3) * 0.04 +
      (signals.progress === "progressing" ? 0.08 : signals.progress === "stuck" ? -0.08 : 0),
  );

  const independence = clamp01(
    0.78 -
      memory.recentHints * 0.12 -
      Math.min(memory.recentFailedRuns, 3) * 0.05 -
      (memory.repeatedFailurePattern ? 0.04 : 0) -
      Math.min(memory.unresolvedIssues.length, 3) * 0.03 +
      (signals.readyToCode ? 0.05 : 0) +
      (memory.collectedEvidence.includes("implementation_plan") ? 0.04 : 0) +
      (memory.answeredTargets.includes("complexity") ? 0.03 : 0),
  );

  const vector = {
    reasoning,
    implementation,
    coachability,
    independence,
  };

  const dominantTraits = summarizeTraits(vector);
  const recommendedMode =
    independence < 0.4 ? "guided" : reasoning >= 0.78 && implementation >= 0.7 ? "challenging" : "balanced";
  const rationale = buildRationale(vector, signals, memory);

  return {
    vector,
    dominantTraits,
    recommendedMode,
    rationale,
  };
}

function scoreFromBand(
  value: string | undefined,
  mapping: Record<string, number>,
) {
  return value && value in mapping ? mapping[value] : 0.45;
}

function summarizeTraits(vector: CandidateDnaVector) {
  const traits: string[] = [];

  if (vector.reasoning >= 0.8) {
    traits.push("reasoning-heavy");
  }
  if (vector.implementation >= 0.78) {
    traits.push("strong-executor");
  }
  if (vector.coachability >= 0.72) {
    traits.push("coachable");
  }
  if (vector.independence >= 0.72) {
    traits.push("independent");
  }
  if (vector.independence < 0.4) {
    traits.push("needs-guidance");
  }
  if (traits.length === 0) {
    traits.push("balanced");
  }
  return traits;
}

function buildRationale(
  vector: CandidateDnaVector,
  signals: CandidateSignalSnapshot,
  memory: MemoryLedgerLike,
) {
  const notes: string[] = [];

  notes.push(
    `Reasoning=${vector.reasoning.toFixed(2)}, implementation=${vector.implementation.toFixed(2)}, coachability=${vector.coachability.toFixed(2)}, independence=${vector.independence.toFixed(2)}.`,
  );

  if (signals.reasoningDepth === "deep") {
    notes.push("Deep reasoning signal increased the reasoning axis.");
  }
  if (signals.codeQuality === "correct") {
    notes.push("Correct implementation signal increased the execution axis.");
  }
  if (memory.recentHints > 0) {
    notes.push("Recent hint usage reduced the independence and coachability axes.");
  }
  if (memory.recentFailedRuns > 0) {
    notes.push("Recent failed runs slightly reduced execution confidence.");
  }

  return notes;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function adaptPolicyToCandidateDna(
  policyConfig: PolicyConfig,
  profile: CandidateDnaProfile,
): CandidateDnaPolicyAdaptation {
  if (profile.recommendedMode === "balanced") {
    return {
      policyConfig,
      policyMode: "persona_default",
      reason: "Candidate DNA stayed balanced, so the persona-selected policy remains unchanged.",
    };
  }

  if (profile.recommendedMode === "guided") {
    return {
      policyMode: "guided",
      reason:
        "Low independence signal shifted the live policy toward guided interviewing with softer pressure and earlier rescue.",
      policyConfig: {
        ...policyConfig,
        intentBias: {
          ...policyConfig.intentBias,
          guide: clamp01(policyConfig.intentBias.guide + 0.2),
          unblock: clamp01(policyConfig.intentBias.unblock + 0.18),
          probe: clamp01(policyConfig.intentBias.probe - 0.15),
          pressure: clamp01(policyConfig.intentBias.pressure - 0.2),
        },
        pacing: {
          ...policyConfig.pacing,
          preferLetRun: clamp01(policyConfig.pacing.preferLetRun + 0.08),
          moveToImplementationBias: clamp01(policyConfig.pacing.moveToImplementationBias - 0.08),
          closeTopicAggression: clamp01(policyConfig.pacing.closeTopicAggression - 0.1),
        },
        hints: {
          ...policyConfig.hints,
          delayFactor: Math.max(0.5, policyConfig.hints.delayFactor - 0.2),
          maxHintLevel: Math.min(3, policyConfig.hints.maxHintLevel + 1),
          rescueModeBias: clamp01(policyConfig.hints.rescueModeBias + 0.2),
        },
        scoreWeights: {
          ...policyConfig.scoreWeights,
          need: clampWeight(policyConfig.scoreWeights.need - 0.08),
          timing: clampWeight(policyConfig.scoreWeights.timing + 0.1),
          value: clampWeight(policyConfig.scoreWeights.value - 0.08),
          closure: clampWeight(policyConfig.scoreWeights.closure + 0.02),
          proposalBias: clampWeight(policyConfig.scoreWeights.proposalBias + 0.08),
          temporalProbeDecay: clampWeight(policyConfig.scoreWeights.temporalProbeDecay + 0.1),
          temporalIdleProbeBoost: clampWeight(policyConfig.scoreWeights.temporalIdleProbeBoost - 0.08),
          temporalCodingInterruptionPenalty: clampWeight(
            policyConfig.scoreWeights.temporalCodingInterruptionPenalty + 0.12,
          ),
          actionBias: {
            ...policyConfig.scoreWeights.actionBias,
            Probe: clampActionBias(policyConfig.scoreWeights.actionBias.Probe - 0.08),
            Guide: clampActionBias(policyConfig.scoreWeights.actionBias.Guide + 0.08),
            Unblock: clampActionBias(policyConfig.scoreWeights.actionBias.Unblock + 0.06),
            Hold: clampActionBias(policyConfig.scoreWeights.actionBias.Hold + 0.05),
          },
        },
      },
    };
  }

  return {
    policyMode: "challenging",
    reason:
      "High reasoning and independence signals shifted the live policy toward a more challenging path with later rescue and tighter probing.",
    policyConfig: {
      ...policyConfig,
      intentBias: {
        ...policyConfig.intentBias,
        validate: clamp01(policyConfig.intentBias.validate + 0.08),
        probe: clamp01(policyConfig.intentBias.probe + 0.15),
        pressure: clamp01(policyConfig.intentBias.pressure + 0.18),
        guide: clamp01(policyConfig.intentBias.guide - 0.12),
        unblock: clamp01(policyConfig.intentBias.unblock - 0.1),
      },
      pacing: {
        ...policyConfig.pacing,
        preferLetRun: clamp01(policyConfig.pacing.preferLetRun - 0.06),
        moveToImplementationBias: clamp01(policyConfig.pacing.moveToImplementationBias + 0.08),
        closeTopicAggression: clamp01(policyConfig.pacing.closeTopicAggression + 0.06),
      },
      hints: {
        ...policyConfig.hints,
        delayFactor: Math.min(1.6, policyConfig.hints.delayFactor + 0.15),
        maxHintLevel: Math.max(1, policyConfig.hints.maxHintLevel - 1),
        rescueModeBias: clamp01(policyConfig.hints.rescueModeBias - 0.18),
      },
      scoreWeights: {
        ...policyConfig.scoreWeights,
        need: clampWeight(policyConfig.scoreWeights.need + 0.08),
        timing: clampWeight(policyConfig.scoreWeights.timing - 0.08),
        value: clampWeight(policyConfig.scoreWeights.value + 0.12),
        closure: clampWeight(policyConfig.scoreWeights.closure + 0.05),
        proposalBias: clampWeight(policyConfig.scoreWeights.proposalBias - 0.06),
        temporalProbeDecay: clampWeight(policyConfig.scoreWeights.temporalProbeDecay - 0.08),
        temporalIdleProbeBoost: clampWeight(policyConfig.scoreWeights.temporalIdleProbeBoost + 0.08),
        temporalCodingInterruptionPenalty: clampWeight(
          policyConfig.scoreWeights.temporalCodingInterruptionPenalty - 0.1,
        ),
        actionBias: {
          ...policyConfig.scoreWeights.actionBias,
          Probe: clampActionBias(policyConfig.scoreWeights.actionBias.Probe + 0.08),
          Advance: clampActionBias(policyConfig.scoreWeights.actionBias.Advance + 0.04),
          Hold: clampActionBias(policyConfig.scoreWeights.actionBias.Hold - 0.06),
        },
      },
    },
  };
}

function clampWeight(value: number) {
  return Math.max(0.65, Math.min(1.35, value));
}

function clampActionBias(value: number) {
  return Math.max(-0.25, Math.min(0.25, value));
}
