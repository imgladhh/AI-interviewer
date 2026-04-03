import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { MemoryLedger } from "@/lib/assistant/memory_ledger";

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
};

export type CandidateCeiling = "foundational" | "solid" | "strong" | "stretch";
export type EaseOfExecution = "strained" | "steady" | "smooth";

export type LatentCalibration = {
  candidateCeiling: CandidateCeiling;
  easeOfExecution: EaseOfExecution;
  levelUpReady: boolean;
  confidenceInVerdict: number;
};

export function assessLatentCalibration(input: {
  signals: CandidateSignalSnapshot;
  ledger: MemoryLedger;
  latestExecutionRun?: ExecutionRunLike | null;
}) {
  const { signals, ledger, latestExecutionRun } = input;
  const passedRuns = ledger.recentFailedRuns === 0 && latestExecutionRun?.status === "PASSED";
  const strongReasoning = signals.reasoningDepth === "deep";
  const strongComplexity = signals.complexityRigor === "strong";
  const strongTesting = signals.testingDiscipline === "strong";
  const noHintReliance = ledger.recentHints === 0;
  const lowFriction =
    signals.progress === "progressing" &&
    signals.behavior === "structured" &&
    signals.communication === "clear" &&
    signals.confidence >= 0.72;

  let easeOfExecution: EaseOfExecution = "steady";
  if (signals.progress === "stuck" || ledger.recentFailedRuns >= 2) {
    easeOfExecution = "strained";
  } else if (lowFriction && noHintReliance) {
    easeOfExecution = "smooth";
  }

  let candidateCeiling: CandidateCeiling = "foundational";
  if ((signals.algorithmChoice === "reasonable" || signals.algorithmChoice === "strong") && signals.understanding === "clear") {
    candidateCeiling = "solid";
  }
  if (
    candidateCeiling === "solid" &&
    (strongReasoning || strongComplexity || strongTesting) &&
    easeOfExecution !== "strained"
  ) {
    candidateCeiling = "strong";
  }
  if (
    candidateCeiling === "strong" &&
    strongReasoning &&
    strongComplexity &&
    noHintReliance &&
    passedRuns
  ) {
    candidateCeiling = "stretch";
  }

  const levelUpReady =
    candidateCeiling === "stretch" ||
    (candidateCeiling === "strong" &&
      easeOfExecution === "smooth" &&
      !ledger.missingEvidence.includes("correctness_proof"));

  const confidenceInVerdict = clampNumber(
    signals.confidence +
      (easeOfExecution === "smooth" ? 0.08 : easeOfExecution === "strained" ? -0.08 : 0) +
      (levelUpReady ? 0.06 : 0) +
      (ledger.recentFailedRuns >= 2 ? -0.06 : 0),
  );

  return {
    candidateCeiling,
    easeOfExecution,
    levelUpReady,
    confidenceInVerdict,
  } satisfies LatentCalibration;
}

function clampNumber(value: number) {
  return Math.max(0.2, Math.min(0.98, Number(value.toFixed(2))));
}

