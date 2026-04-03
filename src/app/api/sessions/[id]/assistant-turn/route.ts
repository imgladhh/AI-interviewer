import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { generateAssistantTurn } from "@/lib/assistant/generate-turn";
import { deriveCurrentCodingStage } from "@/lib/assistant/stages";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { persistSessionSnapshots } from "@/lib/session/snapshots";
import { resolveLowCostMode } from "@/lib/usage/cost";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, { params }: RouteContext) {
  const { id } = await params;

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
      question: true,
      interviewerContext: true,
      interviewerProfile: true,
      transcripts: {
        orderBy: { segmentIndex: "asc" },
      },
      executionRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      events: {
        orderBy: { eventTime: "asc" },
      },
    },
  });

  if (!session) {
    return fail("Interview session not found", 404);
  }

  const currentStage = deriveCurrentCodingStage({
    events: session.events,
    transcripts: session.transcripts,
    latestExecutionRun: session.executionRuns[0] ?? null,
  });
  const lowCostMode = resolveLowCostMode(session.events);

  const turn = await generateAssistantTurn({
    mode: session.mode,
    questionTitle: session.question?.title ?? "Coding interview",
    questionPrompt: session.question?.prompt ?? "",
    targetLevel: session.targetLevel,
    selectedLanguage: session.selectedLanguage,
    lowCostMode,
    personaSummary: session.interviewerProfile?.personaSummary ?? null,
    appliedPromptContext: session.interviewerContext?.appliedPromptContext ?? null,
    currentStage,
    recentTranscripts: session.transcripts.map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
    })),
    recentEvents: session.events.map((event) => ({
      eventType: event.eventType,
      eventTime: event.eventTime,
      payloadJson: event.payloadJson,
    })),
    latestExecutionRun: session.executionRuns[0]
      ? {
          status: session.executionRuns[0].status,
          stdout: session.executionRuns[0].stdout,
          stderr: session.executionRuns[0].stderr,
        }
      : null,
  });

  const lastSegment = session.transcripts.at(-1);
  const segmentIndex = lastSegment ? lastSegment.segmentIndex + 1 : 0;

  const transcript = await prisma.transcriptSegment.create({
    data: {
      sessionId: id,
      speaker: "AI",
      segmentIndex,
      text: turn.reply,
      isFinal: true,
    },
  });

  const events = [];

  if (turn.signals) {
    const signalEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.SIGNAL_SNAPSHOT_RECORDED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          signals: turn.signals,
        },
      },
    });
    events.push(signalEvent);
  }

  if (turn.decision) {
    const decisionEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.DECISION_RECORDED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          decision: turn.decision,
        },
      },
    });
    events.push(decisionEvent);
  }

  if (turn.criticVerdict) {
    const criticEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.CRITIC_VERDICT_RECORDED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          criticVerdict: turn.criticVerdict,
        },
      },
    });
    events.push(criticEvent);
  }

  await persistSessionSnapshots({
    sessionId: id,
    stage: currentStage,
    source: turn.source,
    signals: turn.signals,
    decision: turn.decision,
  });

  const aiSpokeEvent = await prisma.sessionEvent.create({
    data: {
      sessionId: id,
      eventType: SESSION_EVENT_TYPES.AI_SPOKE,
        payloadJson: {
          transcriptSegmentId: transcript.id,
          source: turn.source,
          policyAction: turn.policyAction ?? null,
          currentStage,
          hintServed: turn.hintServed ?? false,
          hintLevel: turn.hintLevel ?? null,
          escalationReason: turn.escalationReason ?? null,
          signals: turn.signals ?? null,
          decision: turn.decision ?? null,
          criticVerdict: turn.criticVerdict ?? null,
        },
      },
  });
  events.push(aiSpokeEvent);

  if (turn.usage) {
    const usageEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.LLM_USAGE_RECORDED,
        payloadJson: {
          source: turn.source,
          model: turn.model ?? null,
          inputTokens: turn.usage.inputTokens,
          outputTokens: turn.usage.outputTokens,
          estimatedCostUsd: turn.usage.estimatedCostUsd,
          lowCostMode,
        },
      },
    });
    events.push(usageEvent);
  }

  if (turn.suggestedStage && turn.suggestedStage !== currentStage) {
    const stageEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.STAGE_ADVANCED,
        payloadJson: {
          previousStage: currentStage,
          stage: turn.suggestedStage,
          source: turn.source,
          reason: turn.policyReason ?? null,
        },
      },
    });
    events.push(stageEvent);
  }

  if (turn.hintServed) {
    const hintServedEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.HINT_SERVED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          hintStyle: turn.hintStyle ?? null,
          hintLevel: turn.hintLevel ?? null,
          rescueMode: turn.rescueMode ?? null,
          hintGranularity: turn.hintGranularity ?? null,
          hintTier: turn.hintTier ?? null,
          hintCost: turn.hintCost ?? null,
          hintInitiator: turn.hintInitiator ?? null,
          hintRequestTiming: turn.hintRequestTiming ?? null,
          momentumAtHint: turn.momentumAtHint ?? null,
          escalationReason: turn.escalationReason ?? null,
          reason: turn.policyReason ?? null,
        },
      },
    });
    events.push(hintServedEvent);
  }

  return ok({
    transcript,
    events,
    meta: {
      source: turn.source,
      currentStage,
      suggestedStage: turn.suggestedStage ?? null,
      policyAction: turn.policyAction ?? null,
      hintServed: turn.hintServed ?? false,
      hintLevel: turn.hintLevel ?? null,
      rescueMode: turn.rescueMode ?? null,
      hintGranularity: turn.hintGranularity ?? null,
      hintTier: turn.hintTier ?? null,
      hintCost: turn.hintCost ?? null,
      hintInitiator: turn.hintInitiator ?? null,
      hintRequestTiming: turn.hintRequestTiming ?? null,
      momentumAtHint: turn.momentumAtHint ?? null,
      escalationReason: turn.escalationReason ?? null,
      signals: turn.signals ?? null,
      decision: turn.decision ?? null,
      criticVerdict: turn.criticVerdict ?? null,
      providerFailure: turn.providerFailure ?? null,
    },
  });
}



