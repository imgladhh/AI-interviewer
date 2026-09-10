import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { RedisMock } = vi.hoisted(() => ({
  RedisMock: vi.fn(),
}));

vi.mock("ioredis", () => ({
  default: RedisMock,
}));

describe("Redis initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    RedisMock.mockReset();
    delete (globalThis as { redis?: unknown }).redis;
  });

  afterEach(() => {
    delete (globalThis as { redis?: unknown }).redis;
  });

  it("does not create a Redis client while Redis and queue modules are imported", async () => {
    await import("@/lib/redis");
    await import("@/lib/persona/queue");

    expect(RedisMock).not.toHaveBeenCalled();
  });

  it("creates and memoizes the Redis client only when requested", async () => {
    RedisMock.mockImplementation(() => ({ ping: vi.fn() }));
    const { getRedis } = await import("@/lib/redis");

    const first = getRedis();
    const second = getRedis();

    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });
});
