import { prisma } from "@/lib/db";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import type { SessionBudgetStatus } from "@/lib/usage/budget";

export async function enforceSessionBudgetLimit(input: {
  sessionId: string;
  currentStage: string;
  source: "fallback" | "openai" | "gemini" | "system";
  reply: string;
  usage?: {
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number | null;
  } | null;
  existingTranscriptCount: number;
  budget: SessionBudgetStatus;
  lowCostMode?: boolean;
}) {
  const transcript = await prisma.transcriptSegment.create({
    data: {
      sessionId: input.sessionId,
      speaker: "AI",
      segmentIndex: input.existingTranscriptCount,
      text: input.reply,
      isFinal: true,
    },
  });

  const events = [];

  const aiSpokeEvent = await prisma.sessionEvent.create({
    data: {
      sessionId: input.sessionId,
      eventType: SESSION_EVENT_TYPES.AI_SPOKE,
      payloadJson: {
        transcriptSegmentId: transcript.id,
        source: input.source,
        currentStage: input.currentStage,
        budgetExceeded: true,
      },
    },
  });
  events.push(aiSpokeEvent);

  if (input.usage) {
    const usageEvent = await prisma.sessionEvent.create({
      data: {
        sessionId: input.sessionId,
        eventType: SESSION_EVENT_TYPES.LLM_USAGE_RECORDED,
        payloadJson: {
          source: input.source === "system" ? "budget-guardrail" : input.source,
          model: input.usage.model ?? null,
          inputTokens: input.usage.inputTokens ?? 0,
          outputTokens: input.usage.outputTokens ?? 0,
          estimatedCostUsd: input.usage.estimatedCostUsd ?? null,
          lowCostMode: input.lowCostMode ?? false,
        },
      },
    });
    events.push(usageEvent);
  }

  const budgetEvent = await prisma.sessionEvent.create({
    data: {
      sessionId: input.sessionId,
      eventType: SESSION_EVENT_TYPES.SESSION_BUDGET_EXCEEDED,
      payloadJson: {
        thresholdUsd: input.budget.thresholdUsd,
        currentTotalUsd: input.budget.currentTotalUsd,
        projectedTotalUsd: input.budget.projectedTotalUsd,
      },
    },
  });
  events.push(budgetEvent);

  const endedEvent = await prisma.sessionEvent.create({
    data: {
      sessionId: input.sessionId,
      eventType: SESSION_EVENT_TYPES.INTERVIEW_ENDED,
      payloadJson: {
        source: "budget-guardrail",
        reason: "session_budget_exceeded",
      },
    },
  });
  events.push(endedEvent);

  await prisma.interviewSession.update({
    where: { id: input.sessionId },
    data: {
      status: "COMPLETED",
      endedAt: new Date(),
    },
  });

  return { transcript, events };
}
