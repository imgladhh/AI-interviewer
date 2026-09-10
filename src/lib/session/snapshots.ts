import { prisma } from "@/lib/db";

let hasWarnedAboutMissingSnapshotTables = false;

type SnapshotRow = {
  id: string;
  sessionId: string;
  stage: string | null;
  source: string | null;
  createdAt: Date;
};

export type DesignSignalKey =
  | "requirement_missing"
  | "capacity_missing"
  | "tradeoff_missed"
  | "spof_missed"
  | "bottleneck_unexamined";

export type DesignSignalSnapshot = {
  signals: Record<DesignSignalKey, boolean>;
  evidenceRefs: Record<DesignSignalKey, string[]>;
  summary: string;
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

export type SnapshotKind = "candidate_state" | "interviewer_decision" | "intent" | "trajectory";
export type SnapshotFailureKind = "schema_missing" | "transient_database" | "serialization" | "unknown";
export type SnapshotWriteResult = {
  status: "persisted" | "skipped" | "degraded";
  attemptedKinds: SnapshotKind[];
  persistedKinds: SnapshotKind[];
  failure?: { kind: SnapshotFailureKind; message: string };
};
export type SessionSnapshotBundle = {
  candidateStates: CandidateStateSnapshotRow[];
  decisions: InterviewerDecisionSnapshotRow[];
  intents: IntentSnapshotRow[];
  trajectories: TrajectorySnapshotRow[];
  health: { status: "healthy" | "degraded"; failure?: SnapshotFailureKind; diagnostics: string[] };
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

function failureFor(error: unknown): SnapshotWriteResult["failure"] {
  if (isMissingSnapshotTableError(error)) {
    if (!hasWarnedAboutMissingSnapshotTables && process.env.NODE_ENV !== "production") {
      hasWarnedAboutMissingSnapshotTables = true;
      console.warn(
        "[session-snapshots] snapshot tables are missing. Apply the session_state_snapshots migration; future writes will retry.",
      );
    }
    return { kind: "schema_missing", message: "snapshot projection tables are unavailable" };
  }
  if (error instanceof SyntaxError) return { kind: "serialization", message: "snapshot payload cannot be serialized" };
  return { kind: "transient_database", message: "snapshot projection write failed" };
}

export async function persistSessionSnapshots(input: {
  sessionId: string;
  stage?: string | null;
  source?: string | null;
  signals?: unknown;
  decision?: unknown;
  intent?: unknown;
  trajectory?: unknown;
}): Promise<SnapshotWriteResult> {
  const rawClient = prisma as unknown as RawSnapshotClient;
  if (!rawClient.$executeRawUnsafe) {
    return { status: "skipped", attemptedKinds: [], persistedKinds: [] };
  }
  const operations: Array<{ kind: SnapshotKind; run: (client: RawSnapshotClient) => Promise<unknown> }> = [];

  if (input.signals) {
    operations.push({ kind: "candidate_state", run: (client) => client.$executeRawUnsafe!(
        'INSERT INTO "CandidateStateSnapshot" ("sessionId", stage, source, "snapshotJson") VALUES ($1, $2, $3, $4::jsonb)',
        input.sessionId,
        input.stage ?? null,
        input.source ?? null,
        JSON.stringify(input.signals),
      ) });
  }

  if (input.decision) {
    operations.push({ kind: "interviewer_decision", run: (client) => client.$executeRawUnsafe!(
        'INSERT INTO "InterviewerDecisionSnapshot" ("sessionId", stage, source, "decisionJson") VALUES ($1, $2, $3, $4::jsonb)',
        input.sessionId,
        input.stage ?? null,
        input.source ?? null,
        JSON.stringify(input.decision),
      ) });
  }

  if (input.intent) {
    operations.push({ kind: "intent", run: (client) => client.$executeRawUnsafe!(
        'INSERT INTO "IntentSnapshot" ("sessionId", stage, source, "intentJson") VALUES ($1, $2, $3, $4::jsonb)',
        input.sessionId,
        input.stage ?? null,
        input.source ?? null,
        JSON.stringify(input.intent),
      ) });
  }

  if (input.trajectory) {
    operations.push({ kind: "trajectory", run: (client) => client.$executeRawUnsafe!(
        'INSERT INTO "TrajectorySnapshot" ("sessionId", stage, source, "trajectoryJson") VALUES ($1, $2, $3, $4::jsonb)',
        input.sessionId,
        input.stage ?? null,
        input.source ?? null,
        JSON.stringify(input.trajectory),
      ) });
  }

  if (operations.length === 0) {
    return { status: "skipped", attemptedKinds: [], persistedKinds: [] };
  }

  try {
    await prisma.$transaction(async (transaction) => {
      const client = transaction as unknown as RawSnapshotClient;
      for (const operation of operations) await operation.run(client);
    });
    return { status: "persisted", attemptedKinds: operations.map((item) => item.kind), persistedKinds: operations.map((item) => item.kind) };
  } catch (error) {
    const failure = failureFor(error) as NonNullable<SnapshotWriteResult["failure"]>;
    if (process.env.NODE_ENV !== "production" && failure.kind !== "schema_missing") console.warn("[session-snapshots] snapshot projection degraded", error);
    return { status: "degraded", attemptedKinds: operations.map((item) => item.kind), persistedKinds: [], failure };
  }
}

export async function readCandidateStateSnapshots(sessionId: string): Promise<CandidateStateSnapshotRow[]> {
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
    console.warn("[session-snapshots] candidate projection read degraded", failureFor(error));
    return [];
  }
}

export async function readInterviewerDecisionSnapshots(sessionId: string): Promise<InterviewerDecisionSnapshotRow[]> {
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
    console.warn("[session-snapshots] decision projection read degraded", failureFor(error));
    return [];
  }
}

export async function readIntentSnapshots(sessionId: string): Promise<IntentSnapshotRow[]> {
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
    console.warn("[session-snapshots] intent projection read degraded", failureFor(error));
    return [];
  }
}

export async function readTrajectorySnapshots(sessionId: string): Promise<TrajectorySnapshotRow[]> {
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
    console.warn("[session-snapshots] trajectory projection read degraded", failureFor(error));
    return [];
  }
}

export async function readSessionSnapshotBundle(sessionId: string): Promise<SessionSnapshotBundle> {
  const rawClient = prisma as unknown as RawSnapshotClient;
  if (!rawClient.$queryRawUnsafe) {
    return emptyBundle("unknown", "snapshot query capability is unavailable");
  }
  try {
    const [candidateStates, decisions, intents, trajectories] = await Promise.all([
      rawClient.$queryRawUnsafe<CandidateStateSnapshotRow[]>('SELECT id, "sessionId", stage, source, "snapshotJson", "createdAt" FROM "CandidateStateSnapshot" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC', sessionId),
      rawClient.$queryRawUnsafe<InterviewerDecisionSnapshotRow[]>('SELECT id, "sessionId", stage, source, "decisionJson", "createdAt" FROM "InterviewerDecisionSnapshot" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC', sessionId),
      rawClient.$queryRawUnsafe<IntentSnapshotRow[]>('SELECT id, "sessionId", stage, source, "intentJson", "createdAt" FROM "IntentSnapshot" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC', sessionId),
      rawClient.$queryRawUnsafe<TrajectorySnapshotRow[]>('SELECT id, "sessionId", stage, source, "trajectoryJson", "createdAt" FROM "TrajectorySnapshot" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC', sessionId),
    ]);
    return { candidateStates, decisions, intents, trajectories, health: { status: "healthy", diagnostics: [] } };
  } catch (error) {
    const failure = failureFor(error) as NonNullable<SnapshotWriteResult["failure"]>;
    console.warn("[session-snapshots] snapshot bundle read degraded", failure);
    return emptyBundle(failure.kind, failure.message);
  }
}

/** Internal recovery path: only persisted server events may supply projection payloads. */
export async function rebuildSessionSnapshotBundleFromEvents(input: {
  sessionId: string;
  events: Array<{ eventType: string; payloadJson: unknown }>;
}): Promise<SnapshotWriteResult> {
  const latest = (eventType: string, key: string) => {
    for (let index = input.events.length - 1; index >= 0; index -= 1) {
      const event = input.events[index];
      if (event.eventType !== eventType || typeof event.payloadJson !== "object" || event.payloadJson === null) continue;
      const value = (event.payloadJson as Record<string, unknown>)[key];
      if (value !== undefined && value !== null) return { value, payload: event.payloadJson as Record<string, unknown> };
    }
    return null;
  };
  const signals = latest("SIGNAL_SNAPSHOT_RECORDED", "signals");
  const decision = latest("DECISION_RECORDED", "decision");
  const intent = latest("INTENT_SNAPSHOT_RECORDED", "intent");
  const trajectory = latest("TRAJECTORY_SNAPSHOT_RECORDED", "trajectory");
  if (!signals || !decision || !intent || !trajectory) {
    return { status: "skipped", attemptedKinds: [], persistedKinds: [], failure: { kind: "unknown", message: "insufficient authoritative events to rebuild all snapshot projections" } };
  }
  return persistSessionSnapshots({
    sessionId: input.sessionId,
    stage: typeof signals.payload.stage === "string" ? signals.payload.stage : null,
    source: "event-rebuild",
    signals: signals.value,
    decision: decision.value,
    intent: intent.value,
    trajectory: trajectory.value,
  });
}

function emptyBundle(failure: SnapshotFailureKind, diagnostic: string): SessionSnapshotBundle {
  return { candidateStates: [], decisions: [], intents: [], trajectories: [], health: { status: "degraded", failure, diagnostics: [diagnostic] } };
}
