import { PrismaClient } from "@prisma/client";
import { withUniqueSequenceRetry } from "../lib/db/unique-sequence";

const prisma = new PrismaClient();

async function rejectsDuplicate(operation: () => Promise<unknown>) {
  try {
    await operation();
    return false;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({ data: { email: `p3-constraint-${suffix}@example.invalid` } });
  try {
    const session = await prisma.interviewSession.create({ data: { userId: user.id, mode: "CODING", status: "CREATED" } });
    await Promise.all(Array.from({ length: 4 }, (_, ordinal) => withUniqueSequenceRetry(() => prisma.$transaction(async (tx) => {
      const latest = await tx.transcriptSegment.findFirst({ where: { sessionId: session.id }, orderBy: { segmentIndex: "desc" }, select: { segmentIndex: true } });
      return tx.transcriptSegment.create({ data: { sessionId: session.id, speaker: "USER", segmentIndex: (latest?.segmentIndex ?? -1) + 1, text: `concurrent-${ordinal}`, isFinal: true } });
    }))));
    await Promise.all(Array.from({ length: 4 }, (_, ordinal) => withUniqueSequenceRetry(() => prisma.$transaction(async (tx) => {
      const latest = await tx.codeSnapshot.findFirst({ where: { sessionId: session.id }, orderBy: { snapshotIndex: "desc" }, select: { snapshotIndex: true } });
      return tx.codeSnapshot.create({ data: { sessionId: session.id, language: "PYTHON", content: `# ${ordinal}`, snapshotIndex: (latest?.snapshotIndex ?? -1) + 1, source: "concurrency-test" } });
    }))));
    const transcriptIndexes = (await prisma.transcriptSegment.findMany({ where: { sessionId: session.id }, orderBy: { segmentIndex: "asc" }, select: { segmentIndex: true } })).map((row) => row.segmentIndex);
    const snapshotIndexes = (await prisma.codeSnapshot.findMany({ where: { sessionId: session.id }, orderBy: { snapshotIndex: "asc" }, select: { snapshotIndex: true } })).map((row) => row.snapshotIndex);
    if (new Set(transcriptIndexes).size !== 4 || new Set(snapshotIndexes).size !== 4) throw new Error("Concurrent allocation produced duplicate indexes.");
    const transcriptRejected = await rejectsDuplicate(() => prisma.transcriptSegment.create({ data: { sessionId: session.id, speaker: "AI", segmentIndex: 0, text: "duplicate", isFinal: true } }));
    const snapshotRejected = await rejectsDuplicate(() => prisma.codeSnapshot.create({ data: { sessionId: session.id, language: "PYTHON", content: "pass", snapshotIndex: 0, source: "test" } }));
    if (!transcriptRejected || !snapshotRejected) throw new Error("Database did not reject duplicate per-session indexes.");
    console.log(JSON.stringify({ concurrentTranscriptIndexes: transcriptIndexes, concurrentSnapshotIndexes: snapshotIndexes,
      transcriptDuplicateRejected: true, snapshotDuplicateRejected: true }));
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
