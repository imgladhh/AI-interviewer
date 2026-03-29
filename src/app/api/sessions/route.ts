import { ensureSeedData } from "@/lib/seed";
import { prisma } from "@/lib/db";
import { buildAppliedPromptContext, buildPersonaSnapshot } from "@/lib/persona/build-persona-context";
import { fail, ok } from "@/lib/http";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { createSessionSchema } from "@/schemas/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createSessionSchema.safeParse(body);

  if (!parsed.success) {
    return fail("Invalid request body", 400, {
      issues: parsed.error.flatten(),
    });
  }

  await ensureSeedData();

  const input = parsed.data;
  const user = await prisma.user.findFirst({
    where: { email: "demo@example.com" },
  });

  if (!user) {
    return fail("Demo user not found", 500);
  }

  let interviewerProfile = null;
  if (input.personaEnabled && input.interviewerProfileId) {
    interviewerProfile = await prisma.interviewerProfile.findUnique({
      where: { id: input.interviewerProfileId },
    });

    if (!interviewerProfile) {
      return fail("Interviewer profile not found", 404);
    }
  }

  const personaReady = interviewerProfile?.status === "READY";

  const question = await prisma.question.findFirst({
    where: {
      type: input.mode,
      isActive: true,
      ...(input.companyStyle ? { companyStyle: input.companyStyle } : {}),
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      ...(input.targetLevel ? { levelTarget: input.targetLevel } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  const session = await prisma.interviewSession.create({
    data: {
      userId: user.id,
      questionId: question?.id,
      mode: input.mode,
      status: "READY",
      selectedLanguage: input.selectedLanguage,
      companyStyle: input.companyStyle,
      targetLevel: input.targetLevel,
      voiceEnabled: input.voiceEnabled,
      interviewerProfileId: interviewerProfile?.id,
      interviewerProfileUrl: interviewerProfile?.sourceUrl,
      personaEnabled: Boolean(input.personaEnabled && interviewerProfile),
      personaStatus: interviewerProfile?.status,
    },
  });

  if (personaReady && interviewerProfile) {
    const personaSnapshot = buildPersonaSnapshot(interviewerProfile);

    await prisma.sessionInterviewerContext.create({
      data: {
        sessionId: session.id,
        interviewerProfileId: interviewerProfile.id,
        personaSnapshotJson: personaSnapshot,
        appliedPromptContext: buildAppliedPromptContext(personaSnapshot),
      },
    });
  }

  await prisma.sessionEvent.create({
    data: {
      sessionId: session.id,
      eventType: SESSION_EVENT_TYPES.SESSION_CREATED,
      payloadJson: {
        mode: input.mode,
        targetLevel: input.targetLevel,
        questionId: question?.id ?? null,
        interviewerProfileId: interviewerProfile?.id ?? null,
        personaApplied: personaReady,
        lowCostMode: input.lowCostMode,
      },
    },
  });

  if (question?.id) {
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: SESSION_EVENT_TYPES.QUESTION_ASSIGNED,
        payloadJson: {
          questionId: question.id,
          title: question.title,
        },
      },
    });
  }

  await prisma.sessionEvent.create({
    data: {
      sessionId: session.id,
      eventType: SESSION_EVENT_TYPES.INTERVIEW_READY,
      payloadJson: {
        personaEnabled: Boolean(input.personaEnabled && interviewerProfile),
        voiceEnabled: input.voiceEnabled,
        lowCostMode: input.lowCostMode,
      },
    },
  });

  return ok(
    {
      sessionId: session.id,
      status: session.status,
      personaStatus: session.personaStatus,
      interviewerContextApplied: personaReady,
      questionId: session.questionId,
      launch: {
        roomUrl: `/interview/${session.id}`,
      },
    },
    { status: 201 },
  );
}
