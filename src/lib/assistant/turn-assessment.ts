import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";

export type SignalAssessmentTrace = {
  status: "ADJUDICATED" | "HEURISTIC_FALLBACK";
  heuristic: CandidateSignalSnapshot;
  provider: CandidateSignalSnapshot | null;
  adjudicated: CandidateSignalSnapshot;
  fallbackReason: string | null;
};

const traces = new WeakMap<object, SignalAssessmentTrace>();

export function registerSignalAssessment(signals: CandidateSignalSnapshot, trace: SignalAssessmentTrace) {
  traces.set(signals, trace);
  return signals;
}

export function getSignalAssessmentTrace(signals: CandidateSignalSnapshot): SignalAssessmentTrace {
  return traces.get(signals) ?? {
    status: "HEURISTIC_FALLBACK",
    heuristic: signals,
    provider: null,
    adjudicated: signals,
    fallbackReason: "assessment_trace_unavailable",
  };
}

export function adjudicateCandidateSignals(input: {
  heuristic: CandidateSignalSnapshot;
  provider: CandidateSignalSnapshot | null;
  providerFailure?: string | null;
}): SignalAssessmentTrace {
  if (!input.provider) {
    return { status: "HEURISTIC_FALLBACK", heuristic: input.heuristic, provider: null,
      adjudicated: input.heuristic, fallbackReason: input.providerFailure ?? "provider_unavailable_or_invalid" };
  }
  // Provider output reaches here only after field-level validation/coercion. The
  // deterministic v1 rule accepts that normalized observation as a whole.
  return { status: "ADJUDICATED", heuristic: input.heuristic, provider: input.provider,
    adjudicated: input.provider, fallbackReason: null };
}

type AssessmentClient = Pick<Prisma.TransactionClient, "turnAssessment" | "sessionEvent">;

export async function appendTurnAssessment(client: AssessmentClient, input: {
  sessionId: string;
  candidateTurn: { id: string; text: string };
  trace: SignalAssessmentTrace;
}) {
  const latest = await client.turnAssessment.findFirst({
    where: { sessionId: input.sessionId, candidateTurnId: input.candidateTurn.id },
    orderBy: { assessmentVersion: "desc" }, select: { assessmentVersion: true },
  });
  const assessmentVersion = (latest?.assessmentVersion ?? 0) + 1;
  const excerpt = input.candidateTurn.text.replace(/\s+/g, " ").trim().slice(0, 240);
  const evidence = { transcriptId: input.candidateTurn.id, start: 0, length: input.candidateTurn.text.length,
    excerpt, excerptHash: createHash("sha256").update(input.candidateTurn.text).digest("hex") };
  const assessment = await client.turnAssessment.create({ data: {
    sessionId: input.sessionId, candidateTurnId: input.candidateTurn.id, assessmentVersion,
    status: input.trace.status, heuristicJson: input.trace.heuristic as unknown as Prisma.InputJsonValue,
    providerJson: input.trace.provider ? input.trace.provider as unknown as Prisma.InputJsonValue : Prisma.DbNull,
    adjudicatedJson: input.trace.adjudicated as unknown as Prisma.InputJsonValue,
    evidenceJson: evidence,
  } });
  const event = await client.sessionEvent.create({ data: { sessionId: input.sessionId, eventType: SESSION_EVENT_TYPES.TURN_ASSESSMENT_RECORDED,
    payloadJson: { assessmentId: assessment.id, candidateTurnId: input.candidateTurn.id, assessmentVersion,
      status: input.trace.status, fallbackReason: input.trace.fallbackReason, adjudicated: input.trace.adjudicated } as unknown as Prisma.InputJsonValue } });
  return { assessment, event };
}

export function latestAdjudicatedSignals(events: Array<{ eventType: string; payloadJson?: unknown }>) {
  const latestByTurn = new Map<string, { version: number; signals: CandidateSignalSnapshot }>();
  for (const event of events) {
    if (event.eventType !== SESSION_EVENT_TYPES.TURN_ASSESSMENT_RECORDED || typeof event.payloadJson !== "object" || !event.payloadJson) continue;
    const payload = event.payloadJson as Record<string, unknown>;
    if (typeof payload.candidateTurnId !== "string" || typeof payload.assessmentVersion !== "number" ||
        typeof payload.adjudicated !== "object" || !payload.adjudicated) continue;
    const current = latestByTurn.get(payload.candidateTurnId);
    if (!current || payload.assessmentVersion > current.version) latestByTurn.set(payload.candidateTurnId,
      { version: payload.assessmentVersion, signals: payload.adjudicated as CandidateSignalSnapshot });
  }
  return [...latestByTurn.entries()].map(([candidateTurnId, value]) => ({ candidateTurnId, assessmentVersion: value.version, signals: value.signals }));
}
