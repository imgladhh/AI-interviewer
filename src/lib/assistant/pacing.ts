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

export type PacingAssessment = {
  mustMoveToImplementation: boolean;
  complexityEnough: boolean;
  testingEnough: boolean;
  shouldStopTesting: boolean;
  shouldStopComplexity: boolean;
  questionWorthAsking: boolean;
  worthReason: string;
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

  if (!decision) {
    return {
      mustMoveToImplementation,
      complexityEnough,
      testingEnough,
      shouldStopTesting,
      shouldStopComplexity,
      questionWorthAsking: true,
      worthReason: "No concrete interviewer turn has been proposed yet.",
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
      evidenceFocus: "test_cases",
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
  };
}
