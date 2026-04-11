import { prisma } from "@/lib/db";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import { assessLatentCalibration, type LatentCalibration } from "@/lib/assistant/latent_calibration";
import { assessFlowState, type FlowState } from "@/lib/assistant/flow_state";
import { summarizeSessionCritic, type SessionCriticSummary } from "@/lib/assistant/session_critic";
import { summarizeTranscriptTruth, type TranscriptTruthSummary } from "@/lib/session/commit-arbiter";
import { buildSessionSnapshotState } from "@/lib/session/state";
import {
  readCandidateStateSnapshots,
  readInterviewerDecisionSnapshots,
  readIntentSnapshots,
  readTrajectorySnapshots,
} from "@/lib/session/snapshots";
import { describeCodingStage, isCodingInterviewStage } from "@/lib/assistant/stages";
import { getPersonaJobSnapshot, type PersonaJobSnapshot } from "@/lib/persona/queue";

export type OpsFeedScope = "all" | "persona" | "session";

export type AdminProfileListItem = {
  id: string;
  sourceUrl: string;
  sourceType: string;
  status: string;
  fetchStatus: string;
  personaSummary: string | null;
  currentRole: string | null;
  currentCompany: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UnifiedOpsEvent = {
  id: string;
  source: "persona" | "session";
  eventType: string;
  createdAt: string;
  title: string;
  description: string;
  payloadJson: unknown;
  sessionId?: string;
  interviewerProfileId?: string;
};

export type AdminProfileDetail = {
  profile: AdminProfileListItem;
  job: PersonaJobSnapshot | null;
  personaEvents: UnifiedOpsEvent[];
  sessionEvents: UnifiedOpsEvent[];
  sessionSummary: SessionSummary | null;
};

export type SessionSummary = {
  sessionId: string;
  currentStage: string;
  currentStageLabel: string;
  stageJourney: string[];
  latestSignals: Record<string, unknown> | null;
  latestDecision: Record<string, unknown> | null;
  latestIntent: Record<string, unknown> | null;
  latestTrajectory: Record<string, unknown> | null;
  latestCandidateDna: Record<string, unknown> | null;
  latestShadowPolicy: Record<string, unknown> | null;
  latestCritic: Record<string, unknown> | null;
  sessionCritic: SessionCriticSummary | null;
  latentCalibration: LatentCalibration | null;
  flowState: FlowState | null;
  answeredTargets: string[];
  collectedEvidence: string[];
  unresolvedIssues: string[];
  missingEvidence: string[];
  evidenceFocus: string | null;
  latestCodeRunStatus: string | null;
  hintCount: number;
  failedRunCount: number;
  transcriptTruth: TranscriptTruthSummary | null;
  timeline: SessionTimelineItem[];
};

export type SessionTimelineItem = {
  id: string;
  kind: "stage" | "signal" | "decision" | "reward" | "intent" | "trajectory" | "critic" | "hint" | "code_run" | "transcript";
  at: string;
  title: string;
  summary: string;
  timingVerdict?: string | null;
  urgency?: string | null;
  interruptionCost?: string | null;
  batchGroup?: string | null;
  temporalProbeStreak?: number | null;
  temporalProbeDecay?: number | null;
  temporalIdleLikely?: boolean | null;
  temporalIdleProbeBoost?: number | null;
  temporalCodingInterruptionPenalty?: number | null;
  answeredTargets?: string[];
  collectedEvidence?: string[];
  unresolvedIssues?: string[];
  missingEvidence?: string[];
  evidenceFocus?: string | null;
  intent?: string | null;
  intentTargetSignal?: string | null;
  expectedOutcome?: string | null;
  candidateTrajectory?: string | null;
  expectedWithNoIntervention?: string | null;
  interventionValue?: string | null;
  bestIntervention?: string | null;
  expectedEvidenceGain?: string | null;
  policyArchetype?: string | null;
  policyMode?: string | null;
  policyAdaptationReason?: string | null;
  blockedByInvariant?: string | null;
  decisionPathway?: string[];
  normalizedAction?: string | null;
  totalScore?: number | null;
  tieBreaker?: string | null;
  scoreBreakdown?: Array<{ key?: string; magnitude?: number; kind?: string; detail?: string }>;
  candidateScores?: Array<{ action?: string; totalScore?: number; hardMasked?: boolean }>;
  justificationWhyNow?: string | null;
  justificationWhyThisAction?: string | null;
  supportingSignals?: string[];
  competingIntents?: Array<{ intent?: string; reason?: string; score?: number }>;
  autoCapturedEvidence?: string[];
  candidateCeiling?: string | null;
  easeOfExecution?: string | null;
  levelUpReady?: boolean | null;
  confidenceInVerdict?: number | null;
  codingBurst?: boolean | null;
  thinkingBurst?: boolean | null;
  muteUntilPause?: boolean | null;
  contextReestablishmentCost?: string | null;
  wouldLikelySelfCorrect?: boolean | null;
  shouldWaitBeforeIntervening?: boolean | null;
  selfCorrectionWindowSeconds?: number | null;
  payload: Record<string, unknown>;
};

export async function listAdminProfiles(limit = 20): Promise<AdminProfileListItem[]> {
  const profiles = await prisma.interviewerProfile.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return profiles.map((profile) => ({
    id: profile.id,
    sourceUrl: profile.sourceUrl,
    sourceType: profile.sourceType,
    status: profile.status,
    fetchStatus: profile.fetchStatus,
    personaSummary: profile.personaSummary,
    currentRole: profile.currentRole,
    currentCompany: profile.currentCompany,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  }));
}

export async function getAdminProfileDetail(profileId: string): Promise<AdminProfileDetail | null> {
  const profile = await prisma.interviewerProfile.findUnique({
    where: { id: profileId },
    include: {
      jobEvents: {
        orderBy: { createdAt: "desc" },
        take: 30,
      },
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          transcripts: {
            orderBy: { segmentIndex: "asc" },
          },
          events: {
            orderBy: { eventTime: "desc" },
            take: 40,
          },
        },
      },
    },
  });

  if (!profile) {
    return null;
  }

  const job = await getPersonaJobSnapshot(profile.id);

  const personaEvents: UnifiedOpsEvent[] = profile.jobEvents.map((event) => ({
    id: event.id,
    source: "persona",
    eventType: event.eventType,
    createdAt: event.createdAt.toISOString(),
    title: prettifyEventType(event.eventType),
    description: buildPersonaEventDescription(event.eventType, event.payloadJson),
    payloadJson: event.payloadJson,
    interviewerProfileId: profile.id,
  }));

  const sessionEvents: UnifiedOpsEvent[] = profile.sessions.flatMap((session) =>
    session.events.map((event) => ({
      id: event.id,
      source: "session",
      eventType: event.eventType,
      createdAt: event.eventTime.toISOString(),
      title: prettifyEventType(event.eventType),
      description: buildSessionEventDescription(event.eventType, event.payloadJson),
      payloadJson: event.payloadJson,
      sessionId: session.id,
      interviewerProfileId: profile.id,
    })),
  );
  const latestSession = profile.sessions[0] ?? null;
  const latestSessionSnapshotData = latestSession
    ? await Promise.all([
        readCandidateStateSnapshots(latestSession.id),
        readInterviewerDecisionSnapshots(latestSession.id),
        readIntentSnapshots(latestSession.id),
        readTrajectorySnapshots(latestSession.id),
        prisma.executionRun.findMany({
          where: { sessionId: latestSession.id },
          orderBy: { createdAt: "asc" },
          take: 10,
        }),
        prisma.sessionEvent.findMany({
          where: {
            sessionId: latestSession.id,
            eventType: "CANDIDATE_TRANSCRIPT_REFINED",
          },
          orderBy: { eventTime: "asc" },
        }),
      ])
    : null;

  return {
    profile: {
      id: profile.id,
      sourceUrl: profile.sourceUrl,
      sourceType: profile.sourceType,
      status: profile.status,
      fetchStatus: profile.fetchStatus,
      personaSummary: profile.personaSummary,
      currentRole: profile.currentRole,
      currentCompany: profile.currentCompany,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    },
    job,
    personaEvents,
    sessionEvents,
    sessionSummary:
      latestSession && latestSessionSnapshotData
        ? summarizeSession({
            ...latestSession,
            candidateStateSnapshots: latestSessionSnapshotData[0],
            interviewerDecisionSnapshots: latestSessionSnapshotData[1],
            intentSnapshots: latestSessionSnapshotData[2],
            trajectorySnapshots: latestSessionSnapshotData[3],
            executionRuns: latestSessionSnapshotData[4],
            transcriptTruthEvents: latestSessionSnapshotData[5],
          })
        : null,
  };
}

export function buildUnifiedOpsFeed(
  detail: AdminProfileDetail | null,
  scope: OpsFeedScope,
): UnifiedOpsEvent[] {
  if (!detail) {
    return [];
  }

  const combined =
    scope === "persona"
      ? detail.personaEvents
      : scope === "session"
        ? detail.sessionEvents
        : [...detail.personaEvents, ...detail.sessionEvents];

  return combined.sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function prettifyEventType(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildPersonaEventDescription(eventType: string, payloadJson: unknown) {
  const payload = asRecord(payloadJson);

  if (eventType === "JOB_ENQUEUED") {
    return `Queued persona ingestion with job ${stringOrFallback(payload.jobId, "unknown")}.`;
  }

  if (eventType === "JOB_RETRY_SCHEDULED") {
    return `Retry scheduled after failure: ${stringOrFallback(payload.failedReason, "unknown reason")}`;
  }

  if (eventType === "JOB_FAILED") {
    return `Final persona ingestion failure: ${stringOrFallback(payload.failedReason, "unknown reason")}`;
  }

  if (eventType === "JOB_COMPLETED") {
    return `Persona preparation completed after ${stringOrFallback(payload.attemptsMade, "0")} attempt(s).`;
  }

  if (eventType === "JOB_PROCESSING_STARTED") {
    return `Worker started processing the public profile.`;
  }

  return "Persona pipeline event recorded.";
}

function summarizeSession(session: {
  id: string;
  events: Array<{ eventType: string; eventTime: Date; payloadJson: unknown }>;
  transcripts: Array<{ id?: string; speaker: "USER" | "AI" | "SYSTEM"; text: string; segmentIndex: number; isFinal: boolean }>;
  candidateStateSnapshots: Array<{ id: string; stage: string | null; source: string | null; snapshotJson: unknown; createdAt: Date }>;
  interviewerDecisionSnapshots: Array<{ id: string; stage: string | null; source: string | null; decisionJson: unknown; createdAt: Date }>;
  intentSnapshots: Array<{ id: string; stage: string | null; source: string | null; intentJson: unknown; createdAt: Date }>;
  trajectorySnapshots: Array<{ id: string; stage: string | null; source: string | null; trajectoryJson: unknown; createdAt: Date }>;
  executionRuns: Array<{ status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT"; stdout: string | null; stderr: string | null; createdAt: Date }>;
  transcriptTruthEvents: Array<{ eventType: string; eventTime: Date; payloadJson: unknown }>;
}): SessionSummary {
  const ordered = [...session.events].sort((left, right) => left.eventTime.getTime() - right.eventTime.getTime());
  const truthEvents = [...ordered, ...session.transcriptTruthEvents].sort(
    (left, right) => left.eventTime.getTime() - right.eventTime.getTime(),
  );
  const latestCriticEvent = [...ordered].reverse().find((event) => event.eventType === "CRITIC_VERDICT_RECORDED");
  const latestCodeRunEvent = [...ordered].reverse().find((event) => event.eventType === "CODE_RUN_COMPLETED");
  const latestCandidateDnaEvent = [...ordered].reverse().find((event) => event.eventType === "CANDIDATE_DNA_RECORDED");
  const latestShadowPolicyEvent = [...ordered].reverse().find((event) => event.eventType === "SHADOW_POLICY_EVALUATED");
  const latestCritic = latestCriticEvent ? asRecord(asRecord(latestCriticEvent.payloadJson).criticVerdict) : null;
  const latestCandidateDna = latestCandidateDnaEvent
    ? asRecord(asRecord(latestCandidateDnaEvent.payloadJson).candidateDna)
    : null;
  const latestShadowPolicy = latestShadowPolicyEvent
    ? asRecord(asRecord(latestShadowPolicyEvent.payloadJson).shadowPolicy)
    : null;
  const hintCount = ordered.filter((event) => event.eventType === "HINT_SERVED").length;
  const failedRunCount = ordered.filter((event) => {
    if (event.eventType !== "CODE_RUN_COMPLETED") {
      return false;
    }

    const status = stringValue(asRecord(event.payloadJson).status);
    return status === "FAILED" || status === "ERROR" || status === "TIMEOUT";
  }).length;

  const snapshotState = buildSessionSnapshotState({
    currentStage:
      stringValue(asRecord(latestCodeRunEvent?.payloadJson).stage) ??
      stringValue(asRecord([...ordered].reverse().find((event) => event.eventType === "STAGE_ADVANCED")?.payloadJson).stage) ??
      "PROBLEM_UNDERSTANDING",
    events: ordered,
    candidateStateSnapshots: session.candidateStateSnapshots,
    interviewerDecisionSnapshots: session.interviewerDecisionSnapshots,
    intentSnapshots: session.intentSnapshots,
    trajectorySnapshots: session.trajectorySnapshots,
    executionRuns: session.executionRuns,
  });
  const sessionCritic = summarizeSessionCritic({
    events: ordered,
    latestSignals: snapshotState.latestSignals,
  });
  const transcriptTruth = summarizeTranscriptTruth(session.transcripts, truthEvents);

  return {
    sessionId: session.id,
    currentStage: snapshotState.currentStage,
    currentStageLabel: snapshotState.currentStageLabel,
    stageJourney: snapshotState.stageJourney,
    latestSignals: snapshotState.latestSignals,
    latestDecision: snapshotState.latestDecision,
    latestIntent: snapshotState.latestIntent,
    latestTrajectory: snapshotState.latestTrajectory,
    latestCandidateDna,
    latestShadowPolicy,
    latestCritic,
    sessionCritic,
    latentCalibration: snapshotState.latentCalibration,
    flowState: snapshotState.flowState,
    answeredTargets: snapshotState.ledger?.answeredTargets ?? [],
    collectedEvidence: snapshotState.ledger?.collectedEvidence ?? [],
    unresolvedIssues: snapshotState.ledger?.unresolvedIssues ?? [],
    missingEvidence: snapshotState.ledger?.missingEvidence ?? [],
    evidenceFocus: snapshotState.latestDecision
      ? stringValue(asRecord(snapshotState.latestDecision).specificIssue) ?? stringValue(asRecord(snapshotState.latestDecision).target)
      : null,
    latestCodeRunStatus: latestCodeRunEvent ? stringValue(asRecord(latestCodeRunEvent.payloadJson).status) : null,
    hintCount,
    failedRunCount,
    transcriptTruth,
    timeline: buildSessionTimeline(truthEvents),
  };
}

function buildSessionTimeline(
  events: Array<{ eventType: string; eventTime: Date; payloadJson: unknown }>,
): SessionTimelineItem[] {
  return events
    .filter((event) =>
      [
        "STAGE_ADVANCED",
        "CANDIDATE_TRANSCRIPT_REFINED",
        "SIGNAL_SNAPSHOT_RECORDED",
        "DECISION_RECORDED",
        "REWARD_RECORDED",
        "INTENT_SNAPSHOT_RECORDED",
        "TRAJECTORY_SNAPSHOT_RECORDED",
        "CANDIDATE_DNA_RECORDED",
        "SHADOW_POLICY_EVALUATED",
        "CANDIDATE_ECHO_DETECTED",
        "ECHO_RECOVERY_PROMPTED",
        "CRITIC_VERDICT_RECORDED",
        "HINT_SERVED",
        "CODE_RUN_COMPLETED",
      ].includes(event.eventType),
    )
    .map((event) => {
      const payload = asRecord(event.payloadJson);

      if (event.eventType === "STAGE_ADVANCED") {
        const previousStage = describeStage(payload.previousStage);
        const stage = describeStage(payload.stage) ?? "Unknown stage";
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "stage" as const,
          at: event.eventTime.toISOString(),
          title: "Stage advanced",
          summary: previousStage ? `${previousStage} -> ${stage}` : stage,
          payload,
        };
      }

      if (event.eventType === "CANDIDATE_TRANSCRIPT_REFINED") {
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "transcript" as const,
          at: event.eventTime.toISOString(),
          title: "Transcript corrected",
          summary: `Committed truth updated${stringValue(payload.transcriptVersion) ? ` to v${stringValue(payload.transcriptVersion)}` : ""}${stringValue(payload.correctionOfId) ? `, replacing ${stringValue(payload.correctionOfId)}` : ""}${stringValue(payload.transcriptSegmentId) ? ` with ${stringValue(payload.transcriptSegmentId)}` : ""}.`,
          payload,
        };
      }

      if (event.eventType === "SIGNAL_SNAPSHOT_RECORDED") {
        const signals = asRecord(payload.signals);
        const structuredEvidence = Array.isArray(signals.structuredEvidence) ? signals.structuredEvidence : [];
        const primaryIssue = structuredEvidence.find((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).issue === "string") as Record<string, unknown> | undefined;
        const signalStageRaw = stringValue(payload.stage);
        const signalStage = isCodingInterviewStage(signalStageRaw) ? signalStageRaw : "PROBLEM_UNDERSTANDING";
        const signalLedger = buildMemoryLedger({
          currentStage: signalStage,
          recentEvents: events
            .filter((candidate) => candidate.eventTime.getTime() <= event.eventTime.getTime())
            .map((candidate) => ({
              eventType: candidate.eventType,
              payloadJson: candidate.payloadJson,
            })),
          signals: signals as never,
          latestExecutionRun: null,
        });
        const calibration = assessLatentCalibration({
          signals: signals as never,
          ledger: signalLedger,
          latestExecutionRun: null,
        });
        const flowState = assessFlowState({
          currentStage: signalStage,
          signals: signals as never,
          recentTranscripts: [],
        });
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "signal" as const,
          at: event.eventTime.toISOString(),
          title: "Candidate state snapshot",
          summary: primaryIssue?.issue
            ? `Issue spotted: ${String(primaryIssue.issue)}`
            : `understanding=${stringOrFallback(signals.understanding, "unknown")}, progress=${stringOrFallback(signals.progress, "unknown")}, quality=${stringOrFallback(signals.codeQuality, "unknown")}`,
          unresolvedIssues: signalLedger.unresolvedIssues,
          missingEvidence: signalLedger.missingEvidence,
          answeredTargets: signalLedger.answeredTargets,
          collectedEvidence: signalLedger.collectedEvidence,
          candidateCeiling: calibration.candidateCeiling,
          easeOfExecution: calibration.easeOfExecution,
          levelUpReady: calibration.levelUpReady,
          confidenceInVerdict: calibration.confidenceInVerdict,
          codingBurst: flowState.codingBurst,
          thinkingBurst: flowState.thinkingBurst,
          muteUntilPause: flowState.muteUntilPause,
          contextReestablishmentCost: flowState.contextReestablishmentCost,
          payload,
        };
      }

      if (event.eventType === "DECISION_RECORDED") {
        const decision = asRecord(payload.decision);
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "decision" as const,
          at: event.eventTime.toISOString(),
          title: "Interviewer decision",
          summary: `${stringOrFallback(decision.action, "unknown action")} -> ${stringOrFallback(decision.target, "unknown target")}`,
          timingVerdict: stringValue(decision.canDefer) === "true" ? "defer-capable" : null,
          urgency: stringValue(decision.urgency),
          interruptionCost: stringValue(decision.interruptionCost),
          batchGroup: stringValue(decision.batchGroup),
          temporalProbeStreak: typeof decision.temporalProbeStreak === "number" ? decision.temporalProbeStreak : null,
          temporalProbeDecay: typeof decision.temporalProbeDecay === "number" ? decision.temporalProbeDecay : null,
          temporalIdleLikely: typeof decision.temporalIdleLikely === "boolean" ? decision.temporalIdleLikely : null,
          temporalIdleProbeBoost:
            typeof decision.temporalIdleProbeBoost === "number" ? decision.temporalIdleProbeBoost : null,
          temporalCodingInterruptionPenalty:
            typeof decision.temporalCodingInterruptionPenalty === "number"
              ? decision.temporalCodingInterruptionPenalty
              : null,
          policyArchetype: stringValue(decision.policyArchetype),
          policyMode: stringValue(decision.policyMode),
          policyAdaptationReason: stringValue(decision.policyAdaptationReason),
          blockedByInvariant: stringValue(decision.blockedByInvariant),
          decisionPathway: Array.isArray(decision.decisionPathway)
            ? decision.decisionPathway.filter((item): item is string => typeof item === "string")
            : [],
          normalizedAction: stringValue(decision.normalizedAction),
          totalScore: typeof decision.totalScore === "number" ? decision.totalScore : null,
          tieBreaker: stringValue(decision.tieBreaker),
          scoreBreakdown: Array.isArray(decision.scoreBreakdown)
            ? decision.scoreBreakdown
                .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
                .map((item) => ({
                  key: stringValue(item.key) ?? undefined,
                  magnitude: typeof item.magnitude === "number" ? item.magnitude : undefined,
                  kind: stringValue(item.kind) ?? undefined,
                  detail: stringValue(item.detail) ?? undefined,
                }))
            : [],
          candidateScores: Array.isArray(decision.candidateScores)
            ? decision.candidateScores
                .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
                .map((item) => ({
                  action: stringValue(item.action) ?? undefined,
                  totalScore: typeof item.totalScore === "number" ? item.totalScore : undefined,
                  hardMasked: item.hardMasked === true,
                }))
            : [],
          justificationWhyNow: stringValue(decision.justificationWhyNow),
          justificationWhyThisAction: stringValue(decision.justificationWhyThisAction),
          supportingSignals: Array.isArray(decision.supportingSignals)
            ? decision.supportingSignals.filter((item): item is string => typeof item === "string")
            : [],
          evidenceFocus: stringValue(decision.specificIssue) ?? stringValue(decision.target),
          answeredTargets: [],
          collectedEvidence: [],
          payload,
        };
      }

      if (event.eventType === "REWARD_RECORDED") {
        const reward = asRecord(payload.reward);
        const components = asRecord(reward.components);
        const total = typeof reward.total === "number" ? reward.total.toFixed(2) : "n/a";
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "reward" as const,
          at: event.eventTime.toISOString(),
          title: "Turn reward",
          summary: `total=${total}, evidence=${stringOrFallback(components.evidenceGain, "0")}, redundancy=${stringOrFallback(components.redundancy, "0")}`,
          payload,
        };
      }

      if (event.eventType === "INTENT_SNAPSHOT_RECORDED") {
        const intent = asRecord(payload.intent);
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "intent" as const,
          at: event.eventTime.toISOString(),
          title: "Interviewer intent",
          summary: `${stringOrFallback(intent.intent, "intent")} -> ${stringOrFallback(intent.expectedOutcome, "unknown outcome")}`,
          urgency: stringValue(intent.urgency),
          intent: stringValue(intent.intent),
          intentTargetSignal: stringValue(intent.targetSignal),
          expectedOutcome: stringValue(intent.expectedOutcome),
          competingIntents: Array.isArray(intent.competingIntents)
            ? intent.competingIntents
                .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
                .map((item) => ({
                  intent: stringValue(item.intent) ?? undefined,
                  reason: stringValue(item.reason) ?? undefined,
                  score: typeof item.score === "number" ? item.score : undefined,
                }))
            : [],
          payload,
        };
      }

      if (event.eventType === "CANDIDATE_ECHO_DETECTED") {
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "signal" as const,
          at: event.eventTime.toISOString(),
          title: "Candidate echo detected",
          summary: `echo=${stringOrFallback(payload.echoStrength, "unknown")} overlap=${stringOrFallback(payload.echoOverlapRatio, "0")}`,
          payload,
        };
      }

      if (event.eventType === "ECHO_RECOVERY_PROMPTED") {
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "decision" as const,
          at: event.eventTime.toISOString(),
          title: "Echo recovery prompted",
          summary: `${stringOrFallback(payload.mode, "unknown")} attempt ${stringOrFallback(payload.attempt, "1")}`,
          payload,
        };
      }

      if (event.eventType === "TRAJECTORY_SNAPSHOT_RECORDED") {
        const trajectory = asRecord(payload.trajectory);
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "trajectory" as const,
          at: event.eventTime.toISOString(),
          title: "Trajectory estimate",
          summary: `${stringOrFallback(trajectory.candidateTrajectory, "trajectory")} / ${stringOrFallback(trajectory.bestIntervention, "unknown intervention")}`,
          interruptionCost: stringValue(trajectory.interruptionCost),
          candidateTrajectory: stringValue(trajectory.candidateTrajectory),
          expectedWithNoIntervention: stringValue(trajectory.expectedWithNoIntervention),
          interventionValue: stringValue(trajectory.interventionValue),
          bestIntervention: stringValue(trajectory.bestIntervention),
          expectedEvidenceGain: stringValue(trajectory.evidenceGainIfAskNow),
          payload,
        };
      }

        if (event.eventType === "CRITIC_VERDICT_RECORDED") {
          const criticVerdict = asRecord(payload.criticVerdict);
          const autoCapturedEvidence = Array.isArray(criticVerdict.autoCapturedEvidence)
            ? criticVerdict.autoCapturedEvidence.filter((item): item is string => typeof item === "string")
            : [];
          const selfCorrectionWindowSeconds =
            typeof criticVerdict.selfCorrectionWindowSeconds === "number"
              ? criticVerdict.selfCorrectionWindowSeconds
              : null;
          const summaryBits = [
            `${stringOrFallback(criticVerdict.verdict, "verdict")} / ${stringOrFallback(criticVerdict.reason, "unknown reason")}`,
            typeof criticVerdict.questionWorthAsking === "boolean"
              ? `worth=${criticVerdict.questionWorthAsking ? "yes" : "no"}`
              : null,
            autoCapturedEvidence.length > 0
              ? `auto-captured=${autoCapturedEvidence.join(", ")}`
              : null,
            selfCorrectionWindowSeconds
              ? `self-correct=${selfCorrectionWindowSeconds}s`
              : null,
          ].filter(Boolean);
          return {
            id: `${event.eventType}-${event.eventTime.toISOString()}`,
            kind: "critic" as const,
            at: event.eventTime.toISOString(),
            title: "Critic verdict",
            summary: summaryBits.join(" / "),
            timingVerdict: stringValue(criticVerdict.timingVerdict),
            urgency: stringValue(criticVerdict.urgency),
            interruptionCost: stringValue(criticVerdict.interruptionCost),
            batchGroup: stringValue(criticVerdict.batchGroup),
            evidenceFocus: stringValue(criticVerdict.focus) ?? stringValue(criticVerdict.reason),
            autoCapturedEvidence,
            wouldLikelySelfCorrect:
              typeof criticVerdict.wouldLikelySelfCorrect === "boolean"
                ? criticVerdict.wouldLikelySelfCorrect
                : null,
            shouldWaitBeforeIntervening:
              typeof criticVerdict.shouldWaitBeforeIntervening === "boolean"
                ? criticVerdict.shouldWaitBeforeIntervening
                : null,
            selfCorrectionWindowSeconds,
            payload,
          };
        }

      if (event.eventType === "HINT_SERVED") {
        return {
          id: `${event.eventType}-${event.eventTime.toISOString()}`,
          kind: "hint" as const,
          at: event.eventTime.toISOString(),
          title: "Hint served",
          summary: `${stringOrFallback(payload.hintLevel, "LIGHT")} ${stringOrFallback(payload.hintStyle, "hint")}`,
          payload,
        };
      }

      return {
        id: `${event.eventType}-${event.eventTime.toISOString()}`,
        kind: "code_run" as const,
        at: event.eventTime.toISOString(),
        title: "Code run completed",
        summary: stringOrFallback(payload.status, "unknown"),
        payload,
      };
    });
}

export function buildSessionEventDescription(eventType: string, payloadJson: unknown) {
  const payload = asRecord(payloadJson);

  if (eventType === "SESSION_CREATED") {
    return `Session created for ${stringOrFallback(payload.mode, "unknown mode")} interview.`;
  }

  if (eventType === "QUESTION_ASSIGNED") {
    return `Question assigned: ${stringOrFallback(payload.questionTitle, "untitled question")}.`;
  }

  if (eventType === "INTERVIEW_READY") {
    return "Interview room is prepared and ready to begin.";
  }

  if (eventType === "INTERVIEW_ROOM_OPENED") {
    return `Candidate opened the interview room (${stringOrFallback(payload.room, "default room")}).`;
  }

  if (eventType === "LISTENING_STARTED") {
    return `Continuous listening started in ${stringOrFallback(payload.mode, "unknown")} mode.`;
  }

  if (eventType === "LISTENING_STOPPED") {
    return `Continuous listening stopped for ${stringOrFallback(payload.mode, "unknown")} mode.`;
  }

  if (eventType === "QUESTION_SHOWN") {
    return "Interview question was surfaced in the room.";
  }

  if (eventType === "STAGE_ADVANCED") {
    const previousStage = describeStage(payload.previousStage);
    const stage = describeStage(payload.stage);

    if (previousStage && stage) {
      return `Interview advanced from ${previousStage} to ${stage}.`;
    }

    if (stage) {
      return `Interview stage set to ${stage}.`;
    }

    return "Interview stage advanced.";
  }

  if (eventType === "CANDIDATE_SPOKE") {
    const source = stringOrFallback(payload.transcriptSource, "unknown source");
    return `Candidate turn was recorded from ${source}.`;
  }

  if (eventType === "CANDIDATE_TRANSCRIPT_REFINED") {
    const version = stringValue(payload.transcriptVersion);
    const correctionOfId = stringValue(payload.correctionOfId);
    const segmentId = stringValue(payload.transcriptSegmentId);
    const chainBits = [
      version ? `v${version}` : null,
      correctionOfId ? `replaces ${correctionOfId}` : null,
      segmentId ? `active=${segmentId}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `Dedicated STT refined a candidate turn using ${stringOrFallback(payload.transcriptProvider, "unknown provider")}${chainBits ? ` (${chainBits})` : ""}.`;
  }

  if (eventType === "CANDIDATE_TURN_AUTOSUBMITTED") {
    return `Candidate turn auto-submitted after silence (${stringOrFallback(payload.source, "unknown source")}).`;
  }

  if (eventType === "SIGNAL_SNAPSHOT_RECORDED") {
    const signals = asRecord(payload.signals);
    const structuredEvidence = Array.isArray(signals.structuredEvidence) ? signals.structuredEvidence : [];
    const primaryIssue = structuredEvidence.find((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).issue === "string") as Record<string, unknown> | undefined;
    const signalStageRaw = stringValue(payload.stage);
    const signalStage = isCodingInterviewStage(signalStageRaw) ? signalStageRaw : "PROBLEM_UNDERSTANDING";
    const signalLedger = buildMemoryLedger({
      currentStage: signalStage,
      recentEvents: [],
      signals: signals as never,
      latestExecutionRun: null,
    });
    const calibration = assessLatentCalibration({
      signals: signals as never,
      ledger: signalLedger,
      latestExecutionRun: null,
    });
    const flowState = assessFlowState({
      currentStage: signalStage,
      signals: signals as never,
      recentTranscripts: [],
    });
    return primaryIssue?.issue
      ? `Candidate state updated. Primary observed issue: ${String(primaryIssue.issue)}. Ceiling=${calibration.candidateCeiling}, ease=${calibration.easeOfExecution}, flow=${flowState.muteUntilPause ? "mute" : "open"}.`
      : `Candidate state updated: understanding=${stringOrFallback(signals.understanding, "unknown")}, progress=${stringOrFallback(signals.progress, "unknown")}, edge cases=${stringOrFallback(signals.edgeCaseAwareness, "unknown")}, ceiling=${calibration.candidateCeiling}, ease=${calibration.easeOfExecution}.`;
  }

  if (eventType === "DECISION_RECORDED") {
    const decision = asRecord(payload.decision);
    const scoreWeightProfile = asRecord(decision.scoreWeightProfile);
    const timing = [
      stringValue(decision.urgency) ? `urgency=${stringValue(decision.urgency)}` : null,
      stringValue(decision.interruptionCost)
        ? `interruption=${stringValue(decision.interruptionCost)}`
        : null,
      stringValue(decision.batchGroup) ? `batch=${stringValue(decision.batchGroup)}` : null,
      stringValue(decision.policyArchetype) ? `policy=${stringValue(decision.policyArchetype)}` : null,
      stringValue(decision.policyMode) ? `mode=${stringValue(decision.policyMode)}` : null,
      stringValue(decision.blockedByInvariant) ? `blocked=${stringValue(decision.blockedByInvariant)}` : null,
      typeof decision.temporalProbeStreak === "number" ? `probe_streak=${decision.temporalProbeStreak}` : null,
      typeof decision.temporalProbeDecay === "number" ? `probe_decay=${decision.temporalProbeDecay}` : null,
      decision.temporalIdleLikely === true ? "idle=true" : null,
      typeof decision.temporalIdleProbeBoost === "number" ? `idle_probe_boost=${decision.temporalIdleProbeBoost}` : null,
      typeof decision.temporalCodingInterruptionPenalty === "number"
        ? `coding_interrupt_penalty=${decision.temporalCodingInterruptionPenalty}`
        : null,
      stringValue(scoreWeightProfile.dominantActionBias)
        ? `weight_bias=${stringValue(scoreWeightProfile.dominantActionBias)}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `Interviewer decision: ${stringOrFallback(decision.action, "unknown action")} toward ${stringOrFallback(decision.target, "unknown target")}${timing ? ` (${timing})` : ""}.`;
  }

  if (eventType === "REWARD_RECORDED") {
    const reward = asRecord(payload.reward);
    const components = asRecord(reward.components);
    const total = typeof reward.total === "number" ? reward.total.toFixed(2) : "n/a";
    const penalties = Array.isArray(reward.penalties)
      ? reward.penalties.filter((item): item is string => typeof item === "string")
      : [];
    return `Reward v1 recorded: total=${total}, evidence=${stringOrFallback(components.evidenceGain, "0")}, redundancy=${stringOrFallback(components.redundancy, "0")}, interruption=${stringOrFallback(components.badInterruption, "0")}${penalties.length > 0 ? `, penalties=${penalties.join("|")}` : ""}.`;
  }

  if (eventType === "INTENT_SNAPSHOT_RECORDED") {
    const intent = asRecord(payload.intent);
    const competing = Array.isArray(intent.competingIntents)
      ? intent.competingIntents
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => stringValue(item.intent))
          .filter((item): item is string => typeof item === "string")
      : [];
    return `Interviewer intent: ${stringOrFallback(intent.intent, "unknown intent")} targeting ${stringOrFallback(intent.targetSignal, "general signal")} to ${stringOrFallback(intent.expectedOutcome, "collect signal")}${competing.length > 0 ? `. Alternatives considered: ${competing.join(", ")}` : ""}.`;
  }

  if (eventType === "CANDIDATE_ECHO_DETECTED") {
    return `Candidate echo detected: overlap=${stringOrFallback(payload.echoOverlapRatio, "0")}, strength=${stringOrFallback(payload.echoStrength, "unknown")}.`;
  }

  if (eventType === "ECHO_RECOVERY_PROMPTED") {
    return `Echo recovery prompted with ${stringOrFallback(payload.mode, "unknown")} (attempt ${stringOrFallback(payload.attempt, "1")}).`;
  }

  if (eventType === "TRAJECTORY_SNAPSHOT_RECORDED") {
    const trajectory = asRecord(payload.trajectory);
    return `Trajectory estimate: ${stringOrFallback(trajectory.candidateTrajectory, "unknown trajectory")} with ${stringOrFallback(trajectory.bestIntervention, "unknown intervention")} as the best intervention and interruption=${stringOrFallback(trajectory.interruptionCost, "unknown")}.`;
  }

  if (eventType === "CANDIDATE_DNA_RECORDED") {
    const dna = asRecord(payload.candidateDna);
    const mode = stringOrFallback(dna.recommendedMode, "unknown");
    const traits = Array.isArray(dna.dominantTraits) ? dna.dominantTraits.join(", ") : "no traits";
    return `Candidate DNA recorded: mode=${mode}; traits=${traits}.`;
  }

  if (eventType === "SHADOW_POLICY_EVALUATED") {
    const shadow = asRecord(payload.shadowPolicy);
    const archetype = stringOrFallback(shadow.archetype, "unknown");
    const action = stringOrFallback(shadow.action, "unknown");
    const diff = Array.isArray(shadow.diff) ? shadow.diff.join(", ") : "none";
    const topScoreDiff = Array.isArray(shadow.scoreDiff) && shadow.scoreDiff.length > 0
      ? shadow.scoreDiff
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .slice(0, 1)
          .map((item) => {
            const action = stringValue(item.action) ?? "unknown";
            const delta = typeof item.delta === "number" ? item.delta.toFixed(2) : "n/a";
            return `${action}:${delta}`;
          })
          .join(", ")
      : null;
    return `Shadow policy evaluated: ${archetype} would choose ${action}; diff=${diff}${topScoreDiff ? `; score_delta=${topScoreDiff}` : ""}.`;
  }

  if (eventType === "CRITIC_VERDICT_RECORDED") {
    const criticVerdict = asRecord(payload.criticVerdict);
    const timing = [
      stringValue(criticVerdict.timingVerdict) ? `timing=${stringValue(criticVerdict.timingVerdict)}` : null,
      stringValue(criticVerdict.urgency) ? `urgency=${stringValue(criticVerdict.urgency)}` : null,
      stringValue(criticVerdict.interruptionCost)
        ? `interruption=${stringValue(criticVerdict.interruptionCost)}`
        : null,
      stringValue(criticVerdict.batchGroup) ? `batch=${stringValue(criticVerdict.batchGroup)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const autoCapturedEvidence = Array.isArray(criticVerdict.autoCapturedEvidence)
      ? criticVerdict.autoCapturedEvidence.filter((item): item is string => typeof item === "string")
      : [];
    const selfCorrectionWindowSeconds =
      typeof criticVerdict.selfCorrectionWindowSeconds === "number"
        ? criticVerdict.selfCorrectionWindowSeconds
        : null;
    const extras = [
      stringValue(criticVerdict.worthReason) ? String(stringValue(criticVerdict.worthReason)) : null,
      autoCapturedEvidence.length > 0 ? `Auto-captured evidence: ${autoCapturedEvidence.join(", ")}.` : null,
      criticVerdict.shouldWaitBeforeIntervening && selfCorrectionWindowSeconds
        ? `Wait ${selfCorrectionWindowSeconds}s for self-correction before intervening.`
        : criticVerdict.wouldLikelySelfCorrect
          ? `The candidate likely would have self-corrected without interruption.`
          : null,
    ]
      .filter(Boolean)
      .join(" ");
    return `Critic verdict: ${stringOrFallback(criticVerdict.verdict, "unknown verdict")} because ${stringOrFallback(criticVerdict.reason, "unknown reason")}${timing ? ` (${timing})` : ""}${extras ? ` ${extras}` : ""}`;
  }

  if (eventType === "LLM_USAGE_RECORDED") {
    return `LLM call recorded for ${stringOrFallback(payload.model, "unknown model")} at about $${stringOrFallback(payload.estimatedCostUsd, "0")}.`;
  }

  if (eventType === "STT_USAGE_RECORDED") {
    return `STT call recorded for ${stringOrFallback(payload.model, "unknown model")} at about $${stringOrFallback(payload.estimatedCostUsd, "0")}.`;
  }

  if (eventType === "SESSION_BUDGET_EXCEEDED") {
    return `Session budget exceeded at about $${stringOrFallback(payload.projectedTotalUsd, "0")} against a $${stringOrFallback(payload.thresholdUsd, "0")} cap.`;
  }

  if (eventType === "AI_SPOKE") {
    const providerFailure = asRecord(payload.providerFailure);
    if (providerFailure.provider || providerFailure.message) {
      return `AI interviewer replied using ${stringOrFallback(payload.source, "unknown provider")} after ${stringOrFallback(providerFailure.provider, "a provider")} fallback: ${stringOrFallback(providerFailure.message, "unknown reason")}.`;
    }

    return `AI interviewer delivered a reply using ${stringOrFallback(payload.source, "unknown provider")}.`;
  }

  if (eventType === "AI_INTERRUPTED_BY_CANDIDATE") {
    return "AI response was interrupted because the candidate started speaking.";
  }

  if (eventType === "HINT_REQUESTED") {
    return `Candidate requested a hint (${stringOrFallback(payload.source, "unknown source")}).`;
  }

  if (eventType === "HINT_SERVED") {
    const because = payload.escalationReason ? ` because ${String(payload.escalationReason).replaceAll("_", " ")}` : "";
    return `AI served a ${stringOrFallback(payload.hintLevel, "light").toLowerCase()} hint during ${describeStage(payload.stage) ?? "the current stage"} (${stringOrFallback(payload.hintStyle, "generic hint")})${because}.`;
  }

  if (eventType === "CODE_SNAPSHOT_SAVED") {
    return `Code snapshot saved in ${stringOrFallback(payload.language, "unknown language")}.`;
  }

  if (eventType === "CODE_RUN_REQUESTED") {
    return `Code execution requested for ${stringOrFallback(payload.language, "unknown language")}.`;
  }

  if (eventType === "CODE_RUN_COMPLETED") {
    return `Code execution completed with status ${stringOrFallback(payload.status, "unknown")}.`;
  }

  if (eventType === "INTERVIEW_ENDED") {
    return "Interview session ended.";
  }

  if (eventType === "EVALUATION_STARTED") {
    return "Post-interview evaluation started.";
  }

  if (eventType === "REPORT_GENERATED") {
    return `Feedback report generated with recommendation ${stringOrFallback(payload.recommendation, "unknown")} and score ${stringOrFallback(payload.overallScore, "unknown")}.`;
  }

  return "Session lifecycle event recorded.";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringOrFallback(value: unknown, fallback: string) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
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

function describeStage(value: unknown) {
  if (!isCodingInterviewStage(value)) {
    return null;
  }

  return describeCodingStage(value);
}












