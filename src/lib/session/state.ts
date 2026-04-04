import { assessFlowState, type FlowState } from "@/lib/assistant/flow_state";
import { assessLatentCalibration, type LatentCalibration } from "@/lib/assistant/latent_calibration";
import { buildMemoryLedger, type MemoryLedger } from "@/lib/assistant/memory_ledger";
import { describeCodingStage, isCodingInterviewStage, type CodingInterviewStage } from "@/lib/assistant/stages";

type SessionEventLike = {
  id?: string;
  eventType: string;
  eventTime?: Date | string;
  payloadJson?: unknown;
};

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

type CandidateSnapshotRow = {
  id: string;
  stage: string | null;
  source: string | null;
  snapshotJson: unknown;
  createdAt: Date | string;
};

type DecisionSnapshotRow = {
  id: string;
  stage: string | null;
  source: string | null;
  decisionJson: unknown;
  createdAt: Date | string;
};

type IntentSnapshotRow = {
  id: string;
  stage: string | null;
  source: string | null;
  intentJson: unknown;
  createdAt: Date | string;
};

type TrajectorySnapshotRow = {
  id: string;
  stage: string | null;
  source: string | null;
  trajectoryJson: unknown;
  createdAt: Date | string;
};

export type SessionSnapshotState = {
  currentStage: CodingInterviewStage;
  currentStageLabel: string;
  stageJourney: string[];
  latestSignals: Record<string, unknown> | null;
  latestDecision: Record<string, unknown> | null;
  latestIntent: Record<string, unknown> | null;
  latestTrajectory: Record<string, unknown> | null;
  latentCalibration: LatentCalibration | null;
  flowState: FlowState | null;
  ledger: MemoryLedger | null;
  signalSnapshots: Array<{
    id: string;
    stage: string;
    label: string;
    source: string | null;
    createdAt: string;
    signals: Record<string, unknown>;
  }>;
  decisionSnapshots: Array<{
    id: string;
    stage: string;
    label: string;
    source: string | null;
    createdAt: string;
    decision: Record<string, unknown>;
  }>;
  intentSnapshots: Array<{
    id: string;
    stage: string;
    label: string;
    source: string | null;
    createdAt: string;
    intent: Record<string, unknown>;
  }>;
  trajectorySnapshots: Array<{
    id: string;
    stage: string;
    label: string;
    source: string | null;
    createdAt: string;
    trajectory: Record<string, unknown>;
  }>;
};

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeStage(stage: string | null | undefined): CodingInterviewStage {
  return isCodingInterviewStage(stage) ? stage : "PROBLEM_UNDERSTANDING";
}

function deriveStageJourney(input: {
  fallbackCurrentStage: CodingInterviewStage;
  signalSnapshots: Array<{ stage: CodingInterviewStage }>;
  decisionSnapshots: Array<{ stage: CodingInterviewStage }>;
  events: SessionEventLike[];
}) {
  const snapshotStages = [
    ...input.signalSnapshots.map((item) => item.stage),
    ...input.decisionSnapshots.map((item) => item.stage),
  ];

  const orderedUniqueSnapshotStages = snapshotStages.filter(
    (stage, index) => snapshotStages.indexOf(stage) === index,
  );

  if (orderedUniqueSnapshotStages.length > 0) {
    return orderedUniqueSnapshotStages;
  }

  const eventStages = input.events
    .filter((event) => event.eventType === "STAGE_ADVANCED")
    .map((event) => normalizeStage(asRecord(event.payloadJson).stage as string | null | undefined))
    .filter((stage, index, stages) => stages.indexOf(stage) === index);

  if (eventStages.length > 0) {
    return eventStages;
  }

  return [input.fallbackCurrentStage];
}

function latestExecutionRunFromEvents(events: SessionEventLike[], executionRuns?: ExecutionRunLike[] | null) {
  if (executionRuns && executionRuns.length > 0) {
    return executionRuns.at(-1) ?? null;
  }

  const latestCodeRunEvent = [...events]
    .reverse()
    .find((event) => event.eventType === "CODE_RUN_COMPLETED");
  if (!latestCodeRunEvent) {
    return null;
  }

  const payload = asRecord(latestCodeRunEvent.payloadJson);
  const status = payload.status;
  if (
    status !== "PASSED" &&
    status !== "FAILED" &&
    status !== "ERROR" &&
    status !== "TIMEOUT"
  ) {
    return null;
  }

  return {
    status,
    stdout: typeof payload.stdout === "string" ? payload.stdout : null,
    stderr: typeof payload.stderr === "string" ? payload.stderr : null,
  } as const;
}

export function buildSessionSnapshotState(input: {
  currentStage?: string | null;
  events: SessionEventLike[];
  candidateStateSnapshots?: CandidateSnapshotRow[];
  interviewerDecisionSnapshots?: DecisionSnapshotRow[];
  intentSnapshots?: IntentSnapshotRow[];
  trajectorySnapshots?: TrajectorySnapshotRow[];
  executionRuns?: ExecutionRunLike[] | null;
}) : SessionSnapshotState {
  const fallbackCurrentStage = normalizeStage(input.currentStage);
  const signalSnapshots = (input.candidateStateSnapshots ?? [])
    .map((row) => ({
      id: row.id,
      stage: normalizeStage(row.stage),
      label: describeCodingStage(normalizeStage(row.stage)),
      source: row.source ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      signals: asRecord(row.snapshotJson),
    }))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  const decisionSnapshots = (input.interviewerDecisionSnapshots ?? [])
    .map((row) => ({
      id: row.id,
      stage: normalizeStage(row.stage),
      label: describeCodingStage(normalizeStage(row.stage)),
      source: row.source ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      decision: asRecord(row.decisionJson),
    }))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const intentSnapshots = (input.intentSnapshots ?? [])
    .map((row) => ({
      id: row.id,
      stage: normalizeStage(row.stage),
      label: describeCodingStage(normalizeStage(row.stage)),
      source: row.source ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      intent: asRecord(row.intentJson),
    }))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const trajectorySnapshots = (input.trajectorySnapshots ?? [])
    .map((row) => ({
      id: row.id,
      stage: normalizeStage(row.stage),
      label: describeCodingStage(normalizeStage(row.stage)),
      source: row.source ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      trajectory: asRecord(row.trajectoryJson),
    }))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  const stageJourney = deriveStageJourney({
    fallbackCurrentStage,
    signalSnapshots,
    decisionSnapshots,
    events: input.events,
  });
  const currentStage = stageJourney.at(-1) ?? fallbackCurrentStage;

  const latestSignals =
    signalSnapshots.at(-1)?.signals ??
    asRecord(
      asRecord(
        [...input.events].reverse().find((event) => event.eventType === "SIGNAL_SNAPSHOT_RECORDED")?.payloadJson,
      ).signals,
    ) ??
    null;

  const latestDecision =
    decisionSnapshots.at(-1)?.decision ??
    asRecord(
      asRecord(
        [...input.events].reverse().find((event) => event.eventType === "DECISION_RECORDED")?.payloadJson,
      ).decision,
    ) ??
    null;
  const latestIntent = intentSnapshots.at(-1)?.intent ?? null;
  const latestTrajectory = trajectorySnapshots.at(-1)?.trajectory ?? null;

  const latestExecutionRun = latestExecutionRunFromEvents(input.events, input.executionRuns);
  const ledger =
    latestSignals && Object.keys(latestSignals).length > 0
      ? buildMemoryLedger({
          currentStage,
          recentEvents: input.events.map((event) => ({
            eventType: event.eventType,
            payloadJson: event.payloadJson,
          })),
          signals: latestSignals as never,
          latestExecutionRun,
        })
      : null;

  const latentCalibration =
    latestSignals && ledger
      ? assessLatentCalibration({
          signals: latestSignals as never,
          ledger,
          latestExecutionRun,
        })
      : null;

  const flowState =
    latestSignals && ledger
      ? assessFlowState({
          currentStage,
          signals: latestSignals as never,
          recentTranscripts: [],
        })
      : null;

  return {
    currentStage,
    currentStageLabel: describeCodingStage(currentStage),
    stageJourney: stageJourney.map((stage) => describeCodingStage(stage)),
    latestSignals: latestSignals && Object.keys(latestSignals).length > 0 ? latestSignals : null,
    latestDecision: latestDecision && Object.keys(latestDecision).length > 0 ? latestDecision : null,
    latestIntent: latestIntent && Object.keys(latestIntent).length > 0 ? latestIntent : null,
    latestTrajectory: latestTrajectory && Object.keys(latestTrajectory).length > 0 ? latestTrajectory : null,
    latentCalibration,
    flowState,
    ledger,
    signalSnapshots,
    decisionSnapshots,
    intentSnapshots,
    trajectorySnapshots,
  };
}
