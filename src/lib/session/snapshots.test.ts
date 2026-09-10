import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ $transaction: vi.fn(), $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma }));
import { persistSessionSnapshots, readSessionSnapshotBundle, rebuildSessionSnapshotBundleFromEvents } from "@/lib/session/snapshots";

const full = { sessionId: "s1", signals: { a: 1 }, decision: { b: 1 }, intent: { c: 1 }, trajectory: { d: 1 } };
describe("session snapshot projections", () => {
  beforeEach(() => {
    prisma.$executeRawUnsafe.mockReset().mockResolvedValue({});
    prisma.$queryRawUnsafe.mockReset().mockResolvedValue([]);
    prisma.$transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ $executeRawUnsafe: prisma.$executeRawUnsafe }));
  });
  it("persists all kinds atomically", async () => {
    await expect(persistSessionSnapshots(full)).resolves.toMatchObject({ status: "persisted", attemptedKinds: ["candidate_state", "interviewer_decision", "intent", "trajectory"], persistedKinds: ["candidate_state", "interviewer_decision", "intent", "trajectory"] });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
  it("returns degraded and retries after schema or transient errors", async () => {
    prisma.$executeRawUnsafe.mockRejectedValueOnce({ code: "P2021" });
    await expect(persistSessionSnapshots(full)).resolves.toMatchObject({ status: "degraded", persistedKinds: [], failure: { kind: "schema_missing" } });
    await expect(persistSessionSnapshots(full)).resolves.toMatchObject({ status: "persisted" });
    prisma.$executeRawUnsafe.mockRejectedValueOnce(new Error("db down"));
    await expect(persistSessionSnapshots(full)).resolves.toMatchObject({ status: "degraded", failure: { kind: "transient_database" } });
  });
  it("marks bundle reads degraded rather than returning a healthy empty bundle", async () => {
    prisma.$queryRawUnsafe.mockRejectedValueOnce(new Error("db down"));
    await expect(readSessionSnapshotBundle("s1")).resolves.toMatchObject({ health: { status: "degraded", failure: "transient_database" } });
  });
  it("rebuilds complete event projections and rejects incomplete evidence", async () => {
    const events = [
      { eventType: "SIGNAL_SNAPSHOT_RECORDED", payloadJson: { signals: {} } }, { eventType: "DECISION_RECORDED", payloadJson: { decision: {} } },
      { eventType: "INTENT_SNAPSHOT_RECORDED", payloadJson: { intent: {} } }, { eventType: "TRAJECTORY_SNAPSHOT_RECORDED", payloadJson: { trajectory: {} } },
    ];
    await expect(rebuildSessionSnapshotBundleFromEvents({ sessionId: "s1", events })).resolves.toMatchObject({ status: "persisted" });
    await expect(rebuildSessionSnapshotBundleFromEvents({ sessionId: "s1", events: events.slice(0, 2) })).resolves.toMatchObject({ status: "skipped" });
  });
});
