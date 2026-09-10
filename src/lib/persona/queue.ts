import { Job, Queue, QueueEvents } from "bullmq";
import { getRedis } from "@/lib/redis";

export const PERSONA_QUEUE_NAME = "persona-ingestion";

export type PersonaIngestionJobData = {
  interviewerProfileId: string;
};

const globalForPersonaQueue = globalThis as unknown as {
  personaQueue?: Queue<PersonaIngestionJobData>;
  personaQueueEvents?: QueueEvents;
};

export function getPersonaQueue() {
  if (!globalForPersonaQueue.personaQueue) {
    globalForPersonaQueue.personaQueue = new Queue<PersonaIngestionJobData>(PERSONA_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });
  }

  return globalForPersonaQueue.personaQueue;
}

export function getPersonaQueueEvents() {
  if (!globalForPersonaQueue.personaQueueEvents) {
    globalForPersonaQueue.personaQueueEvents = new QueueEvents(PERSONA_QUEUE_NAME, {
      connection: getRedis(),
    });
  }

  return globalForPersonaQueue.personaQueueEvents;
}

export async function enqueuePersonaIngestion(data: PersonaIngestionJobData) {
  return getPersonaQueue().add("ingest-public-profile", data, {
    jobId: data.interviewerProfileId,
  });
}

export async function removeExistingPersonaJob(profileId: string) {
  const existingJob = await getPersonaQueue().getJob(profileId);
  if (!existingJob) {
    return;
  }

  const state = await existingJob.getState();
  if (state === "active") {
    return;
  }

  await existingJob.remove();
}

export type PersonaJobSnapshot = {
  id: string;
  state:
    | "queued"
    | "processing"
    | "completed"
    | "failed"
    | "delayed"
    | "waiting-children"
    | "unknown";
  attemptsMade: number;
  attemptsAllowed: number;
  failedReason?: string | null;
  progress?: number | null;
  enqueuedAt?: number | null;
  processedAt?: number | null;
  finishedAt?: number | null;
};

export type PersonaJobEventSnapshot = {
  id: string;
  eventType: string;
  payloadJson: unknown;
  createdAt: string;
};

function normalizeJobState(state: string): PersonaJobSnapshot["state"] {
  if (state === "waiting" || state === "prioritized") return "queued";
  if (state === "active") return "processing";
  if (state === "completed") return "completed";
  if (state === "failed") return "failed";
  if (state === "delayed") return "delayed";
  if (state === "waiting-children") return "waiting-children";
  return "unknown";
}

export async function getPersonaJobSnapshot(profileId: string): Promise<PersonaJobSnapshot | null> {
  const job = await getPersonaQueue().getJob(profileId);
  if (!job) {
    return null;
  }

  const state = normalizeJobState(await job.getState());
  return mapJobToSnapshot(job, state);
}

function mapJobToSnapshot(job: Job<PersonaIngestionJobData>, state: PersonaJobSnapshot["state"]): PersonaJobSnapshot {
  return {
    id: job.id ?? job.name,
    state,
    attemptsMade: job.attemptsMade,
    attemptsAllowed: typeof job.opts.attempts === "number" ? job.opts.attempts : 1,
    failedReason: job.failedReason,
    progress: typeof job.progress === "number" ? job.progress : null,
    enqueuedAt: job.timestamp ?? null,
    processedAt: job.processedOn ?? null,
    finishedAt: job.finishedOn ?? null,
  };
}

export async function listPersonaJobEvents(profileId: string, limit = 20): Promise<PersonaJobEventSnapshot[]> {
  const { prisma } = await import("@/lib/db");

  const events = await prisma.personaJobEvent.findMany({
    where: { interviewerProfileId: profileId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    payloadJson: event.payloadJson,
    createdAt: event.createdAt.toISOString(),
  }));
}
