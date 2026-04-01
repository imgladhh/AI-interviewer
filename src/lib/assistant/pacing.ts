import type { CandidateDecision } from "@/lib/assistant/decision_engine";
import type { MemoryLedger } from "@/lib/assistant/memory_ledger";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

export type DecisionPressure = "soft" | "neutral" | "challenging" | "surgical";
export type DecisionUrgency = "low" | "medium" | "high";
export type InterruptionCost = "low" | "medium" | "high";
export type EvidenceImportance = "optional" | "important" | "critical";
export type TimingVerdict = "ask_now" | "defer" | "skip" | "move_to_implementation";

export type PacingAssessment = {
  mustMoveToImplementation: boolean;
  complexityEnough: boolean;
  testingEnough: boolean;
  shouldStopTesting: boolean;
  shouldStopComplexity: boolean;
  questionWorthAsking: boolean;
  worthReason: string;
  urgency: DecisionUrgency;
  canDefer: boolean;
  interruptionCost: InterruptionCost;
  evidenceImportance: EvidenceImportance;
  batchable: boolean;
  batchGroup?: string;
  timingVerdict: TimingVerdict;
  evidenceFocus?: string;
};

export function assessInterviewPacing(input: {
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  ledger: MemoryLedger;
  latestExecutionRun?: ExecutionRunLike | null;
  decision?: CandidateDecision;
}): PacingAssessment {
  const { currentStage, signals, ledger, latestExecutionRun, decision } = input;
  const complexityEnough =
    ledger.answeredTargets.includes("complexity") ||
    ledger.answeredTargets.includes("tradeoff") ||
    ledger.collectedEvidence.includes("complexity_tradeoff");
  const testingEnough =
    ledger.answeredTargets.includes("testing") ||
    ledger.answeredTargets.includes("edge_case") ||
    (ledger.collectedEvidence.includes("test_cases") &&
      (ledger.collectedEvidence.includes("exact_test_outputs") ||
        ledger.collectedEvidence.includes("boundary_coverage")));
  const mustMoveToImplementation =
    !latestExecutionRun &&
    signals.readyToCode &&
    signals.understanding === "clear" &&
    signals.progress !== "stuck" &&
    (signals.algorithmChoice === "reasonable" || signals.algorithmChoice === "strong") &&
    (complexityEnough || signals.complexityRigor !== "missing" || testingEnough || signals.edgeCaseAwareness !== "missing");

  const shouldStopTesting =
    testingEnough &&
    (currentStage === "TESTING_AND_COMPLEXITY" ||
      currentStage === "WRAP_UP" ||
      latestExecutionRun?.status === "PASSED");
  const shouldStopComplexity =
    complexityEnough &&
    (currentStage === "TESTING_AND_COMPLEXITY" ||
      currentStage === "WRAP_UP" ||
      latestExecutionRun?.status === "PASSED");

  const interruptionCost = classifyInterruptionCost({
    currentStage,
    signals,
    latestExecutionRun,
  });
  const urgency = decision ? classifyUrgency(decision) : "medium";
  const evidenceImportance = decision ? classifyEvidenceImportance(decision) : "important";
  const canDefer = urgency !== "high";
  const { batchable, batchGroup } = classifyBatching(decision);

  if (!decision) {
    return {
      mustMoveToImplementation,
      complexityEnough,
      testingEnough,
      shouldStopTesting,
      shouldStopComplexity,
      questionWorthAsking: true,
      worthReason: "No concrete interviewer turn has been proposed yet.",
      urgency,
      canDefer,
      interruptionCost,
      evidenceImportance,
      batchable,
      batchGroup,
      timingVerdict: "ask_now",
      evidenceFocus: undefined,
    };
  }

  if (
    mustMoveToImplementation &&
    ["reasoning", "correctness", "testing", "edge_case", "complexity", "tradeoff"].includes(
      decision.target,
    )
  ) {
    return {
      mustMoveToImplementation,
      complexityEnough,
      testingEnough,
      shouldStopTesting,
      shouldStopComplexity,
      questionWorthAsking: false,
      worthReason: "The candidate already has enough pre-code evidence, so further probing should give way to implementation.",
      urgency,
      canDefer,
      interruptionCost,
      evidenceImportance,
      batchable,
      batchGroup,
      timingVerdict: "move_to_implementation",
      evidenceFocus: "implementation_momentum",
    };
  }

  if (
    shouldStopComplexity &&
    ["complexity", "tradeoff"].includes(decision.target)
  ) {
    return {
      mustMoveToImplementation,
      complexityEnough,
      testingEnough,
      shouldStopTesting,
      shouldStopComplexity,
      questionWorthAsking: false,
      worthReason: "The candidate has already supplied enough complexity and tradeoff evidence for this stage.",
      urgency,
      canDefer,
      interruptionCost,
      evidenceImportance,
      batchable,
      batchGroup,
      timingVerdict: "skip",
      evidenceFocus: "complexity_tradeoff",
    };
  }

  if (
    shouldStopTesting &&
    ["testing", "edge_case"].includes(decision.target)
  ) {
    return {
      mustMoveToImplementation,
      complexityEnough,
      testingEnough,
      shouldStopTesting,
      shouldStopComplexity,
      questionWorthAsking: false,
      worthReason: "The candidate has already supplied enough validation evidence for this stage.",
      urgency,
      canDefer,
      interruptionCost,
      evidenceImportance,
      batchable,
      batchGroup,
      timingVerdict: "skip",
      evidenceFocus: "test_cases",
    };
  }

  if (compareUrgency(urgency, interruptionCost) < 0 && canDefer) {
    return {
      mustMoveToImplementation,
      complexityEnough,
      testingEnough,
      shouldStopTesting,
      shouldStopComplexity,
      questionWorthAsking: false,
      worthReason:
        "The candidate currently has productive flow, and this evidence can be deferred without losing important signal.",
      urgency,
      canDefer,
      interruptionCost,
      evidenceImportance,
      batchable,
      batchGroup,
      timingVerdict: "defer",
      evidenceFocus: batchGroup ?? decision.target,
    };
  }

  return {
    mustMoveToImplementation,
    complexityEnough,
    testingEnough,
    shouldStopTesting,
    shouldStopComplexity,
    questionWorthAsking: true,
    worthReason: "This turn still collects missing evidence or advances the interview meaningfully.",
    urgency,
    canDefer,
    interruptionCost,
    evidenceImportance,
    batchable,
    batchGroup,
    timingVerdict: "ask_now",
    evidenceFocus: decision.target,
  };
}

export function applyDecisionPressure(input: {
  decision: CandidateDecision;
  signals: CandidateSignalSnapshot;
  ledger: MemoryLedger;
  pacing: PacingAssessment;
  latestExecutionRun?: ExecutionRunLike | null;
}): CandidateDecision {
  const { decision, signals, ledger, pacing, latestExecutionRun } = input;
  let pressure: DecisionPressure = "neutral";

  if (decision.action === "hold_and_listen" || decision.action === "ask_for_clarification") {
    pressure = "soft";
  } else if (
    decision.action === "ask_for_debug_plan" ||
    (decision.action === "probe_correctness" && (ledger.recentFailedRuns >= 2 || latestExecutionRun?.status === "FAILED")) ||
    (decision.action === "probe_tradeoff" && signals.algorithmChoice === "suboptimal")
  ) {
    pressure = "surgical";
  } else if (
    ["probe_tradeoff", "probe_correctness", "ask_for_test_case", "ask_for_complexity"].includes(decision.action)
  ) {
    pressure = "challenging";
  }

  if (signals.confidence <= 0.5 && pressure !== "surgical") {
    pressure = "soft";
  }

  if (!pacing.questionWorthAsking && pressure !== "surgical") {
    pressure = "soft";
  }

  return {
    ...decision,
    pressure,
    urgency: pacing.urgency,
    canDefer: pacing.canDefer,
    interruptionCost: pacing.interruptionCost,
    evidenceImportance: pacing.evidenceImportance,
    batchable: pacing.batchable,
    batchGroup: pacing.batchGroup,
  };
}

function classifyInterruptionCost(input: {
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  latestExecutionRun?: ExecutionRunLike | null;
}): InterruptionCost {
  const { currentStage, signals, latestExecutionRun } = input;

  if (
    currentStage === "IMPLEMENTATION" &&
    signals.progress === "progressing" &&
    signals.behavior === "structured" &&
    latestExecutionRun?.status !== "FAILED" &&
    latestExecutionRun?.status !== "ERROR" &&
    latestExecutionRun?.status !== "TIMEOUT"
  ) {
    return "high";
  }

  if (
    signals.progress === "stuck" ||
    latestExecutionRun?.status === "FAILED" ||
    latestExecutionRun?.status === "ERROR" ||
    latestExecutionRun?.status === "TIMEOUT"
  ) {
    return "low";
  }

  return "medium";
}

function classifyUrgency(decision: CandidateDecision): DecisionUrgency {
  if (
    decision.action === "ask_for_debug_plan" ||
    decision.action === "move_stage" ||
    decision.action === "encourage_and_continue" ||
    decision.target === "implementation"
  ) {
    return "high";
  }

  if (
    decision.action === "probe_correctness" ||
    decision.action === "probe_tradeoff" ||
    decision.action === "ask_for_test_case" ||
    decision.action === "ask_for_complexity"
  ) {
    return "medium";
  }

  return "low";
}

function classifyEvidenceImportance(decision: CandidateDecision): EvidenceImportance {
  if (
    decision.action === "ask_for_debug_plan" ||
    decision.action === "move_stage" ||
    decision.target === "implementation" ||
    decision.target === "debugging"
  ) {
    return "critical";
  }

  if (
    ["testing", "edge_case", "complexity", "tradeoff", "reasoning", "correctness"].includes(
      decision.target,
    )
  ) {
    return "important";
  }

  return "optional";
}

function classifyBatching(decision?: CandidateDecision) {
  if (!decision) {
    return { batchable: false, batchGroup: undefined };
  }

  if (["testing", "edge_case"].includes(decision.target)) {
    return { batchable: true, batchGroup: "testing_and_edge_cases" };
  }

  if (["complexity", "tradeoff"].includes(decision.target)) {
    return { batchable: true, batchGroup: "complexity_and_tradeoff" };
  }

  if (["reasoning", "correctness"].includes(decision.target)) {
    return { batchable: true, batchGroup: "correctness_and_proof" };
  }

  return { batchable: false, batchGroup: undefined };
}

function compareUrgency(urgency: DecisionUrgency, interruptionCost: InterruptionCost) {
  const score = { low: 1, medium: 2, high: 3 } as const;
  return score[urgency] - score[interruptionCost];
}
