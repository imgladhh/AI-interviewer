import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { getCommittedTranscriptSegments } from "@/lib/session/commit-arbiter";
import { generateAssistantTurn } from "@/lib/assistant/generate-turn";
import { evaluateTurnReward } from "@/lib/assistant/reward";
import { deriveCurrentCodingStage, deriveCurrentSystemDesignStage } from "@/lib/assistant/stages";
import { enforceSessionBudgetLimit } from "@/lib/session/budget-enforcement";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { persistSessionSnapshots } from "@/lib/session/snapshots";
import { guardSystemDesignStageTransition } from "@/lib/assistant/pass_conditions";
import { assessSessionBudget, buildBudgetExceededReply } from "@/lib/usage/budget";
import { resolveLowCostMode } from "@/lib/usage/cost";
import { enforceMutationGuard } from "@/lib/security/request-guard";
import { assistantTurnCommandSchema } from "@/schemas/session-runtime";
import { claimAssistantTurn, completeAssistantTurn, failAssistantTurn } from "@/lib/session/turn-commit";
import { withUniqueSequenceRetry } from "@/lib/db/unique-sequence";
import { appendTurnAssessment, getSignalAssessmentTrace } from "@/lib/assistant/turn-assessment";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  const guarded = enforceMutationGuard(request, "assistant_turn");
  if (guarded) {
    return guarded;
  }
  const { id } = await params;
  const command = assistantTurnCommandSchema.safeParse(await request.json().catch(() => null));
  if (!command.success) return fail("Invalid assistant turn command", 400, { issues: command.error.flatten() });

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
  const claim = await claimAssistantTurn(id, command.data.turnId);
  if (claim.status === "in_progress") return ok({ status: "in_progress", turnId: command.data.turnId, retryAfterMs: claim.retryAfterMs }, { status: 202 });
  if (claim.status === "completed") return ok(claim.result);

  const committedTranscripts = getCommittedTranscriptSegments(session.transcripts, session.events);

  const currentStage =
    session.mode === "SYSTEM_DESIGN"
      ? deriveCurrentSystemDesignStage({
          events: session.events,
          transcripts: committedTranscripts,
        })
      : deriveCurrentCodingStage({
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
      turnId: command.data.turnId,
      resultMeta: { mode: session.mode, source: "system", currentStage, suggestedStage: null, budgetExceeded: true, budget: initialBudget },
    });

    return ok({
      transcript: result.transcript,
      events: result.events,
      meta: {
        mode: session.mode,
        source: "system",
        currentStage,
        suggestedStage: null,
        budgetExceeded: true,
        budget: initialBudget,
      },
    });
  }

  let turn: Awaited<ReturnType<typeof generateAssistantTurn>>;
  try {
    turn = await generateAssistantTurn({
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
  } catch (error) {
    await failAssistantTurn(id, command.data.turnId);
    throw error;
  }
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
      turnId: command.data.turnId,
      resultMeta: { mode: session.mode, source: turn.source, currentStage, suggestedStage: null, budgetExceeded: true, budget: projectedBudget },
    });

    return ok({
      transcript: result.transcript,
      events: result.events,
      meta: {
        mode: session.mode,
        source: turn.source,
        currentStage,
        suggestedStage: null,
        budgetExceeded: true,
        budget: projectedBudget,
      },
    });
  }

  const committed = await withUniqueSequenceRetry(() => prisma.$transaction(async (tx) => {
  const lastSegment = await tx.transcriptSegment.findFirst({ where: { sessionId: id }, orderBy: { segmentIndex: "desc" }, select: { segmentIndex: true } });
  const segmentIndex = (lastSegment?.segmentIndex ?? -1) + 1;
  const transcript = await tx.transcriptSegment.create({
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

  const candidateTurn = [...committedTranscripts].reverse().find((segment) => segment.speaker === "USER" && segment.isFinal !== false);
  if (turn.signals && candidateTurn?.id) {
    const { event } = await appendTurnAssessment(tx, { sessionId: id, candidateTurn: { id: candidateTurn.id, text: candidateTurn.text }, trace: getSignalAssessmentTrace(turn.signals) });
    events.push(event);
  }

  if (turn.signals) {
    const signalEvent = await tx.sessionEvent.create({
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
    const echoEvent = await tx.sessionEvent.create({
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
    const decisionEvent = await tx.sessionEvent.create({
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
    const echoRecoveryEvent = await tx.sessionEvent.create({
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
    const intentEvent = await tx.sessionEvent.create({
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
    const trajectoryEvent = await tx.sessionEvent.create({
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
    const dnaEvent = await tx.sessionEvent.create({
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
    const shadowPolicyEvent = await tx.sessionEvent.create({
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
    const criticEvent = await tx.sessionEvent.create({
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
      originTurnId: transcript.id,
    });
    const rewardEvent = await tx.sessionEvent.create({
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

  const aiSpokeEvent = await tx.sessionEvent.create({
    data: {
      sessionId: id,
      eventType: SESSION_EVENT_TYPES.AI_SPOKE,
        payloadJson: {
          mode: session.mode,
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
    const usageEvent = await tx.sessionEvent.create({
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

  const suggestedStage =
    session.mode === "SYSTEM_DESIGN"
      ? guardSystemDesignStageTransition({
          currentStage,
          suggestedStage: turn.suggestedStage,
          transcripts: committedTranscripts,
          events: session.events,
        })
      : turn.suggestedStage ?? null;

  if (suggestedStage && suggestedStage !== currentStage) {
    const stageEvent = await tx.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.STAGE_ADVANCED,
        payloadJson: {
          previousStage: currentStage,
          stage: suggestedStage,
          source: turn.source,
          reason: turn.policyReason ?? null,
        },
      },
    });
    events.push(stageEvent);
  }

  if (turn.hintServed) {
    const hintServedEvent = await tx.sessionEvent.create({
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

  const responseData = {
    transcript,
    events,
    meta: {
      mode: session.mode,
      source: turn.source,
      currentStage,
      suggestedStage,
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
  };
  await completeAssistantTurn(tx, { sessionId: id, turnId: command.data.turnId, responseTranscriptId: transcript.id, result: responseData as never });
  return { transcript, events, responseData };
  })).catch(async (error) => {
    await failAssistantTurn(id, command.data.turnId).catch(() => undefined);
    throw error;
  });

  const snapshotResult = await persistSessionSnapshots({ sessionId: id, stage: currentStage, source: turn.source, signals: turn.signals, decision: turn.decision, intent: turn.intent, trajectory: turn.trajectory });
  if (snapshotResult.status === "degraded") {
    const sourceSessionEventId = committed.events.at(-1)?.id;
    if (sourceSessionEventId) {
      try {
        await prisma.sessionEvent.create({ data: { sessionId: id, eventType: SESSION_EVENT_TYPES.SNAPSHOT_PROJECTION_DEGRADED, payloadJson: { sourceSessionEventId, kind: snapshotResult.failure?.kind ?? "unknown", attemptedKinds: snapshotResult.attemptedKinds } } });
      } catch (error) {
        console.warn("[assistant-turn] unable to record snapshot projection degradation", { sessionId: id, sourceSessionEventId, error: error instanceof Error ? error.name : "unknown" });
      }
    }
  }
  return ok(committed.responseData);
}



