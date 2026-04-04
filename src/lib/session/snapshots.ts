import { prisma } from "@/lib/db";

let snapshotPersistenceDisabled = false;
let hasWarnedAboutMissingSnapshotTables = false;

type SnapshotRow = {
  id: string;
  sessionId: string;
  stage: string | null;
  source: string | null;
  createdAt: Date;
};

export type CandidateStateSnapshotRow = SnapshotRow & {
  snapshotJson: unknown;
};

export type InterviewerDecisionSnapshotRow = SnapshotRow & {
  decisionJson: unknown;
};

export type IntentSnapshotRow = SnapshotRow & {
  intentJson: unknown;
};

export type TrajectorySnapshotRow = SnapshotRow & {
  trajectoryJson: unknown;
};

type RawSnapshotClient = {
  $executeRawUnsafe?: (...args: unknown[]) => Promise<unknown>;
  $queryRawUnsafe?: <T>(...args: unknown[]) => Promise<T>;
};

function isMissingSnapshotTableError(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as {
    code?: string;
    meta?: { code?: string; message?: string };
  };

  return (
    maybeError.code === "P2021" ||
    (maybeError.code === "P2010" && maybeError.meta?.code === "42P01") ||
    maybeError.meta?.message?.includes("does not exist") === true
  );
}

function handleSnapshotError(error: unknown) {
  if (isMissingSnapshotTableError(error)) {
    snapshotPersistenceDisabled = true;

    if (!hasWarnedAboutMissingSnapshotTables && process.env.NODE_ENV !== "production") {
      hasWarnedAboutMissingSnapshotTables = true;
      console.warn(
        "[session-snapshots] snapshot tables are missing in the current database, so snapshot persistence has been disabled. Apply the session_state_snapshots migration to enable it again.",
      );
    }

    return true;
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("[session-snapshots] snapshot persistence skipped", error);
  }
  return false;
}

export async function persistSessionSnapshots(input: {
  sessionId: string;
  stage?: string | null;
  source?: string | null;
  signals?: unknown;
  decision?: unknown;
  intent?: unknown;
  trajectory?: unknown;
}) {
  if (snapshotPersistenceDisabled) {
    return;
  }

  const rawClient = prisma as unknown as RawSnapshotClient;
  if (!rawClient.$executeRawUnsafe) {
    return;
  }

  const operations: Promise<unknown>[] = [];

  if (input.signals) {
    operations.push(
      rawClient.$executeRawUnsafe(
        'INSERT INTO "CandidateStateSnapshot" ("sessionId", stage, source, "snapshotJson") VALUES ($1, $2, $3, $4::jsonb)',
        input.sessionId,
        input.stage ?? null,
        input.source ?? null,
        JSON.stringify(input.signals),
      ),
    );
  }

  if (input.decision) {
    operations.push(
      rawClient.$executeRawUnsafe(
        'INSERT INTO "InterviewerDecisionSnapshot" ("sessionId", stage, source, "decisionJson") VALUES ($1, $2, $3, $4::jsonb)',
        input.sessionId,
        input.stage ?? null,
        input.source ?? null,
        JSON.stringify(input.decision),
      ),
    );
  }

  if (input.intent) {
    operations.push(
      rawClient.$executeRawUnsafe(
        'INSERT INTO "IntentSnapshot" ("sessionId", stage, source, "intentJson") VALUES ($1, $2, $3, $4::jsonb)',
        input.sessionId,
        input.stage ?? null,
        input.source ?? null,
        JSON.stringify(input.intent),
      ),
    );
  }

  if (input.trajectory) {
    operations.push(
      rawClient.$executeRawUnsafe(
        'INSERT INTO "TrajectorySnapshot" ("sessionId", stage, source, "trajectoryJson") VALUES ($1, $2, $3, $4::jsonb)',
        input.sessionId,
        input.stage ?? null,
        input.source ?? null,
        JSON.stringify(input.trajectory),
      ),
    );
  }

  if (operations.length === 0) {
    return;
  }

  try {
    await Promise.all(operations);
  } catch (error) {
    handleSnapshotError(error);
  }
}

export async function readCandidateStateSnapshots(sessionId: string): Promise<CandidateStateSnapshotRow[]> {
  if (snapshotPersistenceDisabled) {
    return [];
  }

  const rawClient = prisma as unknown as RawSnapshotClient;
  if (!rawClient.$queryRawUnsafe) {
    return [];
  }

  try {
    const rows = await rawClient.$queryRawUnsafe<CandidateStateSnapshotRow[]>(
      'SELECT id, "sessionId", stage, source, "snapshotJson", "createdAt" FROM "CandidateStateSnapshot" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC',
      sessionId,
    );
    return rows;
  } catch (error) {
    if (handleSnapshotError(error)) {
      return [];
    }
    throw error;
  }
}

export async function readInterviewerDecisionSnapshots(sessionId: string): Promise<InterviewerDecisionSnapshotRow[]> {
  if (snapshotPersistenceDisabled) {
    return [];
  }

  const rawClient = prisma as unknown as RawSnapshotClient;
  if (!rawClient.$queryRawUnsafe) {
    return [];
  }

  try {
    const rows = await rawClient.$queryRawUnsafe<InterviewerDecisionSnapshotRow[]>(
      'SELECT id, "sessionId", stage, source, "decisionJson", "createdAt" FROM "InterviewerDecisionSnapshot" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC',
      sessionId,
    );
    return rows;
  } catch (error) {
    if (handleSnapshotError(error)) {
      return [];
    }
    throw error;
  }
}

export async function readIntentSnapshots(sessionId: string): Promise<IntentSnapshotRow[]> {
  if (snapshotPersistenceDisabled) {
    return [];
  }

  const rawClient = prisma as unknown as RawSnapshotClient;
  if (!rawClient.$queryRawUnsafe) {
    return [];
  }

  try {
    const rows = await rawClient.$queryRawUnsafe<IntentSnapshotRow[]>(
      'SELECT id, "sessionId", stage, source, "intentJson", "createdAt" FROM "IntentSnapshot" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC',
      sessionId,
    );
    return rows;
  } catch (error) {
    if (handleSnapshotError(error)) {
      return [];
    }
    throw error;
  }
}

export async function readTrajectorySnapshots(sessionId: string): Promise<TrajectorySnapshotRow[]> {
  if (snapshotPersistenceDisabled) {
    return [];
  }

  const rawClient = prisma as unknown as RawSnapshotClient;
  if (!rawClient.$queryRawUnsafe) {
    return [];
  }

  try {
    const rows = await rawClient.$queryRawUnsafe<TrajectorySnapshotRow[]>(
      'SELECT id, "sessionId", stage, source, "trajectoryJson", "createdAt" FROM "TrajectorySnapshot" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC',
      sessionId,
    );
    return rows;
  } catch (error) {
    if (handleSnapshotError(error)) {
      return [];
    }
    throw error;
  }
}
