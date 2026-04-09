import { prisma } from "@/lib/db";
import { fail } from "@/lib/http";
import { getCommittedTranscriptSegments } from "@/lib/session/commit-arbiter";
import { streamAssistantTurn } from "@/lib/assistant/generate-turn";
import { deriveCurrentCodingStage } from "@/lib/assistant/stages";
import { enforceSessionBudgetLimit } from "@/lib/session/budget-enforcement";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { persistSessionSnapshots } from "@/lib/session/snapshots";
import { assessSessionBudget, buildBudgetExceededReply } from "@/lib/usage/budget";
import { resolveLowCostMode } from "@/lib/usage/cost";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
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

  const input = {
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
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
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

          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({
                transcript: result.transcript,
                events: result.events,
                meta: {
                  source: "system",
                  currentStage,
                  suggestedStage: null,
                  budgetExceeded: true,
                  budget: initialBudget,
                },
              })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        let finalTurn:
          | {
              reply: string;
              suggestedStage?: string;
              source: "fallback" | "openai" | "gemini";
              model?: string;
              policyAction?: string;
              policyReason?: string;
              hintServed?: boolean;
              hintStyle?: string;
              hintLevel?: string;
              rescueMode?: string;
              hintGranularity?: string;
              hintTier?: string;
              hintCost?: number;
              hintInitiator?: string;
              hintRequestTiming?: string;
              momentumAtHint?: string;
              escalationReason?: string;
              signals?: unknown;
              decision?: unknown;
              intent?: unknown;
              trajectory?: unknown;
              candidateDna?: unknown;
              shadowPolicy?: unknown;
              criticVerdict?: unknown;
              providerFailure?: {
                provider: "gemini" | "openai";
                message: string;
              };
              usage?: {
                inputTokens: number;
                outputTokens: number;
                estimatedCostUsd: number | null;
              };
            }
          | undefined;

        for await (const chunk of streamAssistantTurn(input, { signal: request.signal })) {
          if (request.signal.aborted) {
            controller.close();
            return;
          }

          if (chunk.textDelta) {
            controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: chunk.textDelta })}\n\n`));
          }

          if (chunk.meta) {
            controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify(chunk.meta)}\n\n`));
          }

          if (chunk.final) {
            finalTurn = chunk.final;
          }
        }

        if (!finalTurn || request.signal.aborted) {
          controller.close();
          return;
        }

        const projectedBudget = assessSessionBudget(session.events, finalTurn.usage?.estimatedCostUsd ?? 0);
        if (projectedBudget.exceeded && !session.endedAt) {
          const budgetReply = buildBudgetExceededReply(projectedBudget);
          const result = await enforceSessionBudgetLimit({
            sessionId: id,
            currentStage,
            source: finalTurn.source,
            reply: budgetReply,
            usage: finalTurn.usage
              ? {
                  model: finalTurn.model ?? null,
                  inputTokens: finalTurn.usage.inputTokens,
                  outputTokens: finalTurn.usage.outputTokens,
                  estimatedCostUsd: finalTurn.usage.estimatedCostUsd,
                }
              : null,
            existingTranscriptCount: session.transcripts.length,
            budget: projectedBudget,
            lowCostMode,
          });

          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({
                transcript: result.transcript,
                events: result.events,
                meta: {
                  source: finalTurn.source,
                  currentStage,
                  suggestedStage: null,
                  budgetExceeded: true,
                  budget: projectedBudget,
                },
              })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        const lastSegment = session.transcripts.at(-1);
        const segmentIndex = lastSegment ? lastSegment.segmentIndex + 1 : 0;

        const transcript = await prisma.transcriptSegment.create({
          data: {
            sessionId: id,
            speaker: "AI",
            segmentIndex,
            text: finalTurn.reply,
            isFinal: true,
          },
        });

        const events: Array<{
          id: string;
          eventType: string;
          eventTime?: Date;
          payloadJson?: unknown;
        }> = [];

        if (finalTurn.signals) {
          const signalEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.SIGNAL_SNAPSHOT_RECORDED,
              payloadJson: {
                stage: currentStage,
                source: finalTurn.source,
                signals: finalTurn.signals,
              },
            },
          });
          events.push(signalEvent);
        }

        if (finalTurn.decision) {
          const decisionEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.DECISION_RECORDED,
              payloadJson: {
                stage: currentStage,
                source: finalTurn.source,
                decision: finalTurn.decision,
              },
            },
          });
          events.push(decisionEvent);
        }

        if (finalTurn.intent) {
          const intentEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.INTENT_SNAPSHOT_RECORDED,
              payloadJson: {
                stage: currentStage,
                source: finalTurn.source,
                intent: finalTurn.intent,
              },
            },
          });
          events.push(intentEvent);
        }

        if (finalTurn.trajectory) {
          const trajectoryEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.TRAJECTORY_SNAPSHOT_RECORDED,
              payloadJson: {
                stage: currentStage,
                source: finalTurn.source,
                trajectory: finalTurn.trajectory,
              },
            },
          });
          events.push(trajectoryEvent);
        }

        if (finalTurn.candidateDna) {
          const dnaEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.CANDIDATE_DNA_RECORDED,
              payloadJson: {
                stage: currentStage,
                source: finalTurn.source,
                candidateDna: finalTurn.candidateDna,
              },
            },
          });
          events.push(dnaEvent);
        }

        if (finalTurn.shadowPolicy) {
          const shadowPolicyEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.SHADOW_POLICY_EVALUATED,
              payloadJson: {
                stage: currentStage,
                source: finalTurn.source,
                shadowPolicy: finalTurn.shadowPolicy,
              },
            },
          });
          events.push(shadowPolicyEvent);
        }

        if (finalTurn.criticVerdict) {
          const criticEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.CRITIC_VERDICT_RECORDED,
              payloadJson: {
                stage: currentStage,
                source: finalTurn.source,
                criticVerdict: finalTurn.criticVerdict,
              },
            },
          });
          events.push(criticEvent);
        }

        await persistSessionSnapshots({
          sessionId: id,
          stage: currentStage,
          source: finalTurn.source,
          signals: finalTurn.signals,
          decision: finalTurn.decision,
          intent: finalTurn.intent,
          trajectory: finalTurn.trajectory,
        });

        const aiSpokeEvent = await prisma.sessionEvent.create({
          data: {
            sessionId: id,
            eventType: SESSION_EVENT_TYPES.AI_SPOKE,
              payloadJson: {
                transcriptSegmentId: transcript.id,
                source: finalTurn.source,
                policyAction: finalTurn.policyAction ?? null,
                currentStage,
                hintServed: finalTurn.hintServed ?? false,
                hintLevel: finalTurn.hintLevel ?? null,
                escalationReason: finalTurn.escalationReason ?? null,
                signals: finalTurn.signals ?? null,
                decision: finalTurn.decision ?? null,
                intent: finalTurn.intent ?? null,
                trajectory: finalTurn.trajectory ?? null,
                providerFailure: finalTurn.providerFailure ?? null,
              },
            },
        });
        events.push(aiSpokeEvent);

        if (finalTurn.usage) {
          const usageEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.LLM_USAGE_RECORDED,
              payloadJson: {
                source: finalTurn.source,
                model: finalTurn.model ?? null,
                inputTokens: finalTurn.usage.inputTokens,
                outputTokens: finalTurn.usage.outputTokens,
                estimatedCostUsd: finalTurn.usage.estimatedCostUsd,
                lowCostMode,
              },
            },
          });
          events.push(usageEvent);
        }

        if (finalTurn.suggestedStage && finalTurn.suggestedStage !== currentStage) {
          const stageEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.STAGE_ADVANCED,
              payloadJson: {
                previousStage: currentStage,
                stage: finalTurn.suggestedStage,
                source: finalTurn.source,
                reason: finalTurn.policyReason ?? null,
              },
            },
          });
          events.push(stageEvent);
        }

        if (finalTurn.hintServed) {
          const hintServedEvent = await prisma.sessionEvent.create({
            data: {
              sessionId: id,
              eventType: SESSION_EVENT_TYPES.HINT_SERVED,
              payloadJson: {
                stage: currentStage,
                source: finalTurn.source,
                hintStyle: finalTurn.hintStyle ?? null,
                hintLevel: finalTurn.hintLevel ?? null,
                rescueMode: finalTurn.rescueMode ?? null,
                hintGranularity: finalTurn.hintGranularity ?? null,
                hintTier: finalTurn.hintTier ?? null,
                hintCost: finalTurn.hintCost ?? null,
                hintInitiator: finalTurn.hintInitiator ?? null,
                hintRequestTiming: finalTurn.hintRequestTiming ?? null,
                momentumAtHint: finalTurn.momentumAtHint ?? null,
                escalationReason: finalTurn.escalationReason ?? null,
                reason: finalTurn.policyReason ?? null,
              },
            },
          });
          events.push(hintServedEvent);
        }

        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({
              transcript,
              events,
              meta: {
                source: finalTurn.source,
                currentStage,
                suggestedStage: finalTurn.suggestedStage ?? null,
                policyAction: finalTurn.policyAction ?? null,
                hintServed: finalTurn.hintServed ?? false,
                hintLevel: finalTurn.hintLevel ?? null,
                rescueMode: finalTurn.rescueMode ?? null,
                hintGranularity: finalTurn.hintGranularity ?? null,
                hintTier: finalTurn.hintTier ?? null,
                hintCost: finalTurn.hintCost ?? null,
                hintInitiator: finalTurn.hintInitiator ?? null,
                hintRequestTiming: finalTurn.hintRequestTiming ?? null,
                momentumAtHint: finalTurn.momentumAtHint ?? null,
                escalationReason: finalTurn.escalationReason ?? null,
                signals: finalTurn.signals ?? null,
                decision: finalTurn.decision ?? null,
                intent: finalTurn.intent ?? null,
                trajectory: finalTurn.trajectory ?? null,
                criticVerdict: finalTurn.criticVerdict ?? null,
                providerFailure: finalTurn.providerFailure ?? null,
              },
            })}\n\n`,
          ),
        );
        controller.close();
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({
              message: error instanceof Error ? error.message : "Assistant streaming failed.",
            })}\n\n`,
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}







