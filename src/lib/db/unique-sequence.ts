import { Prisma } from "@prisma/client";

const DEFAULT_ATTEMPTS = 8;

export function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Retry a short transaction when two writers race for the same per-session index. */
export async function withUniqueSequenceRetry<T>(
  operation: () => Promise<T>,
  attempts = DEFAULT_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt >= attempts) throw error;
    }
  }
}
