import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";

type HealthDependency = {
  status: "ok" | "error";
  latencyMs: number;
  details?: string;
};

export type HealthSnapshot = {
  status: "ok" | "degraded";
  timestamp: string;
  dependencies: {
    db: HealthDependency;
    redis: HealthDependency;
  };
};

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  const dbStartedAt = Date.now();
  let db: HealthDependency;

  try {
    const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    db = {
      status: result[0]?.ok === 1 ? "ok" : "error",
      latencyMs: Date.now() - dbStartedAt,
      details: result[0]?.ok === 1 ? undefined : "Unexpected query result",
    };
  } catch (error) {
    db = {
      status: "error",
      latencyMs: Date.now() - dbStartedAt,
      details: error instanceof Error ? error.message : "Unknown database error",
    };
  }

  const redisStartedAt = Date.now();
  let cache: HealthDependency;

  try {
    const pong = await getRedis().ping();
    cache = {
      status: pong === "PONG" ? "ok" : "error",
      latencyMs: Date.now() - redisStartedAt,
      details: pong === "PONG" ? undefined : `Unexpected Redis response: ${pong}`,
    };
  } catch (error) {
    cache = {
      status: "error",
      latencyMs: Date.now() - redisStartedAt,
      details: error instanceof Error ? error.message : "Unknown Redis error",
    };
  }

  const overallStatus = db.status === "ok" && cache.status === "ok" ? "ok" : "degraded";

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    dependencies: {
      db,
      redis: cache,
    },
  };
}
