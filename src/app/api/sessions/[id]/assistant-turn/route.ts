import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { getCommittedTranscriptSegments } from "@/lib/session/commit-arbiter";
import { generateAssistantTurn } from "@/lib/assistant/generate-turn";
import { evaluateTurnReward } from "@/lib/assistant/reward";
import { deriveCurrentCodingStage } from "@/lib/assistant/stages";
import { enforceSessionBudgetLimit } from "@/lib/session/budget-enforcement";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { persistSessionSnapshots } from "@/lib/session/snapshots";
import { assessSessionBudget, buildBudgetExceededReply } from "@/lib/usage/budget";
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

  const committedTranscripts = getCommittedTranscriptSegments(session.transcripts, session.events);

  const currentStage = deriveCurrentCodingStage({
    events: session.events,
    transcripts: committedTranscripts,
    latestExecutionRun: session.executionRuns[0] ?? null,
  });
  const lowCostMode = resolveLowCostMode(session.events);
  const initialBudget = assessSessionBudget(session.events);

  if (initialBudget.exceeded && !session.endedAt) {
    const budgetReply = buildBudgetExceededReply(initialBudget);
    const result = await enforceSessionBudgetLimit({
      sessionId: id,
      currentStage,
      source: "system",
      reply: budgetReply,
      existingTranscriptCount: session.transcripts.length,
      budget: initialBudget,
      lowCostMode,
    });

    return ok({
      transcript: result.transcript,
      events: result.events,
      meta: {
        source: "system",
        currentStage,
        suggestedStage: null,
        budgetExceeded: true,
        budget: initialBudget,
      },
    });
  }

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
    recentTranscripts: committedTranscripts.map((segment) => ({
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
  const projectedBudget = assessSessionBudget(session.events, turn.usage?.estimatedCostUsd ?? 0);

  if (projectedBudget.exceeded && !session.endedAt) {
    const budgetReply = buildBudgetExceededReply(projectedBudget);
    const result = await enforceSessionBudgetLimit({
      sessionId: id,
      currentStage,
      source: turn.source,
      reply: budgetReply,
      usage: turn.usage
        ? {
            model: turn.model ?? null,
            inputTokens: turn.usage.inputTokens,
            outputTokens: turn.usage.outputTokens,
            estimatedCostUsd: turn.usage.estimatedCostUsd,
          }
        : null,
      existingTranscriptCount: session.transcripts.length,
      budget: projectedBudget,
      lowCostMode,
    });

    return ok({
      transcript: result.transcript,
      events: result.events,
      meta: {
        source: turn.source,
        currentStage,
        suggestedStage: null,
        budgetExceeded: true,
        budget: projectedBudget,
      },
    });
  }

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
  let decisionEventId: string | null = null;
  let rewardResult: ReturnType<typeof evaluateTurnReward> | null = null;

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

    const signalPayload =
      typeof turn.signals === "object" && turn.signals !== null ? (turn.signals as Record<string, unknown>) : {};
    if (signalPayload.echoLikely === true) {
      const echoEvent = await prisma.sessionEvent.create({
        data: {
          sessionId: id,
          eventType: SESSION_EVENT_TYPES.CANDIDATE_ECHO_DETECTED,
          payloadJson: {
            stage: currentStage,
            source: turn.source,
            echoStrength: signalPayload.echoStrength ?? null,
            echoOverlapRatio: signalPayload.echoOverlapRatio ?? null,
            referenceQuestion: signalPayload.echoReferenceQuestion ?? null,
          },
        },
      });
      events.push(echoEvent);
    }
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
    decisionEventId = decisionEvent.id;

    const decisionPayload =
      typeof turn.decision === "object" && turn.decision !== null ? (turn.decision as Record<string, unknown>) : {};
    if (typeof decisionPayload.echoRecoveryMode === "string") {
      const echoRecoveryEvent = await prisma.sessionEvent.create({
        data: {
          sessionId: id,
          eventType: SESSION_EVENT_TYPES.ECHO_RECOVERY_PROMPTED,
          payloadJson: {
            stage: currentStage,
            source: turn.source,
            mode: decisionPayload.echoRecoveryMode,
            attempt: decisionPayload.echoRecoveryAttempt ?? null,
            target: decisionPayload.target ?? null,
          },
        },
      });
      events.push(echoRecoveryEvent);
    }
  }

  if (turn.intent) {
    const intentEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.INTENT_SNAPSHOT_RECORDED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          intent: turn.intent,
        },
      },
    });
    events.push(intentEvent);
  }

  if (turn.trajectory) {
    const trajectoryEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.TRAJECTORY_SNAPSHOT_RECORDED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          trajectory: turn.trajectory,
        },
      },
    });
    events.push(trajectoryEvent);
  }

  if (turn.candidateDna) {
    const dnaEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.CANDIDATE_DNA_RECORDED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          candidateDna: turn.candidateDna,
        },
      },
    });
    events.push(dnaEvent);
  }

  if (turn.shadowPolicy) {
    const shadowPolicyEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.SHADOW_POLICY_EVALUATED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          shadowPolicy: turn.shadowPolicy,
        },
      },
    });
    events.push(shadowPolicyEvent);
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

  if (turn.decision) {
    rewardResult = evaluateTurnReward({
      stage: currentStage,
      decision: turn.decision,
      criticVerdict: turn.criticVerdict ?? null,
      recentEvents: session.events.map((event) => ({
        eventType: event.eventType,
        payloadJson: event.payloadJson,
      })),
    });
    const rewardEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.REWARD_RECORDED,
        payloadJson: {
          stage: currentStage,
          source: turn.source,
          reward: rewardResult,
          trace: {
            transcriptSegmentId: transcript.id,
            decisionEventId,
          },
        },
      },
    });
    events.push(rewardEvent);
  }

  await persistSessionSnapshots({
    sessionId: id,
    stage: currentStage,
    source: turn.source,
    signals: turn.signals,
    decision: turn.decision,
    intent: turn.intent,
    trajectory: turn.trajectory,
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
          intent: turn.intent ?? null,
          trajectory: turn.trajectory ?? null,
          criticVerdict: turn.criticVerdict ?? null,
          reward: rewardResult,
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
      intent: turn.intent ?? null,
      trajectory: turn.trajectory ?? null,
      criticVerdict: turn.criticVerdict ?? null,
      reward: rewardResult,
      providerFailure: turn.providerFailure ?? null,
    },
  });
}



