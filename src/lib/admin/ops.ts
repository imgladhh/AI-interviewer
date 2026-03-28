import { prisma } from "@/lib/db";
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

  if (eventType === "LLM_USAGE_RECORDED") {
    return `LLM call recorded for ${stringOrFallback(payload.model, "unknown model")} at about $${stringOrFallback(payload.estimatedCostUsd, "0")}.`;
  }

  if (eventType === "STT_USAGE_RECORDED") {
    return `STT call recorded for ${stringOrFallback(payload.model, "unknown model")} at about $${stringOrFallback(payload.estimatedCostUsd, "0")}.`;
  }

  if (eventType === "AI_SPOKE") {
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

function describeStage(value: unknown) {
  if (!isCodingInterviewStage(value)) {
    return null;
  }

  return describeCodingStage(value);
}
