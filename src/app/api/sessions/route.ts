import { ensureSeedData } from "@/lib/seed";
import { prisma } from "@/lib/db";
import { buildAppliedPromptContext, buildPersonaSnapshot } from "@/lib/persona/build-persona-context";
import { fail, ok } from "@/lib/http";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { enforceMutationGuard } from "@/lib/security/request-guard";
import { createSessionSchema } from "@/schemas/session";
import { CompanyStyle } from "@prisma/client";
import type { z } from "zod";

type CreateSessionInput = z.infer<typeof createSessionSchema>;

async function findQuestionForSession(input: CreateSessionInput) {
  if (input.questionId) {
    return prisma.question.findFirst({
      where: {
        id: input.questionId,
        isActive: true,
        type: input.mode,
      },
    });
  }

  const baseWhere = {
    type: input.mode,
    isActive: true,
    ...(input.difficulty ? { difficulty: input.difficulty } : {}),
    ...(input.mode === "CODING" && input.targetLevel ? { levelTarget: input.targetLevel } : {}),
  };

  if (input.companyStyle && input.companyStyle !== CompanyStyle.GENERIC) {
    const companySpecific = await prisma.question.findMany({
      where: {
        ...baseWhere,
        companyStyle: input.companyStyle,
      },
      orderBy: { createdAt: "asc" },
    });

    if (companySpecific.length > 0) {
      return companySpecific[Math.floor(Math.random() * companySpecific.length)];
    }

    const genericFallback = await prisma.question.findMany({
      where: {
        ...baseWhere,
        companyStyle: CompanyStyle.GENERIC,
      },
      orderBy: { createdAt: "asc" },
    });

    return genericFallback.length > 0
      ? genericFallback[Math.floor(Math.random() * genericFallback.length)]
      : null;
  }

  const candidates = await prisma.question.findMany({
    where: {
      ...baseWhere,
      ...(input.companyStyle && input.companyStyle !== CompanyStyle.GENERIC
        ? {}
        : { companyStyle: CompanyStyle.GENERIC }),
    },
    orderBy: { createdAt: "asc" },
  });

  return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
}

export async function POST(request: Request) {
  const guarded = enforceMutationGuard(request, "session_create");
  if (guarded) {
    return guarded;
  }
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

  const question = await findQuestionForSession(input);

  if (!question) {
    return fail("No active question matches the requested interview configuration.", 409, {
      mode: input.mode,
      targetLevel: input.targetLevel,
      companyStyle: input.companyStyle,
      difficulty: input.difficulty,
    });
  }

  const session = await prisma.interviewSession.create({
    data: {
      userId: user.id,
      questionId: question.id,
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
        questionId: question.id,
        interviewerProfileId: interviewerProfile?.id ?? null,
        personaApplied: personaReady,
        lowCostMode: input.lowCostMode,
      },
    },
  });

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
