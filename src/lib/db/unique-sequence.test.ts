import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { withUniqueSequenceRetry } from "@/lib/db/unique-sequence";

describe("withUniqueSequenceRetry", () => {
  it("retries a unique-index race without repeating work before the operation", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("race", { code: "P2002", clientVersion: "test" });
    const operation = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(7);
    await expect(withUniqueSequenceRetry(operation)).resolves.toBe(7);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated failures", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("write failed"));
    await expect(withUniqueSequenceRetry(operation)).rejects.toThrow("write failed");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
