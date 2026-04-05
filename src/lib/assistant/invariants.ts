import type { CandidateDecision, CandidateDecisionTarget, DecisionJustification } from "@/lib/assistant/decision_engine";
import type { MemoryLedger } from "@/lib/assistant/memory_ledger";
import type { PolicyConfig } from "@/lib/assistant/policy-config";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";
import type { TrajectoryEstimate } from "@/lib/assistant/trajectory_estimator";
import type { SessionBudgetStatus } from "@/lib/usage/budget";

type InvariantInput = {
  decision: CandidateDecision;
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  memory: MemoryLedger;
  trajectory: TrajectoryEstimate;
  policyConfig: PolicyConfig;
  budgetState?: SessionBudgetStatus | null;
  recentEvents?: Array<{ eventType: string; payloadJson?: unknown }>;
};

type InvariantResult = {
  decision: CandidateDecision;
  blockedByInvariant?: string;
  decisionPathway: string[];
};

export function applyDecisionInvariants(input: InvariantInput): InvariantResult {
  const { decision, currentStage, signals, memory, trajectory, policyConfig, budgetState } = input;
  const basePathway = [`Policy(${input.policyConfig.archetype})`];

  if (budgetState?.exceeded) {
    return {
      blockedByInvariant: "budget_guardrail",
      decisionPathway: [...basePathway, "Invariant(budget_guardrail)", "Action(end_interview)"],
      decision: {
        ...decision,
        action: "end_interview",
        target: "summary",
        intent: "close",
        pressure: "soft",
        timing: "skip",
        worthAskingNow: false,
        closureCandidate: true,
        question: `We have reached the session budget cap at about $${budgetState.projectedTotalUsd.toFixed(2)}. Let us stop here and close the interview cleanly.`,
        reason: "The session budget guardrail was exceeded, so the interview must close immediately.",
      },
    };
  }

  if (
    trajectory.candidateTrajectory === "steady_progress" &&
    currentStage === "IMPLEMENTATION" &&
    !hasFailingRunSignals(signals, memory)
  ) {
    return {
      blockedByInvariant: "flow_preservation",
      decisionPathway: [...basePathway, "Invariant(flow_preservation)", "Action(hold_and_listen)"],
      decision: {
        ...decision,
        action: "hold_and_listen",
        target: "implementation",
        timing: "defer",
        worthAskingNow: false,
        question: "Keep coding. I want to see one more concrete branch, update, or result before I interrupt you.",
        reason: "The candidate is in active coding flow and steadily progressing, so the interviewer should preserve flow instead of interrupting.",
      },
    };
  }

  if (isProbingAnsweredTarget(decision.target, memory)) {
    return {
      blockedByInvariant: "anti_repetition",
      decisionPathway: [
        ...basePathway,
        "Invariant(anti_repetition)",
        `Action(${currentStage === "WRAP_UP" ? "close_topic" : "encourage_and_continue"})`,
      ],
      decision: {
        ...decision,
        action: currentStage === "WRAP_UP" ? "close_topic" : "encourage_and_continue",
        timing: "skip",
        worthAskingNow: false,
        closureCandidate: currentStage === "WRAP_UP",
        question:
          currentStage === "WRAP_UP"
            ? "That point is already covered well enough. Let us close this question cleanly."
            : "That point is already covered well enough. Keep moving, and I will only stop you if a new gap appears.",
        reason: "The target has already been answered, so repeating the same probe would reduce signal quality.",
      },
    };
  }

  if (
    decision.pressure === "surgical" &&
    readPreviousPressure(input.recentEvents) === "surgical" &&
    trajectory.candidateTrajectory !== "collapsing"
  ) {
    return {
      blockedByInvariant: "no_double_surgical_pressure",
      decisionPathway: [...basePathway, "Invariant(no_double_surgical_pressure)", "Action(adjust_pressure)"],
      decision: {
        ...decision,
        pressure: "challenging",
      },
    };
  }

  if (decision.action === "give_hint" && isPassConditionAlreadySatisfied(decision, currentStage, memory, policyConfig)) {
    return {
      blockedByInvariant: "no_hint_after_completion",
      decisionPathway: [...basePathway, "Invariant(no_hint_after_completion)", "Action(move_to_wrap_up)"],
      decision: {
        ...decision,
        action: "move_to_wrap_up",
        target: "summary",
        timing: "skip",
        worthAskingNow: false,
        closureCandidate: true,
        question: "The key evidence for this topic is already complete. Give me one concise wrap-up and then we will close it.",
        reason: "Hints are blocked once the current topic has already passed its completion gate.",
      },
    };
  }

  return {
    decision,
    decisionPathway: [...basePathway, `Action(${decision.action})`],
  };
}

function readPreviousPressure(recentEvents?: Array<{ eventType: string; payloadJson?: unknown }>) {
  const latestDecisionEvent = [...(recentEvents ?? [])]
    .reverse()
    .find((event) => event.eventType === "DECISION_RECORDED");
  const payload =
    typeof latestDecisionEvent?.payloadJson === "object" && latestDecisionEvent.payloadJson !== null
      ? (latestDecisionEvent.payloadJson as Record<string, unknown>)
      : {};
  const decision =
    typeof payload.decision === "object" && payload.decision !== null
      ? (payload.decision as Record<string, unknown>)
      : {};

  return typeof decision.pressure === "string" ? decision.pressure : null;
}

export function buildDecisionJustification(input: {
  decision: CandidateDecision;
  signals: CandidateSignalSnapshot;
  memory: MemoryLedger;
  trajectory: TrajectoryEstimate;
  blockedByInvariant?: string;
}): DecisionJustification {
  const supportingSignals = [
    `trajectory:${input.trajectory.candidateTrajectory}`,
    `evidence_gain:${input.trajectory.evidenceGainIfAskNow}`,
    `answered_targets:${input.memory.answeredTargets.length}`,
    `missing_evidence:${input.memory.missingEvidence.length}`,
    `signal_confidence:${(input.signals.confidence ?? 0).toFixed(2)}`,
  ];

  if (input.signals.readyToCode) {
    supportingSignals.push("ready_to_code");
  }
  if (input.memory.unresolvedIssues.length > 0) {
    supportingSignals.push(`unresolved:${input.memory.unresolvedIssues[0]}`);
  }
  if (input.memory.persistentWeakness) {
    supportingSignals.push(`persistent_weakness:${input.memory.persistentWeakness}`);
  }

  return {
    whyNow:
      input.decision.timing === "skip"
        ? "The system believes there is little or no additional evidence gain from asking this now."
        : input.decision.timing === "defer"
          ? "The system wants the evidence, but current flow and interruption cost make now a poor time to ask."
          : "The current trajectory and evidence gaps make this the highest-value moment to intervene.",
    whyThisAction: input.decision.reason,
    whyNotAlternatives: buildRejectedAlternatives(input.decision, input.trajectory),
    supportingSignals,
    blockedByInvariant: input.blockedByInvariant,
  };
}

function hasFailingRunSignals(signals: CandidateSignalSnapshot, memory: MemoryLedger) {
  return (
    signals.progress === "stuck" ||
    signals.codeQuality === "buggy" ||
    memory.recentFailedRuns >= 1
  );
}

function isProbingAnsweredTarget(target: CandidateDecisionTarget, memory: MemoryLedger) {
  return memory.answeredTargets.includes(target);
}

function isPassConditionAlreadySatisfied(
  decision: CandidateDecision,
  currentStage: CodingInterviewStage,
  memory: MemoryLedger,
  policyConfig: PolicyConfig,
) {
  if (decision.passConditions && decision.passConditions.length > 0 && (decision.missingPassConditions?.length ?? 0) === 0) {
    return true;
  }

  return (
    currentStage === "WRAP_UP" ||
    memory.topicSaturation.summary >= policyConfig.thresholds.evidenceSaturation
  );
}

function buildRejectedAlternatives(decision: CandidateDecision, trajectory: TrajectoryEstimate) {
  const alternatives: string[] = [];

  if (decision.action !== "give_hint") {
    alternatives.push("A hint was not chosen because the candidate can still generate evidence without solutioning.");
  }
  if (decision.action !== "hold_and_listen") {
    alternatives.push(
      trajectory.interruptionCost === "high"
        ? "Purely waiting would preserve flow, but the current evidence need still justifies a directed move."
        : "Purely waiting would not add enough new information compared with the chosen action.",
    );
  }
  if (decision.action !== "close_topic" && decision.action !== "end_interview") {
    alternatives.push("Immediate closure was not chosen because the topic is not yet saturated enough.");
  }

  return alternatives.slice(0, 3);
}
