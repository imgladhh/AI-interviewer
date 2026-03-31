import { prisma } from "@/lib/db";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
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
  latestCritic: Record<string, unknown> | null;
  answeredTargets: string[];
  collectedEvidence: string[];
  unresolvedIssues: string[];
  missingEvidence: string[];
  evidenceFocus: string | null;
  latestCodeRunStatus: string | null;
  hintCount: number;
  failedRunCount: number;
  timeline: SessionTimelineItem[];
};

export type SessionTimelineItem = {
  id: string;
  kind: "stage" | "signal" | "decision" | "critic" | "hint" | "code_run";
  at: string;
  title: string;
  summary: string;
  answeredTargets?: string[];
  collectedEvidence?: string[];
  unresolvedIssues?: string[];
  missingEvidence?: string[];
  evidenceFocus?: string | null;
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
          events: {
            orderBy: { eventTime: "desc" },
            take: 20,
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
    sessionSummary: latestSession ? summarizeSession(latestSession.id, latestSession.events) : null,
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

function summarizeSession(
  sessionId: string,
  events: Array<{ eventType: string; eventTime: Date; payloadJson: unknown }>,
): SessionSummary {
  const ordered = [...events].sort((left, right) => left.eventTime.getTime() - right.eventTime.getTime());
  const stageEvents = ordered.filter((event) => event.eventType === "STAGE_ADVANCED");
  const stageJourneyRaw = stageEvents
    .map((event) => stringValue(asRecord(event.payloadJson).stage))
    .filter((value): value is string => Boolean(value));
  const currentStage = stageJourneyRaw.at(-1) ?? "PROBLEM_UNDERSTANDING";
  const latestSignalEvent = [...ordered].reverse().find((event) => event.eventType === "SIGNAL_SNAPSHOT_RECORDED");
  const latestDecisionEvent = [...ordered].reverse().find((event) => event.eventType === "DECISION_RECORDED");
  const latestCriticEvent = [...ordered].reverse().find((event) => event.eventType === "CRITIC_VERDICT_RECORDED");
  const latestCodeRunEvent = [...ordered].reverse().find((event) => event.eventType === "CODE_RUN_COMPLETED");
  const latestSignals = latestSignalEvent ? asRecord(asRecord(latestSignalEvent.payloadJson).signals) : null;
  const latestDecision = latestDecisionEvent ? asRecord(asRecord(latestDecisionEvent.payloadJson).decision) : null;
  const latestCritic = latestCriticEvent ? asRecord(asRecord(latestCriticEvent.payloadJson).criticVerdict) : null;
  const hintCount = ordered.filter((event) => event.eventType === "HINT_SERVED").length;
  const failedRunCount = ordered.filter((event) => {
    if (event.eventType !== "CODE_RUN_COMPLETED") {
      return false;
    }

    const status = stringValue(asRecord(event.payloadJson).status);
    return status === "FAILED" || status === "ERROR" || status === "TIMEOUT";
  }).length;

  const ledger =
    latestSignals
      ? buildMemoryLedger({
          currentStage: isCodingInterviewStage(currentStage) ? currentStage : "PROBLEM_UNDERSTANDING",
          recentEvents: ordered.map((event) => ({
            eventType: event.eventType,
            payloadJson: event.payloadJson,
          })),
          signals: latestSignals as never,
          latestExecutionRun: latestCodeRunEvent
            ? ({
                status: stringValue(asRecord(latestCodeRunEvent.payloadJson).status) as
                  | "PASSED"
                  | "FAILED"
                  | "ERROR"
                  | "TIMEOUT",
                stdout: stringValue(asRecord(latestCodeRunEvent.payloadJson).stdout) ?? null,
                stderr: stringValue(asRecord(latestCodeRunEvent.payloadJson).stderr) ?? null,
              } as const)
            : null,
        })
      : null;

  return {
    sessionId,
    currentStage,
    currentStageLabel: describeStage(currentStage) ?? currentStage,
    stageJourney: [...new Set(stageJourneyRaw.map((stage) => describeStage(stage) ?? stage))],
    latestSignals,
    latestDecision,
    latestCritic,
    answeredTargets: ledger?.answeredTargets ?? [],
    collectedEvidence: ledger?.collectedEvidence ?? [],
    unresolvedIssues: ledger?.unresolvedIssues ?? [],
    missingEvidence: ledger?.missingEvidence ?? [],
    evidenceFocus: latestDecision ? stringValue(latestDecision.specificIssue) ?? stringValue(latestDecision.target) : null,
    latestCodeRunStatus: latestCodeRunEvent ? stringValue(asRecord(latestCodeRunEvent.payloadJson).status) : null,
    hintCount,
    failedRunCount,
    timeline: buildSessionTimeline(ordered),
  };
}

function buildSessionTimeline(
  events: Array<{ eventType: string; eventTime: Date; payloadJson: unknown }>,
): SessionTimelineItem[] {
  return events
    .filter((event) =>
      [
        "STAGE_ADVANCED",
        "SIGNAL_SNAPSHOT_RECORDED",
        "DECISION_RECORDED",
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

      if (event.eventType === "SIGNAL_SNAPSHOT_RECORDED") {
        const signals = asRecord(payload.signals);
        const structuredEvidence = Array.isArray(signals.structuredEvidence) ? signals.structuredEvidence : [];
        const primaryIssue = structuredEvidence.find((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).issue === "string") as Record<string, unknown> | undefined;
        const signalLedger = buildMemoryLedger({
          currentStage: "PROBLEM_UNDERSTANDING",
          recentEvents: events
            .filter((candidate) => candidate.eventTime.getTime() <= event.eventTime.getTime())
            .map((candidate) => ({
              eventType: candidate.eventType,
              payloadJson: candidate.payloadJson,
            })),
          signals: signals as never,
          latestExecutionRun: null,
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
          evidenceFocus: stringValue(decision.specificIssue) ?? stringValue(decision.target),
          answeredTargets: [],
          collectedEvidence: [],
          payload,
        };
      }

        if (event.eventType === "CRITIC_VERDICT_RECORDED") {
          const criticVerdict = asRecord(payload.criticVerdict);
          return {
            id: `${event.eventType}-${event.eventTime.toISOString()}`,
            kind: "critic" as const,
            at: event.eventTime.toISOString(),
            title: "Critic verdict",
            summary: `${stringOrFallback(criticVerdict.verdict, "verdict")} / ${stringOrFallback(criticVerdict.reason, "unknown reason")}${typeof criticVerdict.questionWorthAsking === "boolean" ? ` / worth=${criticVerdict.questionWorthAsking ? "yes" : "no"}` : ""}`,
            evidenceFocus: stringValue(criticVerdict.focus) ?? stringValue(criticVerdict.reason),
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
    return `Dedicated STT refined a candidate turn using ${stringOrFallback(payload.transcriptProvider, "unknown provider")}.`;
  }

  if (eventType === "CANDIDATE_TURN_AUTOSUBMITTED") {
    return `Candidate turn auto-submitted after silence (${stringOrFallback(payload.source, "unknown source")}).`;
  }

  if (eventType === "SIGNAL_SNAPSHOT_RECORDED") {
    const signals = asRecord(payload.signals);
    const structuredEvidence = Array.isArray(signals.structuredEvidence) ? signals.structuredEvidence : [];
    const primaryIssue = structuredEvidence.find((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).issue === "string") as Record<string, unknown> | undefined;
    return primaryIssue?.issue
      ? `Candidate state updated. Primary observed issue: ${String(primaryIssue.issue)}`
      : `Candidate state updated: understanding=${stringOrFallback(signals.understanding, "unknown")}, progress=${stringOrFallback(signals.progress, "unknown")}, edge cases=${stringOrFallback(signals.edgeCaseAwareness, "unknown")}.`;
  }

  if (eventType === "DECISION_RECORDED") {
    const decision = asRecord(payload.decision);
    return `Interviewer decision: ${stringOrFallback(decision.action, "unknown action")} toward ${stringOrFallback(decision.target, "unknown target")}.`;
  }

  if (eventType === "CRITIC_VERDICT_RECORDED") {
    const criticVerdict = asRecord(payload.criticVerdict);
    return `Critic verdict: ${stringOrFallback(criticVerdict.verdict, "unknown verdict")} because ${stringOrFallback(criticVerdict.reason, "unknown reason")}${stringValue(criticVerdict.worthReason) ? `. ${stringValue(criticVerdict.worthReason)}` : ""}.`;
  }

  if (eventType === "LLM_USAGE_RECORDED") {
    return `LLM call recorded for ${stringOrFallback(payload.model, "unknown model")} at about $${stringOrFallback(payload.estimatedCostUsd, "0")}.`;
  }

  if (eventType === "STT_USAGE_RECORDED") {
    return `STT call recorded for ${stringOrFallback(payload.model, "unknown model")} at about $${stringOrFallback(payload.estimatedCostUsd, "0")}.`;
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





