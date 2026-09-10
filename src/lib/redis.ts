import IORedis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis?: IORedis;
};

export function getRedis() {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  return globalForRedis.redis;
}
