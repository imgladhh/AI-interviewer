import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { enforceMutationGuard } from "@/lib/security/request-guard";
import { clientSessionEventSchema } from "@/schemas/session-runtime";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, { params }: RouteContext) {
  const { id } = await params;

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!session) {
    return fail("Interview session not found", 404);
  }

  const events = await prisma.sessionEvent.findMany({
    where: { sessionId: id },
    orderBy: { eventTime: "desc" },
    take: 50,
  });

  return ok({ events });
}

export async function POST(request: Request, { params }: RouteContext) {
  const guarded = enforceMutationGuard(request, "event_write");
  if (guarded) {
    return guarded;
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = clientSessionEventSchema.safeParse(body);

  if (!parsed.success) {
    const eventType = body && typeof body === "object" ? (body as { eventType?: unknown }).eventType : null;
    const allowed = ["INTERVIEW_ROOM_OPENED", "LISTENING_STARTED", "LISTENING_STOPPED", "HINT_REQUESTED", "EDITOR_ACTIVITY_RECORDED", "WHITEBOARD_SIGNAL_RECORDED", "CANDIDATE_TURN_AUTOSUBMITTED", "AI_INTERRUPTED_BY_CANDIDATE"];
    return fail(typeof eventType === "string" && allowed.includes(eventType) ? "Invalid telemetry payload" : "Client cannot write this event type", typeof eventType === "string" && allowed.includes(eventType) ? 400 : 403, {
      issues: parsed.error.flatten(),
    });
  }

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!session) {
    return fail("Interview session not found", 404);
  }

  const event = await prisma.sessionEvent.create({
    data: {
      sessionId: id,
      eventType: parsed.data.eventType,
      payloadJson: parsed.data.payloadJson as Prisma.InputJsonObject | undefined,
    },
  });

  return ok({ event }, { status: 201 });
}
