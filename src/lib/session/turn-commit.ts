import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export type TurnClaim =
  | { status: "claimed" }
  | { status: "in_progress"; retryAfterMs: number }
  | { status: "completed"; result: unknown };

type TurnCommitClient = Pick<PrismaClient, "sessionTurnCommit">;

export async function claimAssistantTurn(sessionId: string, turnId: string): Promise<TurnClaim> {
  const existing = await prisma.sessionTurnCommit.findUnique({ where: { sessionId_turnId: { sessionId, turnId } } });
  if (existing?.status === "COMPLETED") return { status: "completed", result: existing.resultJson };
  if (existing?.status === "IN_PROGRESS") return { status: "in_progress", retryAfterMs: 750 };
  if (existing?.status === "FAILED") {
    const recovered = await prisma.sessionTurnCommit.updateMany({
      where: { sessionId, turnId, status: "FAILED" },
      data: { status: "IN_PROGRESS", responseTranscriptId: null, resultJson: Prisma.DbNull },
    });
    return recovered.count === 1 ? { status: "claimed" } : { status: "in_progress", retryAfterMs: 750 };
  }
  try {
    await prisma.sessionTurnCommit.create({ data: { sessionId, turnId, status: "IN_PROGRESS" } });
    return { status: "claimed" };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const raced = await prisma.sessionTurnCommit.findUnique({ where: { sessionId_turnId: { sessionId, turnId } } });
    return raced?.status === "COMPLETED"
      ? { status: "completed", result: raced.resultJson }
      : { status: "in_progress", retryAfterMs: 750 };
  }
}

export async function completeAssistantTurn(
  client: TurnCommitClient,
  input: { sessionId: string; turnId: string; responseTranscriptId: string; result: Prisma.InputJsonValue },
) {
  await client.sessionTurnCommit.update({
    where: { sessionId_turnId: { sessionId: input.sessionId, turnId: input.turnId } },
    data: { status: "COMPLETED", responseTranscriptId: input.responseTranscriptId, resultJson: input.result },
  });
}

export async function failAssistantTurn(sessionId: string, turnId: string) {
  await prisma.sessionTurnCommit.updateMany({ where: { sessionId, turnId, status: "IN_PROGRESS" }, data: { status: "FAILED" } });
}
