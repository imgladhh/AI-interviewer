import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { logPersonaJobEvent } from "@/lib/persona/job-events";
import { redis } from "@/lib/redis";
import { runPersonaIngestion } from "@/lib/persona/ingest-public-profile";
import { PERSONA_QUEUE_NAME, personaQueueEvents, type PersonaIngestionJobData } from "@/lib/persona/queue";

const worker = new Worker<PersonaIngestionJobData>(
  PERSONA_QUEUE_NAME,
  async (job) => {
    await logPersonaJobEvent(job.data.interviewerProfileId, "JOB_PROCESSING_STARTED", {
      jobId: String(job.id),
      attemptsMade: job.attemptsMade,
      attemptsAllowed: typeof job.opts.attempts === "number" ? job.opts.attempts : 1,
    });

    await job.updateProgress(10);

    await prisma.interviewerProfile.update({
      where: { id: job.data.interviewerProfileId },
      data: {
        status: "PROCESSING",
        fetchStatus: "FETCHING",
        sources: {
          updateMany: {
            where: { interviewerProfileId: job.data.interviewerProfileId },
            data: {
              fetchStatus: "FETCHING",
              errorMessage: null,
            },
          },
        },
      },
    });

    await job.updateProgress(45);
    await runPersonaIngestion(job.data.interviewerProfileId, job.attemptsMade + 1);
    await job.updateProgress(100);
  },
  {
    connection: redis,
    concurrency: 4,
  },
);

worker.on("completed", (job) => {
  console.log(`[persona-worker] completed job ${job.id}`);
  void logPersonaJobEvent(job.data.interviewerProfileId, "JOB_COMPLETED", {
    jobId: String(job.id),
    attemptsMade: job.attemptsMade,
    finishedOn: job.finishedOn ?? null,
  });
});

worker.on("failed", async (job, error) => {
  console.error(`[persona-worker] job ${job?.id ?? "unknown"} failed`, error);

  const interviewerProfileId = job?.data?.interviewerProfileId;
  if (!interviewerProfileId) {
    return;
  }

  const attemptsAllowed = typeof job?.opts.attempts === "number" ? job.opts.attempts : 1;
  const shouldRetry = (job?.attemptsMade ?? 0) < attemptsAllowed;

  await logPersonaJobEvent(interviewerProfileId, shouldRetry ? "JOB_RETRY_SCHEDULED" : "JOB_FAILED", {
    jobId: String(job?.id ?? interviewerProfileId),
    attemptsMade: job?.attemptsMade ?? 0,
    attemptsAllowed,
    failedReason: error.message,
  });

  await prisma.interviewerProfile.update({
    where: { id: interviewerProfileId },
    data: {
      status: shouldRetry ? "PROCESSING" : "FAILED",
      fetchStatus: shouldRetry ? "FETCHING" : "FAILED",
      sources: {
        updateMany: {
          where: { interviewerProfileId },
          data: {
            fetchStatus: shouldRetry ? "FETCHING" : "FAILED",
            errorMessage: shouldRetry
              ? `Attempt ${job?.attemptsMade ?? 0} failed. Retrying automatically. ${error.message}`
              : error.message,
          },
        },
      },
    },
  });
});

worker.on("ready", () => {
  console.log("[persona-worker] ready and listening for jobs");
});

void personaQueueEvents.waitUntilReady().then(() => {
  console.log("[persona-worker] queue events ready");
});

personaQueueEvents.on("waiting", ({ jobId }) => {
  console.log(`[persona-worker] queued job ${jobId}`);
  if (typeof jobId === "string") {
    void logPersonaJobEvent(jobId, "JOB_QUEUED", {
      jobId,
    });
  }
});

personaQueueEvents.on("active", ({ jobId, prev }) => {
  console.log(`[persona-worker] processing job ${jobId} (from ${prev})`);
  if (typeof jobId === "string") {
    void logPersonaJobEvent(jobId, "JOB_ACTIVE_EVENT", {
      jobId,
      previousState: prev,
    });
  }
});

personaQueueEvents.on("completed", ({ jobId }) => {
  console.log(`[persona-worker] queue event completed ${jobId}`);
  if (typeof jobId === "string") {
    void logPersonaJobEvent(jobId, "JOB_COMPLETED_EVENT", {
      jobId,
    });
  }
});

personaQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.log(`[persona-worker] queue event failed ${jobId}: ${failedReason}`);
  if (typeof jobId === "string") {
    void logPersonaJobEvent(jobId, "JOB_FAILED_EVENT", {
      jobId,
      failedReason,
    });
  }
});

async function shutdown(signal: string) {
  console.log(`[persona-worker] shutting down on ${signal}`);
  await worker.close();
  await personaQueueEvents.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

