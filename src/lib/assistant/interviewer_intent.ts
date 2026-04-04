import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { MemoryLedger } from "@/lib/assistant/memory_ledger";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

export type InterviewerIntent =
  | "validate"
  | "probe"
  | "guide"
  | "pressure"
  | "unblock"
  | "advance"
  | "close";

export type IntentDecision = {
  intent: InterviewerIntent;
  targetSignal?: string;
  reason: string;
  expectedOutcome:
    | "confirm_strength"
    | "expose_gap"
    | "collect_missing_evidence"
    | "unlock_progress"
    | "advance_stage"
    | "close_topic";
  canDefer: boolean;
  urgency: "low" | "medium" | "high";
};

export function decideInterviewerIntent(input: {
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  memory: MemoryLedger;
  latestExecutionRun?: ExecutionRunLike | null;
}): IntentDecision {
  const { currentStage, signals, memory, latestExecutionRun } = input;

  if (
    memory.topicSaturation.summary >= 2 ||
    (currentStage === "WRAP_UP" && (signals.progress === "done" || memory.answeredTargets.includes("summary")))
  ) {
    return {
      intent: "close",
      targetSignal: "summary",
      reason: "The active topic is already saturated, so the best move is to close the topic cleanly.",
      expectedOutcome: "close_topic",
      canDefer: false,
      urgency: "high",
    };
  }

  if (latestExecutionRun && latestExecutionRun.status !== "PASSED") {
    return {
      intent: memory.recentFailedRuns >= 2 ? "unblock" : "probe",
      targetSignal: "debugging",
      reason:
        memory.recentFailedRuns >= 2
          ? "Repeated failing runs mean the candidate needs help unlocking progress instead of another broad prompt."
          : "A failed run is the highest-signal path to expose and localize the current debugging gap.",
      expectedOutcome: memory.recentFailedRuns >= 2 ? "unlock_progress" : "expose_gap",
      canDefer: false,
      urgency: "high",
    };
  }

  if (
    (signals.readyToCode && signals.progress === "progressing") ||
    memory.missingEvidence.length === 0 ||
    (currentStage === "APPROACH_DISCUSSION" &&
      signals.understanding === "clear" &&
      (signals.algorithmChoice === "reasonable" || signals.algorithmChoice === "strong"))
  ) {
    return {
      intent: "advance",
      targetSignal: currentStage === "APPROACH_DISCUSSION" ? "implementation" : "summary",
      reason: "The candidate has enough evidence at the current stage, so the interviewer should advance instead of front-loading more probing.",
      expectedOutcome: "advance_stage",
      canDefer: false,
      urgency: "high",
    };
  }

  if (signals.progress === "stuck") {
    return {
      intent: "guide",
      targetSignal: "debugging",
      reason: "The candidate is losing momentum, so a guided move is more valuable than another evaluative probe.",
      expectedOutcome: "unlock_progress",
      canDefer: false,
      urgency: "medium",
    };
  }

  if (signals.reasoningDepth === "thin" || signals.complexityRigor === "missing") {
    return {
      intent: "validate",
      targetSignal: signals.reasoningDepth === "thin" ? "correctness" : "complexity",
      reason: "The candidate named the direction, but one core piece of reasoning still needs to be validated explicitly.",
      expectedOutcome: "confirm_strength",
      canDefer: true,
      urgency: "medium",
    };
  }

  if (memory.unresolvedIssues.length > 0) {
    return {
      intent: "probe",
      targetSignal: memory.unresolvedIssues[0]?.split(":")[0]?.trim().toLowerCase() || "correctness",
      reason: "The session still has a concrete unresolved issue, so a targeted probe can expose the remaining gap cleanly.",
      expectedOutcome: "expose_gap",
      canDefer: true,
      urgency: "medium",
    };
  }

  if (
    signals.communication === "clear" &&
    (signals.reasoningDepth === "moderate" || signals.reasoningDepth === "deep") &&
    currentStage !== "PROBLEM_UNDERSTANDING"
  ) {
    return {
      intent: "pressure",
      targetSignal: "reasoning",
      reason: "The candidate sounds fluent enough that a slightly sharper follow-up can distinguish depth from fluency.",
      expectedOutcome: "confirm_strength",
      canDefer: true,
      urgency: "low",
    };
  }

  return {
    intent: "guide",
    targetSignal: "approach",
    reason: "The candidate is moving, but the interviewer still wants to collect one more useful signal without disrupting flow too aggressively.",
    expectedOutcome: "collect_missing_evidence",
    canDefer: true,
    urgency: "low",
  };
}
