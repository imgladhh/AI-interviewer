import { detectPivotMoment, type NoiseTag } from "@/lib/assistant/pivot";
import { countOpenSystemDesignGaps, deriveSystemDesignGapState } from "@/lib/assistant/system_design_gap";

type SessionEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

type RewardInput = {
  stage: string;
  decision: unknown;
  criticVerdict?: unknown;
  recentEvents: SessionEventLike[];
  originTurnId?: string | null;
};

type RewardAxis = "reasoning" | "implementation" | "test" | "debugging" | "tradeoff";

export type RewardResult = {
  version: "v1";
  total: number;
  noiseTags?: NoiseTag[];
  components: {
    evidenceGain: number;
    redundancy: number;
    badInterruption: number;
    flowPreservation: number;
    cleanClosure: number;
    riskIdentified: number;
    tradeoffDepth: number;
    handwavePenalty: number;
    pivotImpact: number;
  };
  evidenceGainByAxis: Record<RewardAxis, number>;
  designEvidenceTypes: Array<"requirement" | "capacity" | "tradeoff" | "spof" | "bottleneck" | "handwave">;
  attribution: {
    originTurnId: string | null;
    breakdown: {
      evidenceGain: number;
      redundancy: number;
      badInterruption: number;
      flowPreservation: number;
      cleanClosure: number;
      riskIdentified: number;
      tradeoffDepth: number;
      handwavePenalty: number;
      pivotImpact: number;
    };
  };
  penalties: string[];
};

export function evaluateTurnReward(input: RewardInput): RewardResult {
  const decision = asRecord(input.decision);
  const critic = asRecord(input.criticVerdict);
  const action = normalize(stringValue(decision.action));
  const target = normalize(stringValue(decision.target));
  const interruptionCost = normalize(stringValue(decision.interruptionCost));
  const urgency = normalize(stringValue(decision.urgency));
  const stage = normalize(input.stage);
  const penalties: string[] = [];
  const recentEchoCount = input.recentEvents.filter((event) => event.eventType === "CANDIDATE_ECHO_DETECTED").length;
  const echoRecoveryMode = normalize(stringValue(decision.echoRecoveryMode));
  const systemDesignActionType = normalize(stringValue(decision.systemDesignActionType));
  const latestDesignSignals = findLatestDesignSignals(input.recentEvents);

  const evidenceGainByAxis = scoreEvidenceAxes(target);
  const evidenceGain = round2(
    (evidenceGainByAxis.reasoning +
      evidenceGainByAxis.implementation +
      evidenceGainByAxis.test +
      evidenceGainByAxis.debugging +
      evidenceGainByAxis.tradeoff) /
      5,
  );

  const previousDecisionTarget = findLatestDecisionTarget(input.recentEvents);
  let redundancy = 0;
  if (previousDecisionTarget && previousDecisionTarget === target) {
    redundancy = -0.35;
    penalties.push("repeated_target");
  } else if (previousDecisionTarget && previousDecisionTarget !== target) {
    redundancy = 0.1;
  }

  let badInterruption = 0;
  if (critic.shouldWaitBeforeIntervening === true) {
    badInterruption -= 0.4;
    penalties.push("interrupted_when_should_wait");
  }
  if (critic.wouldLikelySelfCorrect === true) {
    badInterruption -= 0.25;
    penalties.push("interrupted_self_correction_window");
  }
  badInterruption = clamp(badInterruption, -1, 0);

  let flowPreservation = 0;
  if (interruptionCost === "high" && urgency === "low") {
    if (action === "hold_and_listen") {
      flowPreservation += 0.25;
    } else {
      flowPreservation -= 0.2;
      penalties.push("high_interrupt_cost_low_urgency");
    }
  }
  if (interruptionCost === "low" && urgency === "high") {
    flowPreservation += 0.1;
  }
  flowPreservation = clamp(flowPreservation, -1, 1);

  if (recentEchoCount > 0) {
    if (echoRecoveryMode) {
      flowPreservation = clamp(flowPreservation + 0.12, -1, 1);
    } else {
      flowPreservation = clamp(flowPreservation - 0.2, -1, 1);
      penalties.push("echo_ignored");
    }
  }

  let cleanClosure = 0;
  const isClosureAction = action === "move_to_wrap_up" || action === "close_topic" || action === "end_interview";
  const isProbeAction = action ? action.startsWith("ask_") || action.startsWith("probe_") : false;
  if (stage === "wrap_up" && isClosureAction) {
    cleanClosure += 0.4;
  }
  if (stage === "wrap_up" && isProbeAction) {
    cleanClosure -= 0.35;
    penalties.push("reopened_wrap_up");
  }
  cleanClosure = clamp(cleanClosure, -1, 1);

  const isSystemDesignReward =
    Boolean(systemDesignActionType) ||
    hasAny(target ?? "", ["requirement", "capacity", "spof", "bottleneck"]) ||
    latestDesignSignals !== null;

  let riskIdentified = 0;
  let tradeoffDepth = 0;
  let handwavePenalty = 0;
  let pivotImpact = 0;
  const noiseTags = detectNoiseTags(input.recentEvents);
  const designEvidenceTypes = new Set<"requirement" | "capacity" | "tradeoff" | "spof" | "bottleneck" | "handwave">();

  if (isSystemDesignReward && noiseTags.length === 0) {
    const gapState =
      latestDesignSignals
        ? deriveSystemDesignGapState({
            signals: {
              capacity_missing: latestDesignSignals.capacity_missing,
              tradeoff_missed: latestDesignSignals.tradeoff_missed,
              spof_missed: latestDesignSignals.spof_missed,
              bottleneck_unexamined: latestDesignSignals.bottleneck_unexamined,
            },
            handwaveCategories: latestDesignSignals.handwave_categories,
          })
        : null;
    const missingCount = gapState
      ? countOpenSystemDesignGaps(gapState) + (latestDesignSignals?.requirement_missing ? 1 : 0)
      : (latestDesignSignals?.requirement_missing ? 1 : 0) +
        (latestDesignSignals?.capacity_missing ? 1 : 0) +
        (latestDesignSignals?.tradeoff_missed ? 1 : 0) +
        (latestDesignSignals?.spof_missed ? 1 : 0) +
        (latestDesignSignals?.bottleneck_unexamined ? 1 : 0);

    if (hasAny(target ?? "", ["spof", "bottleneck", "correctness"]) || hasAny(action ?? "", ["challenge", "zoom"])) {
      riskIdentified = 0.35;
      if (hasAny(target ?? "", ["spof"])) {
        designEvidenceTypes.add("spof");
      } else {
        designEvidenceTypes.add("bottleneck");
      }
    }

    if (hasAny(target ?? "", ["tradeoff"]) || hasAny(action ?? "", ["probe_tradeoff"])) {
      tradeoffDepth = 0.35;
      designEvidenceTypes.add("tradeoff");
    }

    if (hasAny(target ?? "", ["requirement", "understanding"])) {
      designEvidenceTypes.add("requirement");
    }
    if (hasAny(target ?? "", ["capacity"])) {
      designEvidenceTypes.add("capacity");
    }

    const explicitlyAddressesMissingSignal =
      (latestDesignSignals?.requirement_missing === true && hasAny(target ?? "", ["requirement"])) ||
      (latestDesignSignals?.capacity_missing === true && hasAny(target ?? "", ["capacity"])) ||
      (latestDesignSignals?.tradeoff_missed === true && hasAny(target ?? "", ["tradeoff"])) ||
      (latestDesignSignals?.spof_missed === true && hasAny(target ?? "", ["spof"])) ||
      (latestDesignSignals?.bottleneck_unexamined === true && hasAny(target ?? "", ["bottleneck"]));

    if (explicitlyAddressesMissingSignal) {
      riskIdentified = clamp(riskIdentified + 0.1, -1, 1);
    }

    if (missingCount <= 1 && hasAny(action ?? "", ["probe_tradeoff", "challenge_spof", "zoom_in"])) {
      tradeoffDepth = clamp(tradeoffDepth + 0.08, -1, 1);
      riskIdentified = clamp(riskIdentified + 0.08, -1, 1);
    }

    const looksHandwavey =
      latestDesignSignals?.handwave_detected === true ||
      action === "encourage_and_continue" ||
      (action === "hold_and_listen" && urgency === "high") ||
      (target === "approach" && !hasAny(action ?? "", ["probe", "ask_for_clarification"]));
    if (looksHandwavey) {
      handwavePenalty = applyHandwavePenalty({
        missingCount,
        categories: latestDesignSignals?.handwave_categories ?? [],
        lowDetailStreak: latestDesignSignals?.handwave_low_detail_streak ?? 0,
      });
      penalties.push("handwave_detected");
      designEvidenceTypes.add("handwave");
    }

    const capacityReady = gapState ? !gapState.missing_capacity : latestDesignSignals?.capacity_missing === false;
    const reliabilityGapOpen = gapState
      ? gapState.missing_reliability || gapState.missing_bottleneck
      : latestDesignSignals?.spof_missed === true || latestDesignSignals?.bottleneck_unexamined === true;
    const addressesReliabilityGap =
      hasAny(target ?? "", ["spof", "bottleneck", "reliability", "correctness"]) ||
      hasAny(action ?? "", ["challenge", "zoom"]);
    const isClosingMove =
      action === "move_to_wrap_up" ||
      action === "close_topic" ||
      action === "end_interview" ||
      systemDesignActionType === "wrap_up";
    if (capacityReady && reliabilityGapOpen && !addressesReliabilityGap) {
      riskIdentified = clamp(riskIdentified + (isClosingMove ? -0.45 : -0.25), -1, 1);
      penalties.push("capacity_reliability_inconsistency");
    }

    const pivot = detectPivotMoment({
      recentEvents: input.recentEvents,
      decision: input.decision,
      noiseTags,
    });
    if (pivot.detected) {
      pivotImpact = pivot.impactScore;
    }
  }

  const total = clamp(
    round2(
      evidenceGain * 0.45 +
        redundancy * 0.2 +
        badInterruption * 0.15 +
        flowPreservation * 0.1 +
        cleanClosure * 0.1 +
        riskIdentified * 0.08 +
        tradeoffDepth * 0.08 +
        handwavePenalty * 0.08 +
        pivotImpact * 0.08,
    ),
    -1,
    1,
  );

  return {
    version: "v1",
    total,
    noiseTags: noiseTags.length > 0 ? noiseTags : undefined,
    components: {
      evidenceGain: round2(evidenceGain),
      redundancy: round2(redundancy),
      badInterruption: round2(badInterruption),
      flowPreservation: round2(flowPreservation),
      cleanClosure: round2(cleanClosure),
      riskIdentified: round2(riskIdentified),
      tradeoffDepth: round2(tradeoffDepth),
      handwavePenalty: round2(handwavePenalty),
      pivotImpact: round2(pivotImpact),
    },
    evidenceGainByAxis,
    designEvidenceTypes: [...designEvidenceTypes],
    attribution: {
      originTurnId: input.originTurnId ?? null,
      breakdown: {
        evidenceGain: round2(evidenceGain),
        redundancy: round2(redundancy),
        badInterruption: round2(badInterruption),
        flowPreservation: round2(flowPreservation),
        cleanClosure: round2(cleanClosure),
        riskIdentified: round2(riskIdentified),
        tradeoffDepth: round2(tradeoffDepth),
        handwavePenalty: round2(handwavePenalty),
        pivotImpact: round2(pivotImpact),
      },
    },
    penalties,
  };
}

function scoreEvidenceAxes(target: string | null): Record<RewardAxis, number> {
  const token = target ?? "";
  return {
    reasoning: hasAny(token, ["correctness", "invariant", "reasoning", "approach", "proof"]) ? 1 : 0,
    implementation: hasAny(token, ["implementation", "code", "syntax", "refactor"]) ? 1 : 0,
    test: hasAny(token, ["test", "edge_case", "validation"]) ? 1 : 0,
    debugging: hasAny(token, ["debug", "bug", "failure", "error"]) ? 1 : 0,
    tradeoff: hasAny(token, ["tradeoff", "complexity", "optimization"]) ? 1 : 0,
  };
}

function findLatestDecisionTarget(events: SessionEventLike[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.eventType !== "DECISION_RECORDED") {
      continue;
    }
    const payload = asRecord(event.payloadJson);
    const decision = asRecord(payload.decision);
    return normalize(stringValue(decision.target));
  }
  return null;
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function findLatestDesignSignals(
  events: SessionEventLike[],
): {
  requirement_missing: boolean;
  capacity_missing: boolean;
  tradeoff_missed: boolean;
  spof_missed: boolean;
  bottleneck_unexamined: boolean;
  handwave_detected?: boolean;
  handwave_categories?: string[];
  handwave_low_detail_streak?: number;
} | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.eventType !== "SIGNAL_SNAPSHOT_RECORDED") {
      continue;
    }

    const payload = asRecord(event.payloadJson);
    const signals = asRecord(payload.signals);
    const designSignals = asRecord(signals.designSignals);
    const designSignalValues = asRecord(designSignals.signals);
    const keys = [
      "requirement_missing",
      "capacity_missing",
      "tradeoff_missed",
      "spof_missed",
      "bottleneck_unexamined",
    ] as const;

    if (keys.every((key) => typeof designSignalValues[key] === "boolean")) {
      const handwave = asRecord(designSignals.handwave);
      return {
        requirement_missing: designSignalValues.requirement_missing as boolean,
        capacity_missing: designSignalValues.capacity_missing as boolean,
        tradeoff_missed: designSignalValues.tradeoff_missed as boolean,
        spof_missed: designSignalValues.spof_missed as boolean,
        bottleneck_unexamined: designSignalValues.bottleneck_unexamined as boolean,
        handwave_detected: typeof handwave.detected === "boolean" ? (handwave.detected as boolean) : undefined,
        handwave_categories: Array.isArray(handwave.categories)
          ? handwave.categories.filter((item): item is string => typeof item === "string")
          : [],
        handwave_low_detail_streak:
          typeof handwave.lowDetailStreak === "number" ? handwave.lowDetailStreak : 0,
      };
    }
  }

  return null;
}

function detectNoiseTags(events: SessionEventLike[]): NoiseTag[] {
  const tags = new Set<NoiseTag>();
  for (let index = events.length - 1; index >= 0 && index >= events.length - 12; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }
    const payload = asRecord(event.payloadJson);
    const explicit = Array.isArray(payload.noiseTags)
      ? payload.noiseTags.filter((item): item is NoiseTag => item === "STT_CORRUPTION" || item === "PARTIAL_TRANSCRIPT" || item === "INTERRUPTED_TURN")
      : [];
    for (const tag of explicit) {
      tags.add(tag);
    }
    if (event.eventType === "AI_INTERRUPTED_BY_CANDIDATE") {
      tags.add("INTERRUPTED_TURN");
    }
    if (
      event.eventType === "CANDIDATE_TRANSCRIPT_REFINED" &&
      (payload.partial === true || payload.transcriptCompleteness === "partial")
    ) {
      tags.add("PARTIAL_TRANSCRIPT");
    }
    if (
      event.eventType === "STT_USAGE_RECORDED" &&
      (payload.providerFailure || payload.error || payload.errorCode || payload.corruptionDetected === true)
    ) {
      tags.add("STT_CORRUPTION");
    }
  }
  return [...tags];
}

function applyHandwavePenalty(input: { missingCount: number; categories: string[]; lowDetailStreak: number }) {
  let penalty = -0.3;

  if (input.missingCount >= 3) {
    penalty = -0.4;
  }
  if (input.categories.includes("tradeoff_evasion")) {
    penalty -= 0.04;
  }
  if (input.categories.includes("unquantified_scaling_claim")) {
    penalty -= 0.04;
  }
  if (input.lowDetailStreak >= 2) {
    penalty -= 0.06;
  }

  return clamp(round2(penalty), -1, 1);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function normalize(value: string | null) {
  return value ? value.trim().toLowerCase() : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
