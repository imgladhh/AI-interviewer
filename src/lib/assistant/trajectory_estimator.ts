import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { FlowState } from "@/lib/assistant/flow_state";
import type { MemoryLedger } from "@/lib/assistant/memory_ledger";
import type { CodingInterviewStage } from "@/lib/assistant/stages";
import type { IntentDecision } from "@/lib/assistant/interviewer_intent";

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

export type TrajectoryEstimate = {
  candidateTrajectory:
    | "self_recovering"
    | "steady_progress"
    | "plateauing"
    | "stuck"
    | "collapsing";
  expectedWithNoIntervention:
    | "will_finish"
    | "may_finish_with_gaps"
    | "likely_stall"
    | "likely_fail";
  interventionValue:
    | "high"
    | "medium"
    | "low";
  bestIntervention:
    | "none"
    | "ask_specific_followup"
    | "ask_for_test_case"
    | "ask_for_complexity"
    | "give_light_hint"
    | "give_rescue_hint"
    | "move_to_implementation"
    | "close_topic";
  interruptionCost: "low" | "medium" | "high";
  evidenceGainIfAskNow: "high" | "medium" | "low";
  confidence: number;
  weakSignalNotes?: string[];
};

type RecentEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

export function estimateCandidateTrajectory(input: {
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  memory: MemoryLedger;
  latestExecutionRun?: ExecutionRunLike | null;
  flowState?: FlowState | null;
  recentEvents?: RecentEventLike[];
  intent: IntentDecision;
}): TrajectoryEstimate {
  const { currentStage, signals, memory, latestExecutionRun, flowState, recentEvents, intent } = input;
  const editorTelemetry = readLatestEditorTelemetry(recentEvents);
  const weakSignalNotes: string[] = [];

  let candidateTrajectory: TrajectoryEstimate["candidateTrajectory"] =
    memory.recentFailedRuns >= 2 || signals.progress === "stuck"
      ? latestExecutionRun && latestExecutionRun.status !== "PASSED"
        ? "collapsing"
        : "stuck"
      : flowState?.codingBurst || flowState?.thinkingBurst
        ? "steady_progress"
        : memory.unresolvedIssues.length > 1
          ? "plateauing"
          : signals.progress === "done"
            ? "self_recovering"
            : "steady_progress";

  if (
    editorTelemetry?.activeCoding &&
    editorTelemetry.struggleLevel === "high" &&
    candidateTrajectory === "steady_progress" &&
    !flowState?.codingBurst
  ) {
    candidateTrajectory = "plateauing";
    weakSignalNotes.push("editor telemetry suggests heavy rewrite churn during active coding");
  } else if (
    editorTelemetry?.activeCoding &&
    editorTelemetry.struggleLevel === "high" &&
    candidateTrajectory === "plateauing"
  ) {
    candidateTrajectory = "stuck";
    weakSignalNotes.push("editor telemetry suggests the candidate is getting stuck in rewrite loops");
  } else if (
    editorTelemetry?.activeCoding &&
    editorTelemetry.struggleLevel === "medium" &&
    candidateTrajectory === "steady_progress" &&
    !flowState?.codingBurst
  ) {
    candidateTrajectory = "plateauing";
    weakSignalNotes.push("editor telemetry suggests slower coding flow than the transcript alone shows");
  }

  const expectedWithNoIntervention =
    candidateTrajectory === "steady_progress"
      ? "will_finish"
      : candidateTrajectory === "self_recovering"
        ? "may_finish_with_gaps"
        : candidateTrajectory === "plateauing"
          ? "may_finish_with_gaps"
          : candidateTrajectory === "stuck"
            ? "likely_stall"
            : "likely_fail";

  const interruptionCost =
    flowState?.muteUntilPause ||
    currentStage === "IMPLEMENTATION" ||
    (editorTelemetry?.activeCoding && editorTelemetry.editVelocity === "high")
      ? "high"
      : candidateTrajectory === "stuck" || candidateTrajectory === "collapsing"
        ? "low"
        : "medium";

  const evidenceGainIfAskNow =
    intent.intent === "close"
      ? "low"
      : intent.intent === "advance"
        ? "low"
        : memory.missingEvidence.length >= 2 || latestExecutionRun?.status === "FAILED"
          ? "high"
          : intent.intent === "validate" || intent.intent === "probe"
            ? "medium"
            : "low";

  const interventionValue =
    candidateTrajectory === "collapsing" || candidateTrajectory === "stuck"
      ? "high"
      : candidateTrajectory === "plateauing"
        ? "medium"
        : evidenceGainIfAskNow === "high"
          ? "medium"
          : "low";

  const bestIntervention =
    intent.intent === "close"
      ? "close_topic"
      : intent.intent === "advance"
        ? "move_to_implementation"
        : latestExecutionRun && latestExecutionRun.status !== "PASSED"
          ? memory.recentFailedRuns >= 2
            ? "give_rescue_hint"
            : "ask_specific_followup"
          : memory.missingEvidence.includes("exact_test_outputs")
            ? "ask_for_test_case"
            : memory.missingEvidence.includes("constraint_tradeoff")
              ? "ask_for_complexity"
              : candidateTrajectory === "steady_progress"
                ? "none"
                : candidateTrajectory === "plateauing"
                  ? "give_light_hint"
                  : "ask_specific_followup";

  return {
    candidateTrajectory,
    expectedWithNoIntervention,
    interventionValue,
    bestIntervention,
    interruptionCost,
    evidenceGainIfAskNow,
    confidence: Math.max(0.45, Math.min(0.95, signals.confidence ?? 0.7)),
    weakSignalNotes,
  };
}

function readLatestEditorTelemetry(recentEvents?: RecentEventLike[]) {
  const payload = [...(recentEvents ?? [])]
    .reverse()
    .find((event) => event.eventType === "EDITOR_ACTIVITY_RECORDED")?.payloadJson;

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const deletionRatio = typeof record.deletionRatio === "number" ? record.deletionRatio : 0;
  const pauseMs = typeof record.pauseMs === "number" ? record.pauseMs : 0;
  const editCount = typeof record.editCount === "number" ? record.editCount : 0;
  const activeCoding = record.activeCoding === true;
  const struggleLevel =
    activeCoding && deletionRatio >= 0.3 && pauseMs >= 2200
      ? "high"
      : activeCoding && (deletionRatio >= 0.18 || pauseMs >= 1800)
        ? "medium"
        : "low";
  const editVelocity = editCount >= 6 ? "high" : editCount >= 3 ? "medium" : "low";

  return {
    activeCoding,
    deletionRatio,
    pauseMs,
    editCount,
    struggleLevel,
    editVelocity,
  };
}
