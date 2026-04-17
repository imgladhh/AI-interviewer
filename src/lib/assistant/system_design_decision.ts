import type { CandidateDecision } from "@/lib/assistant/decision_engine";
import type { CodingInterviewPolicyAction, SystemDesignPolicyAction } from "@/lib/assistant/policy";
import type { CandidateSignalSnapshot, GapState } from "@/lib/assistant/signal_extractor";
import {
  countOpenSystemDesignGaps,
  deriveSystemDesignGapState,
  pickPrimarySystemDesignGap,
  routeSystemDesignActionByGap,
} from "@/lib/assistant/system_design_gap";
import type { SystemDesignStage } from "@/lib/assistant/stages";

export type SystemDesignTargetLevel = "NEW_GRAD" | "SDE1" | "SDE2" | "SENIOR" | "STAFF";

export type SystemDesignDecision = CandidateDecision & {
  systemDesignActionType: SystemDesignPolicyAction;
};

const STABILITY_LAMBDA = 0.2;
const HYSTERESIS_DELTA = 0.2;

export function makeSystemDesignDecision(input: {
  currentStage: SystemDesignStage;
  signals: CandidateSignalSnapshot;
  targetLevel?: string | null;
  previousActionType?: SystemDesignPolicyAction | null;
  recentTranscripts?: Array<{ speaker: "USER" | "AI" | "SYSTEM"; text: string }>;
  recentEvents?: Array<{ eventType: string; payloadJson?: unknown }>;
}): SystemDesignDecision {
  const designSignals = input.signals.designSignals?.signals ?? {
    requirement_missing: true,
    capacity_missing: true,
    tradeoff_missed: true,
    spof_missed: true,
    bottleneck_unexamined: true,
  };
  const handwaveSignal = input.signals.designSignals?.handwave;
  const gapState = deriveSystemDesignGapState({
    signals: {
      capacity_missing: designSignals.capacity_missing,
      tradeoff_missed: designSignals.tradeoff_missed,
      spof_missed: designSignals.spof_missed,
      bottleneck_unexamined: designSignals.bottleneck_unexamined,
    },
    handwaveCategories: handwaveSignal?.categories,
    snapshotGapState: input.signals.designSignals?.gapState,
  });
  const targetLevel = normalizeSystemDesignTargetLevel(input.targetLevel);

  const baseScores = [
    score("ASK_REQUIREMENT", input.currentStage, designSignals, targetLevel, handwaveSignal, gapState),
    score("ASK_CAPACITY", input.currentStage, designSignals, targetLevel, handwaveSignal, gapState),
    score("PROBE_TRADEOFF", input.currentStage, designSignals, targetLevel, handwaveSignal, gapState),
    score("CHALLENGE_SPOF", input.currentStage, designSignals, targetLevel, handwaveSignal, gapState),
    score("ZOOM_IN", input.currentStage, designSignals, targetLevel, handwaveSignal, gapState),
    score("WRAP_UP", input.currentStage, designSignals, targetLevel, handwaveSignal, gapState),
  ];
  const grillingState = assessSystemDesignGrillingState({
    targetLevel,
    currentStage: input.currentStage,
    signals: input.signals,
    gapState,
  });
  const scoresWithGrilling = applyGrillingPressure(baseScores, grillingState);

  const chainContext = assessProblemChainContinuity({
    currentGapState: gapState,
    previousActionType: input.previousActionType ?? null,
  });
  const scoresWithInertia = applyInertia(
    scoresWithGrilling,
    chainContext.sameChain ? input.previousActionType ?? null : null,
  );
  const sortedScores = [...scoresWithInertia].sort((left, right) => right.totalScore - left.totalScore);
  const selected = applyHysteresis(
    sortedScores,
    chainContext.sameChain ? input.previousActionType ?? null : null,
  );
  const assumptionEscapeHatch = hasExplicitScopedAssumption(input.recentTranscripts, input.recentEvents);
  const capacityGateStage = ["DEEP_DIVE", "REFINEMENT", "WRAP_UP"].includes(input.currentStage);
  const routedAction = routeSystemDesignActionByGap(gapState);
  const primaryGap = pickPrimarySystemDesignGap(gapState);
  const openGapCount = countOpenSystemDesignGaps(gapState);
  const safetyOverride = detectSafetyOverride({
    recentEvents: input.recentEvents,
    fallbackAction: routedAction ?? selected.actionType,
  });
  const decisionContext = {
    gapState,
    routedAction,
    primaryGap,
    openGapCount,
  };

  if (safetyOverride) {
    const safetyCandidate = sortedScores.find((item) => item.actionType === safetyOverride.actionType) ?? selected;
    return toDecision(safetyOverride.actionType, sortedScores, [
      ...safetyCandidate.reasons,
      {
        key: safetyOverride.key,
        magnitude: 1,
        kind: "signal",
        detail: safetyOverride.detail,
      },
    ], decisionContext);
  }

  if (capacityGateStage && designSignals.capacity_missing && !assumptionEscapeHatch) {
    const askCapacity = sortedScores.find((item) => item.actionType === "ASK_CAPACITY") ?? selected;
    return toDecision("ASK_CAPACITY", sortedScores, [
      ...askCapacity.reasons,
      {
        key: "causal_capacity_override",
        magnitude: 1,
        kind: "signal",
        detail: "Capacity is missing before deep-dive/refinement/wrap-up, so ASK_CAPACITY is forced by causal loop policy.",
      },
    ], decisionContext);
  }

  if (
    routedAction &&
    (handwaveSignal?.forceDeeperAction ||
      (selected.actionType === "WRAP_UP" &&
        (gapState.missing_tradeoff || gapState.missing_reliability || gapState.missing_bottleneck)))
  ) {
    const routedCandidate = sortedScores.find((item) => item.actionType === routedAction) ?? selected;
    return toDecision(routedAction, sortedScores, [
      ...routedCandidate.reasons,
      {
        key: "gap_routing_override",
        magnitude: 1,
        kind: "signal",
        detail: `Gap routing selected ${routedAction} from current missing-dimension state.`,
      },
      ...(handwaveSignal?.forceDeeperAction
        ? [
            {
              key: "depth_streak_force_deeper",
              magnitude: handwaveSignal.lowDetailStreak ?? 2,
              kind: "signal" as const,
              detail: "Low-detail streak reached threshold, so the interviewer is forced into a deeper follow-up.",
            },
          ]
        : []),
    ], decisionContext);
  }

  if (!chainContext.sameChain && chainContext.previousActionType) {
    const selectedCandidate = sortedScores.find((item) => item.actionType === selected.actionType) ?? selected;
    return toDecision(selected.actionType, sortedScores, [
      ...selectedCandidate.reasons,
      {
        key: "stability_chain_reset",
        magnitude: 0.5,
        kind: "signal",
        detail: `Stability reset: previous action ${chainContext.previousActionType} belongs to a different problem chain (${chainContext.previousGap ?? "unknown"} -> ${chainContext.currentGap ?? "none"}).`,
      },
    ], decisionContext);
  }

  return toDecision(selected.actionType, sortedScores, undefined, decisionContext);
}

function assessSystemDesignGrillingState(input: {
  targetLevel: SystemDesignTargetLevel;
  currentStage: SystemDesignStage;
  signals: CandidateSignalSnapshot;
  gapState: GapState;
}) {
  const highLevelTarget = input.targetLevel === "SENIOR" || input.targetLevel === "STAFF";
  const stageEligible = input.currentStage === "DEEP_DIVE" || input.currentStage === "REFINEMENT";
  const candidateConfidence = typeof input.signals.confidence === "number" ? input.signals.confidence : 0.5;
  const coreScopeReady =
    input.signals.designSignals?.signals.requirement_missing === false &&
    input.signals.designSignals?.signals.capacity_missing === false;
  const openGapCount = countOpenSystemDesignGaps(input.gapState);
  const active = highLevelTarget && stageEligible && candidateConfidence >= 0.82 && coreScopeReady && openGapCount <= 2;

  return {
    active,
    reason: active
      ? `Grilling trigger active for ${input.targetLevel}: confidence=${candidateConfidence.toFixed(2)}, stage=${input.currentStage}, openGaps=${openGapCount}.`
      : null,
  };
}

function applyGrillingPressure(
  scores: Array<{
    actionType: SystemDesignPolicyAction;
    reasons: Array<{ key: string; magnitude: number; kind: "signal"; detail: string }>;
    totalScore: number;
  }>,
  grilling: {
    active: boolean;
    reason: string | null;
  },
) {
  if (!grilling.active) {
    return scores;
  }

  return scores.map((candidate) => {
    let delta = 0;
    if (candidate.actionType === "CHALLENGE_SPOF" || candidate.actionType === "ZOOM_IN") {
      delta += 0.24;
    }
    if (candidate.actionType === "PROBE_TRADEOFF") {
      delta += 0.16;
    }
    if (candidate.actionType === "WRAP_UP") {
      delta -= 0.28;
    }

    if (delta === 0) {
      return candidate;
    }

    const reasons = [
      ...candidate.reasons,
      {
        key: "grilling_pressure",
        magnitude: delta,
        kind: "signal" as const,
        detail:
          grilling.reason ??
          "Strong-candidate grilling is active: increase deep probes and reduce early wrap-up bias.",
      },
    ];

    return {
      ...candidate,
      reasons,
      totalScore: Number((candidate.totalScore + delta).toFixed(3)),
    };
  });
}

function score(
  actionType: SystemDesignPolicyAction,
  stage: SystemDesignStage,
  signals: NonNullable<CandidateSignalSnapshot["designSignals"]>["signals"],
  targetLevel: SystemDesignTargetLevel,
  handwaveSignal:
    | {
        detected: boolean;
        depth: number;
        expectedDepth: number;
        categories: Array<"unjustified_component_choice" | "unquantified_scaling_claim" | "tradeoff_evasion">;
      forceDeeperAction?: boolean;
      lowDetailStreak?: number;
    }
    | undefined,
  gapState: GapState,
) {
  const profile = levelProfile(targetLevel);
  const unresolvedDeepSignals = [signals.tradeoff_missed, signals.spof_missed, signals.bottleneck_unexamined].filter(Boolean).length;
  const unresolvedTotalSignals = Object.values(signals).filter(Boolean).length;
  const coreScopeEstablished = !signals.requirement_missing && !signals.capacity_missing;

  let need = 0;
  let timing = 0;
  let value = 0;
  let closure = 0;
  let policy = 0;

  switch (actionType) {
    case "ASK_REQUIREMENT":
      need = signals.requirement_missing || stage === "REQUIREMENTS" ? 0.95 : -0.2;
      timing = stage === "REQUIREMENTS" ? 0.85 : -0.05;
      value = signals.requirement_missing ? 0.92 : -0.15;
      closure = stage === "WRAP_UP" ? -0.3 : 0.1;
      policy = 0.08;
      break;
    case "ASK_CAPACITY":
      need = signals.capacity_missing ? 0.9 : -0.15;
      timing = stage === "CAPACITY" ? 0.88 : stage === "HIGH_LEVEL" ? 0.28 : -0.05;
      value = signals.capacity_missing ? 0.86 : -0.1;
      closure = stage === "WRAP_UP" ? -0.3 : 0.08;
      policy = (signals.capacity_missing && stage === "CAPACITY" ? 0.65 : 0.05) * profile.capacityPressure;
      break;
    case "PROBE_TRADEOFF":
      need = signals.tradeoff_missed ? 0.88 : -0.12;
      timing = stage === "DEEP_DIVE" || stage === "REFINEMENT" ? 0.7 : 0.2;
      value = signals.tradeoff_missed ? 0.85 : 0.2;
      closure = stage === "WRAP_UP" ? -0.25 : 0.08;
      policy = signals.tradeoff_missed ? 0.5 : 0.02;
      need *= profile.deepDivePressure;
      timing *= profile.deepDivePressure;
      value *= profile.deepDivePressure;
      policy *= profile.deepDivePressure;
      break;
    case "CHALLENGE_SPOF":
      need = signals.spof_missed ? 0.9 : -0.15;
      timing = stage === "DEEP_DIVE" || stage === "REFINEMENT" ? 0.74 : 0.18;
      value = signals.spof_missed ? 0.88 : 0.15;
      closure = stage === "WRAP_UP" ? -0.25 : 0.08;
      policy = signals.spof_missed ? 0.58 : 0.02;
      need *= profile.deepDivePressure;
      timing *= profile.deepDivePressure;
      value *= profile.deepDivePressure;
      policy *= profile.deepDivePressure;
      break;
    case "ZOOM_IN":
      need = signals.bottleneck_unexamined ? 0.84 : 0.25;
      timing = stage === "DEEP_DIVE" || stage === "REFINEMENT" ? 0.72 : 0.2;
      value = signals.bottleneck_unexamined ? 0.82 : 0.4;
      closure = stage === "WRAP_UP" ? -0.22 : 0.1;
      policy = signals.bottleneck_unexamined ? 0.52 : 0.04;
      need *= profile.deepDivePressure;
      timing *= profile.deepDivePressure;
      value *= profile.deepDivePressure;
      policy *= profile.deepDivePressure;
      break;
    case "WRAP_UP":
      need = stage === "WRAP_UP" ? 0.8 : -0.45;
      timing = stage === "WRAP_UP" ? 0.9 : -0.35;
      value = Object.values(signals).every((missing) => !missing) ? 0.75 : -0.35;
      closure = Object.values(signals).every((missing) => !missing) || stage === "WRAP_UP" ? 0.9 : -0.6;
      policy = 0.03;
      if (coreScopeEstablished && unresolvedDeepSignals <= profile.wrapUpTolerance) {
        value += profile.wrapUpBoost;
        closure += profile.wrapUpBoost;
      }
      if (unresolvedTotalSignals > profile.wrapUpTolerance + 1) {
        value -= 0.18 * profile.deepDivePressure;
        closure -= 0.12 * profile.deepDivePressure;
      }
      break;
  }

  if (gapState.missing_capacity && actionType === "ASK_CAPACITY") {
    policy += 0.24;
    value += 0.12;
  }
  if (gapState.missing_tradeoff && actionType === "PROBE_TRADEOFF") {
    policy += 0.22;
    value += 0.1;
  }
  if (gapState.missing_reliability && actionType === "CHALLENGE_SPOF") {
    policy += 0.2;
    value += 0.1;
  }
  if (gapState.missing_bottleneck && actionType === "ZOOM_IN") {
    policy += 0.2;
    value += 0.1;
  }

  if (handwaveSignal?.detected) {
    const hasTradeoffEvasion = handwaveSignal.categories.includes("tradeoff_evasion");
    const hasUnquantifiedScaling = handwaveSignal.categories.includes("unquantified_scaling_claim");
    if (actionType === "PROBE_TRADEOFF") {
      policy += hasTradeoffEvasion ? 0.28 : 0.16;
      value += 0.12;
    }
    if (actionType === "ASK_CAPACITY" && hasUnquantifiedScaling) {
      policy += 0.24;
      value += 0.1;
    }
    if (actionType === "WRAP_UP") {
      policy -= 0.2;
      value -= 0.16;
      closure -= 0.12;
    }
  }

  const reasons = [
    { key: "need", magnitude: need, kind: "signal" as const, detail: "Need score from unresolved system-design evidence." },
    { key: "timing", magnitude: timing, kind: "signal" as const, detail: "Timing score from the current system-design stage." },
    { key: "value", magnitude: value, kind: "signal" as const, detail: "Value score from expected evidence gain." },
    { key: "closure", magnitude: closure, kind: "signal" as const, detail: "Closure score from stage readiness." },
    { key: "policy", magnitude: policy, kind: "signal" as const, detail: "Policy bias toward missing must-have signals." },
  ];
  const totalScore = Number(reasons.reduce((sum, item) => sum + item.magnitude, 0).toFixed(3));

  return {
    actionType,
    reasons,
    totalScore,
  };
}

function applyInertia(
  scores: Array<{
    actionType: SystemDesignPolicyAction;
    reasons: Array<{ key: string; magnitude: number; kind: "signal"; detail: string }>;
    totalScore: number;
  }>,
  previousActionType: SystemDesignPolicyAction | null,
) {
  if (!previousActionType) {
    return scores;
  }

  return scores.map((candidate) => {
    if (candidate.actionType !== previousActionType) {
      return candidate;
    }
    const reasons = [
      ...candidate.reasons,
      {
        key: "stability_inertia",
        magnitude: STABILITY_LAMBDA,
        kind: "signal" as const,
        detail: "Inertia bonus keeps the previous action unless a materially better move appears.",
      },
    ];
    return {
      ...candidate,
      reasons,
      totalScore: Number((candidate.totalScore + STABILITY_LAMBDA).toFixed(3)),
    };
  });
}

function applyHysteresis(
  sortedScores: Array<{
    actionType: SystemDesignPolicyAction;
    reasons: Array<{ key: string; magnitude: number; kind: "signal"; detail: string }>;
    totalScore: number;
  }>,
  previousActionType: SystemDesignPolicyAction | null,
) {
  const top = sortedScores[0];
  if (!top || !previousActionType || top.actionType === previousActionType) {
    return top ?? {
      actionType: "ASK_REQUIREMENT" as const,
      reasons: [],
      totalScore: 0,
    };
  }

  const previousCandidate = sortedScores.find((item) => item.actionType === previousActionType);
  if (!previousCandidate) {
    return top;
  }

  if (top.totalScore < previousCandidate.totalScore + HYSTERESIS_DELTA) {
    return {
      ...previousCandidate,
      reasons: [
        ...previousCandidate.reasons,
        {
          key: "stability_hysteresis",
          magnitude: HYSTERESIS_DELTA,
          kind: "signal" as const,
          detail: "Hysteresis kept the previous action because the new winner was not decisively better.",
        },
      ],
    };
  }

  return top;
}

function assessProblemChainContinuity(input: {
  currentGapState: GapState;
  previousActionType: SystemDesignPolicyAction | null;
}) {
  const currentGap = mapActionToGap(routeSystemDesignActionByGap(input.currentGapState));
  const previousGap = mapActionToGap(input.previousActionType);
  const sameChain =
    !input.previousActionType ||
    currentGap === null ||
    previousGap === null ||
    currentGap === previousGap;

  return {
    sameChain,
    currentGap,
    previousGap,
    previousActionType: input.previousActionType,
  };
}

function mapActionToGap(
  actionType: SystemDesignPolicyAction | null,
): "capacity" | "tradeoff" | "reliability" | "bottleneck" | null {
  switch (actionType) {
    case "ASK_CAPACITY":
      return "capacity";
    case "PROBE_TRADEOFF":
      return "tradeoff";
    case "CHALLENGE_SPOF":
      return "reliability";
    case "ZOOM_IN":
      return "bottleneck";
    default:
      return null;
  }
}

function detectSafetyOverride(input: {
  recentEvents?: Array<{ eventType: string; payloadJson?: unknown }>;
  fallbackAction: SystemDesignPolicyAction;
}) {
  const events = input.recentEvents ?? [];
  for (let index = events.length - 1; index >= 0 && index >= events.length - 8; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }
    if (event.eventType === "SESSION_BUDGET_EXCEEDED") {
      return {
        actionType: "WRAP_UP" as const,
        key: "safety_budget_override",
        detail: "Budget guardrail fired recently; forcing WRAP_UP for safe closure.",
      };
    }
    if (event.eventType === "DECISION_RECORDED") {
      const payload = asRecord(event.payloadJson);
      const decision = asRecord(payload.decision);
      const blockedByInvariant = asRecord(decision).blockedByInvariant;
      if (typeof blockedByInvariant === "string" && blockedByInvariant.length > 0) {
        return {
          actionType: input.fallbackAction,
          key: "safety_invariant_override",
          detail: `Recent hard invariant (${blockedByInvariant}) detected; bypassing stability lock and selecting safest gap-routed action.`,
        };
      }
    }
  }
  return null;
}

function normalizeSystemDesignTargetLevel(value: string | null | undefined): SystemDesignTargetLevel {
  if (value === "NEW_GRAD" || value === "SDE1" || value === "SDE2" || value === "SENIOR" || value === "STAFF") {
    return value;
  }
  return "SDE2";
}

function levelProfile(targetLevel: SystemDesignTargetLevel) {
  switch (targetLevel) {
    case "NEW_GRAD":
      return {
        deepDivePressure: 0.58,
        capacityPressure: 0.82,
        wrapUpTolerance: 2,
        wrapUpBoost: 0.34,
      };
    case "SDE1":
      return {
        deepDivePressure: 0.68,
        capacityPressure: 0.88,
        wrapUpTolerance: 2,
        wrapUpBoost: 0.28,
      };
    case "SDE2":
      return {
        deepDivePressure: 1,
        capacityPressure: 1,
        wrapUpTolerance: 1,
        wrapUpBoost: 0.12,
      };
    case "SENIOR":
      return {
        deepDivePressure: 1.2,
        capacityPressure: 1.1,
        wrapUpTolerance: 0,
        wrapUpBoost: 0,
      };
    case "STAFF":
      return {
        deepDivePressure: 1.34,
        capacityPressure: 1.18,
        wrapUpTolerance: 0,
        wrapUpBoost: -0.06,
      };
  }
}

function toDecision(
  actionType: SystemDesignPolicyAction,
  scores: Array<{
    actionType: SystemDesignPolicyAction;
    reasons: Array<{ key: string; magnitude: number; kind: "signal"; detail: string }>;
    totalScore: number;
  }>,
  overrideReasons?: Array<{ key: string; magnitude: number; kind: "signal"; detail: string }>,
  context?: {
    gapState: GapState;
    routedAction: SystemDesignPolicyAction | null;
    primaryGap: "capacity" | "tradeoff" | "reliability" | "bottleneck" | null;
    openGapCount: number;
  },
): SystemDesignDecision {
  const selected = scores.find((item) => item.actionType === actionType) ?? scores[0];
  const contextReason =
    context
      ? {
          key: "gap_state_baseline",
          magnitude: context.openGapCount,
          kind: "signal" as const,
          detail: `GapState baseline: open=${context.openGapCount}, primary=${context.primaryGap ?? "none"}, routed=${context.routedAction ?? "none"}, flags={capacity:${context.gapState.missing_capacity},tradeoff:${context.gapState.missing_tradeoff},reliability:${context.gapState.missing_reliability},bottleneck:${context.gapState.missing_bottleneck}}.`,
        }
      : null;
  const common = {
    confidence: 0.86,
    reason: `System design argmax selected ${actionType}.`,
    scoreBreakdown: [
      ...(overrideReasons ?? selected?.reasons ?? []),
      ...(contextReason ? [contextReason] : []),
    ],
    candidateScores: [],
    totalScore: selected?.totalScore ?? 0,
    systemDesignActionType: actionType,
  };

  switch (actionType) {
    case "ASK_REQUIREMENT":
      return {
        ...common,
        action: "ask_for_clarification",
        target: "understanding",
        question:
          "Before we continue, clarify requirements: core functional scope, expected scale (for example QPS/traffic), and top non-functional goals.",
        policyAction: "CLARIFY",
      };
    case "ASK_CAPACITY":
      return {
        ...common,
        action: "ask_followup",
        target: "approach",
        question:
          "Quantify one concrete capacity estimate first (traffic or data), then explain how it changes your architecture choices.",
        policyAction: "PROBE_APPROACH",
      };
    case "PROBE_TRADEOFF":
      return {
        ...common,
        action: "probe_tradeoff",
        target: "tradeoff",
        question:
          "Compare two realistic design options, state pros/cons, and justify which tradeoff you pick.",
        policyAction: "PROBE_APPROACH",
      };
    case "CHALLENGE_SPOF":
      return {
        ...common,
        action: "ask_followup",
        target: "correctness",
        question:
          "What is the biggest single point of failure in your design, and what mitigation would you add?",
        policyAction: "PROBE_APPROACH",
      };
    case "ZOOM_IN":
      return {
        ...common,
        action: "ask_followup",
        target: "approach",
        question:
          "Zoom in on one bottleneck in your design and walk through your optimization plan plus tradeoff.",
        policyAction: "PROBE_APPROACH",
      };
    case "WRAP_UP":
      return {
        ...common,
        action: "move_to_wrap_up",
        target: "summary",
        question:
          "Give a concise final design summary: key components, major tradeoff, reliability posture, and one next improvement.",
        suggestedStage: "WRAP_UP",
        policyAction: "WRAP_UP",
      };
  }
}

export function mapSystemDesignActionToPolicyAction(actionType: SystemDesignPolicyAction): CodingInterviewPolicyAction {
  switch (actionType) {
    case "ASK_REQUIREMENT":
      return "CLARIFY";
    case "ASK_CAPACITY":
    case "PROBE_TRADEOFF":
    case "CHALLENGE_SPOF":
    case "ZOOM_IN":
      return "PROBE_APPROACH";
    case "WRAP_UP":
      return "WRAP_UP";
  }
}

function hasExplicitScopedAssumption(
  recentTranscripts?: Array<{ speaker: "USER" | "AI" | "SYSTEM"; text: string }>,
  recentEvents?: Array<{ eventType: string; payloadJson?: unknown }>,
) {
  const userTurn = [...(recentTranscripts ?? [])].reverse().find((item) => item.speaker === "USER")?.text.toLowerCase() ?? "";
  const assumptionInText =
    /\b(assume|assuming|let's assume|for now we assume)\b/.test(userTurn) &&
    /\b(qps|rps|tps|req\/s|users|dau|mau|gb|tb|mb|ms|s|region|zone|az|node|instance|tenant)\b/.test(userTurn);

  if (assumptionInText) {
    return true;
  }

  for (let index = (recentEvents?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = recentEvents?.[index];
    if (!event) {
      continue;
    }
    if (event.eventType === "EXPLICIT_ASSUMPTION_RECORDED") {
      return true;
    }
    if (event.eventType === "SIGNAL_SNAPSHOT_RECORDED") {
      const payload = asRecord(event.payloadJson);
      const signals = asRecord(payload.signals);
      const designSignals = asRecord(signals.designSignals);
      const handwave = asRecord(designSignals.handwave);
      if (handwave.detected === false) {
        break;
      }
    }
  }

  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
