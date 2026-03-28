import { Prisma } from "@prisma/client";
import { deriveCurrentCodingStage } from "@/lib/assistant/stages";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { executeCode } from "@/lib/sandbox/execute";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { createExecutionRunSchema } from "@/schemas/session-runtime";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, { params }: RouteContext) {
  const { id } = await params;

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
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

  const executionRuns = await prisma.executionRun.findMany({
    where: { sessionId: id },
    include: {
      codeSnapshot: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return ok({ executionRuns });
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = createExecutionRunSchema.safeParse(body);

  if (!parsed.success) {
    return fail("Invalid request body", 400, {
      issues: parsed.error.flatten(),
    });
  }

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
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

  const lastSnapshot = await prisma.codeSnapshot.findFirst({
    where: { sessionId: id },
    orderBy: { snapshotIndex: "desc" },
    select: { snapshotIndex: true },
  });

  const snapshot = await prisma.codeSnapshot.create({
    data: {
      sessionId: id,
      language: parsed.data.language,
      content: parsed.data.code,
      snapshotIndex: (lastSnapshot?.snapshotIndex ?? -1) + 1,
      source: parsed.data.source,
    },
  });

  await prisma.sessionEvent.create({
    data: {
      sessionId: id,
      eventType: SESSION_EVENT_TYPES.CODE_SNAPSHOT_SAVED,
      payloadJson: {
        codeSnapshotId: snapshot.id,
        language: parsed.data.language,
        source: parsed.data.source,
      },
    },
  });

  await prisma.sessionEvent.create({
    data: {
      sessionId: id,
      eventType: SESSION_EVENT_TYPES.CODE_RUN_REQUESTED,
      payloadJson: {
        codeSnapshotId: snapshot.id,
        language: parsed.data.language,
      },
    },
  });

  const result = await executeCode({
    language: parsed.data.language,
    code: parsed.data.code,
    stdin: parsed.data.stdin,
  });

  const executionRun = await prisma.executionRun.create({
    data: {
      sessionId: id,
      codeSnapshotId: snapshot.id,
      stdin: parsed.data.stdin,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      runtimeMs: result.runtimeMs,
      memoryKb: result.memoryKb,
    },
    include: {
      codeSnapshot: true,
    },
  });

  await prisma.sessionEvent.create({
    data: {
      sessionId: id,
      eventType: SESSION_EVENT_TYPES.CODE_RUN_COMPLETED,
      payloadJson: {
        codeSnapshotId: snapshot.id,
        executionRunId: executionRun.id,
        status: result.status,
        runtimeMs: result.runtimeMs,
      } satisfies Prisma.InputJsonObject,
    },
  });

  const currentStage = deriveCurrentCodingStage({
    events: session.events,
    transcripts: session.transcripts,
    latestExecutionRun: session.executionRuns[0] ?? null,
  });

  const nextStage =
    result.status === "PASSED"
      ? currentStage === "IMPLEMENTATION" || currentStage === "DEBUGGING"
        ? "TESTING_AND_COMPLEXITY"
        : null
      : result.status === "FAILED" || result.status === "ERROR" || result.status === "TIMEOUT"
        ? "DEBUGGING"
        : null;

  if (nextStage && nextStage !== currentStage) {
    await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        eventType: SESSION_EVENT_TYPES.STAGE_ADVANCED,
        payloadJson: {
          previousStage: currentStage,
          stage: nextStage,
          source: "code-run-policy",
          reason:
            result.status === "PASSED"
              ? "A passing run completed implementation/debugging, so the interview should move into testing and complexity."
              : "A failing run should move the interview into debugging.",
        } satisfies Prisma.InputJsonObject,
      },
    });
  }

  return ok({ executionRun, snapshot }, { status: 201 });
}
