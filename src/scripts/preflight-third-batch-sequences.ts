import { prisma } from "@/lib/db";

async function main() {
  const transcripts = await prisma.$queryRaw<Array<{ sessionId: string; segmentIndex: number; duplicateCount: number }>>`
    SELECT "sessionId", "segmentIndex", COUNT(*)::int AS "duplicateCount"
    FROM "TranscriptSegment"
    GROUP BY "sessionId", "segmentIndex"
    HAVING COUNT(*) > 1
  `;
  const snapshots = await prisma.$queryRaw<Array<{ sessionId: string; snapshotIndex: number; duplicateCount: number }>>`
    SELECT "sessionId", "snapshotIndex", COUNT(*)::int AS "duplicateCount"
    FROM "CodeSnapshot"
    GROUP BY "sessionId", "snapshotIndex"
    HAVING COUNT(*) > 1
  `;
  console.log(JSON.stringify({ transcripts, snapshots }, null, 2));
  if (transcripts.length || snapshots.length) process.exitCode = 2;
}

main().finally(() => prisma.$disconnect());
