import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { detectSourceType } from "@/lib/persona/detect-source-type";
import { logPersonaJobEvent } from "@/lib/persona/job-events";
import { enqueuePersonaIngestion, removeExistingPersonaJob } from "@/lib/persona/queue";
import { normalizeUrl } from "@/lib/persona/normalize-url";
import { interviewerProfileUrlSchema } from "@/schemas/interviewer-profile";
import { isPersonaIngestionEnabled } from "@/lib/security/feature-flags";

export async function POST(request: Request) {
  if (!isPersonaIngestionEnabled()) {
    return fail("Persona ingestion is disabled", 503, { code: "PERSONA_INGESTION_DISABLED" });
  }
  const body = await request.json().catch(() => null);
  const parsed = interviewerProfileUrlSchema.safeParse(body);

  if (!parsed.success) {
    return fail("Invalid request body", 400, {
      issues: parsed.error.flatten(),
    });
  }

  const normalizedUrl = normalizeUrl(parsed.data.url);
  const sourceType = detectSourceType(normalizedUrl);

  if (sourceType === "LINKEDIN" || sourceType === "OTHER") {
    return fail("This URL type is not currently supported for ingestion.", 400);
  }

  const existing = await prisma.interviewerProfile.findFirst({
    where: { sourceUrl: normalizedUrl },
  });

  const profile =
    existing ??
    (await prisma.interviewerProfile.create({
      data: {
        sourceUrl: normalizedUrl,
        sourceType,
        status: "PENDING",
        fetchStatus: "PENDING",
        sources: {
          create: {
            url: normalizedUrl,
            sourceType,
            fetchStatus: "PENDING",
          },
        },
      },
    }));

  await prisma.interviewerProfile.update({
    where: { id: profile.id },
    data: {
      fullName: null,
      headline: null,
      currentCompany: null,
      currentRole: null,
      location: null,
      bioSummary: null,
      specialties: Prisma.DbNull,
      education: Prisma.DbNull,
      publications: Prisma.DbNull,
      signalsJson: Prisma.DbNull,
      personaSummary: null,
      seniorityEstimate: null,
      technicalFocus: Prisma.DbNull,
      likelyInterviewFocus: Prisma.DbNull,
      communicationStyleGuess: Prisma.DbNull,
      confidence: null,
      fetchedAt: null,
      status: "PENDING",
      fetchStatus: "PENDING",
      sources: {
        updateMany: {
          where: { interviewerProfileId: profile.id },
          data: {
            fetchStatus: "PENDING",
            errorMessage: null,
            fetchedAt: null,
            rawTextExcerpt: null,
            normalizedContent: null,
          },
        },
      },
    },
  });

  await removeExistingPersonaJob(profile.id);
  await logPersonaJobEvent(profile.id, "JOB_RESET", {
    sourceUrl: normalizedUrl,
  });

  const job = await enqueuePersonaIngestion({
    interviewerProfileId: profile.id,
  });

  await logPersonaJobEvent(profile.id, "JOB_ENQUEUED", {
    sourceUrl: normalizedUrl,
    jobId: String(job.id),
    attemptsAllowed: typeof job.opts.attempts === "number" ? job.opts.attempts : 1,
  });

  return ok(
    {
      id: profile.id,
      status: "PENDING",
      fetchStatus: "PENDING",
      job: {
        id: String(job.id),
        state: "queued",
        attemptsMade: 0,
        attemptsAllowed: typeof job.opts.attempts === "number" ? job.opts.attempts : 1,
      },
    },
    { status: 201 },
  );
}
