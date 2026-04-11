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
  components: {
    evidenceGain: number;
    redundancy: number;
    badInterruption: number;
    flowPreservation: number;
    cleanClosure: number;
    riskIdentified: number;
    tradeoffDepth: number;
    handwavePenalty: number;
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
    hasAny(target ?? "", ["requirement", "capacity", "spof", "bottleneck"]);

  let riskIdentified = 0;
  let tradeoffDepth = 0;
  let handwavePenalty = 0;
  const designEvidenceTypes = new Set<"requirement" | "capacity" | "tradeoff" | "spof" | "bottleneck" | "handwave">();

  if (isSystemDesignReward) {
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

    const looksHandwavey =
      action === "encourage_and_continue" ||
      (action === "hold_and_listen" && urgency === "high") ||
      (target === "approach" && !hasAny(action ?? "", ["probe", "ask_for_clarification"]));
    if (looksHandwavey) {
      handwavePenalty = -0.3;
      penalties.push("handwave_detected");
      designEvidenceTypes.add("handwave");
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
        handwavePenalty * 0.08,
    ),
    -1,
    1,
  );

  return {
    version: "v1",
    total,
    components: {
      evidenceGain: round2(evidenceGain),
      redundancy: round2(redundancy),
      badInterruption: round2(badInterruption),
      flowPreservation: round2(flowPreservation),
      cleanClosure: round2(cleanClosure),
      riskIdentified: round2(riskIdentified),
      tradeoffDepth: round2(tradeoffDepth),
      handwavePenalty: round2(handwavePenalty),
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
