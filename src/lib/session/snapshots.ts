import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";

let snapshotPersistenceDisabled = false;
let hasWarnedAboutMissingSnapshotTables = false;

function escapeJson(value: unknown) {
  const json = JSON.stringify(value ?? null);
  return json.replace(/'/g, "''");
}

function escapeText(value: string | null | undefined) {
  if (!value) {
    return "NULL";
  }

  return `'${value.replace(/'/g, "''")}'`;
}

export async function persistSessionSnapshots(input: {
  sessionId: string;
  stage?: string | null;
  source?: string | null;
  signals?: unknown;
  decision?: unknown;
}) {
  if (snapshotPersistenceDisabled) {
    return;
  }

  const operations: Promise<unknown>[] = [];

  if (input.signals) {
    operations.push(
      prisma.$executeRawUnsafe(
        `INSERT INTO "CandidateStateSnapshot" ("id", "sessionId", "stage", "source", "snapshotJson", "createdAt") VALUES ('${randomUUID()}', '${input.sessionId}', ${escapeText(input.stage)}, ${escapeText(input.source)}, '${escapeJson(input.signals)}'::jsonb, NOW())`,
      ),
    );
  }

  if (input.decision) {
    operations.push(
      prisma.$executeRawUnsafe(
        `INSERT INTO "InterviewerDecisionSnapshot" ("id", "sessionId", "stage", "source", "decisionJson", "createdAt") VALUES ('${randomUUID()}', '${input.sessionId}', ${escapeText(input.stage)}, ${escapeText(input.source)}, '${escapeJson(input.decision)}'::jsonb, NOW())`,
      ),
    );
  }

  if (operations.length === 0) {
    return;
  }

  try {
    await Promise.all(operations);
  } catch (error) {
    const isMissingSnapshotTable =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2010" &&
      "meta" in error &&
      typeof (error as { meta?: unknown }).meta === "object" &&
      (error as { meta?: { code?: string; message?: string } }).meta?.code === "42P01";

    if (isMissingSnapshotTable) {
      snapshotPersistenceDisabled = true;

      if (!hasWarnedAboutMissingSnapshotTables && process.env.NODE_ENV !== "production") {
        hasWarnedAboutMissingSnapshotTables = true;
        console.warn(
          "[session-snapshots] snapshot tables are missing in the current database, so snapshot persistence has been disabled. Apply the session_state_snapshots migration to enable it again.",
        );
      }

      return;
    }

    if (process.env.NODE_ENV !== "production") {
      console.warn("[session-snapshots] snapshot persistence skipped", error);
    }
  }
}

