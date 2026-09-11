import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const prisma = vi.hoisted(() => ({
  sessionTurnCommit: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));
import { claimAssistantTurn, completeAssistantTurn, failAssistantTurn } from "@/lib/session/turn-commit";

describe("assistant turn commit protocol", () => {
  beforeEach(() => Object.values(prisma.sessionTurnCommit).forEach((mock) => mock.mockReset()));
  it("claims a new turn exactly once", async () => {
    prisma.sessionTurnCommit.findUnique.mockResolvedValue(null);
    prisma.sessionTurnCommit.create.mockResolvedValue({});
    await expect(claimAssistantTurn("s1", "t1")).resolves.toEqual({ status: "claimed" });
    expect(prisma.sessionTurnCommit.create).toHaveBeenCalledOnce();
  });
  it("returns stable in-progress and completed results without a new claim", async () => {
    prisma.sessionTurnCommit.findUnique.mockResolvedValueOnce({ status: "IN_PROGRESS" });
    await expect(claimAssistantTurn("s1", "t1")).resolves.toMatchObject({ status: "in_progress", retryAfterMs: 750 });
    prisma.sessionTurnCommit.findUnique.mockResolvedValueOnce({ status: "COMPLETED", resultJson: { transcript: { id: "a1" } } });
    await expect(claimAssistantTurn("s1", "t1")).resolves.toEqual({ status: "completed", result: { transcript: { id: "a1" } } });
    expect(prisma.sessionTurnCommit.create).not.toHaveBeenCalled();
  });
  it("records completion and failure states", async () => {
    prisma.sessionTurnCommit.update.mockResolvedValue({});
    prisma.sessionTurnCommit.updateMany.mockResolvedValue({ count: 1 });
    await completeAssistantTurn(prisma as never, { sessionId: "s1", turnId: "t1", responseTranscriptId: "a1", result: {} });
    await failAssistantTurn("s1", "t2");
    expect(prisma.sessionTurnCommit.update).toHaveBeenCalledOnce();
    expect(prisma.sessionTurnCommit.updateMany).toHaveBeenCalledOnce();
  });
  it("reclaims a failed stream with the same turn id", async () => {
    prisma.sessionTurnCommit.findUnique.mockResolvedValue({ status: "FAILED" });
    prisma.sessionTurnCommit.updateMany.mockResolvedValue({ count: 1 });
    await expect(claimAssistantTurn("s1", "t1")).resolves.toEqual({ status: "claimed" });
    expect(prisma.sessionTurnCommit.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "FAILED" }), data: expect.objectContaining({ status: "IN_PROGRESS" }) }));
    expect(prisma.sessionTurnCommit.create).not.toHaveBeenCalled();
  });
  it("lets only one concurrent retry reclaim a failed turn", async () => {
    prisma.sessionTurnCommit.findUnique.mockResolvedValue({ status: "FAILED" });
    prisma.sessionTurnCommit.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(Promise.all([claimAssistantTurn("s1", "t1"), claimAssistantTurn("s1", "t1")])).resolves.toEqual([
      { status: "claimed" }, { status: "in_progress", retryAfterMs: 750 },
    ]);
  });
  it("turns a concurrent unique-claim race into in-progress", async () => {
    prisma.sessionTurnCommit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "IN_PROGRESS" });
    prisma.sessionTurnCommit.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("race", { code: "P2002", clientVersion: "test" }));
    await expect(claimAssistantTurn("s1", "t1")).resolves.toEqual({ status: "in_progress", retryAfterMs: 750 });
    expect(prisma.sessionTurnCommit.create).toHaveBeenCalledOnce();
  });
});
