import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({ data: { email: `p3-assessment-${suffix}@example.invalid` } });
  try {
    const session = await prisma.interviewSession.create({ data: { userId: user.id, mode: "CODING", status: "CREATED" } });
    const candidate = await prisma.transcriptSegment.create({ data: { sessionId: session.id, speaker: "USER", segmentIndex: 0, text: "Use a hash map.", isFinal: true } });
    const common = { sessionId: session.id, candidateTurnId: candidate.id, status: "ADJUDICATED",
      heuristicJson: { progress: "progressing" }, providerJson: { progress: "progressing" },
      evidenceJson: { transcriptId: candidate.id, start: 0, length: 15, excerptHash: "verification" } };
    const v1 = await prisma.turnAssessment.create({ data: { ...common, assessmentVersion: 1, adjudicatedJson: { progress: "progressing" } } });
    const v2 = await prisma.turnAssessment.create({ data: { ...common, assessmentVersion: 2, adjudicatedJson: { progress: "done" } } });
    let duplicateRejected = false;
    try { await prisma.turnAssessment.create({ data: { ...common, assessmentVersion: 2, adjudicatedJson: { progress: "stuck" } } }); }
    catch (error) { duplicateRejected = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
    const latest = await prisma.turnAssessment.findFirst({ where: { sessionId: session.id, candidateTurnId: candidate.id }, orderBy: { assessmentVersion: "desc" } });
    const original = await prisma.turnAssessment.findUnique({ where: { id: v1.id } });
    if (!duplicateRejected || latest?.id !== v2.id || original?.assessmentVersion !== 1) throw new Error("Assessment append-only/version contract failed.");
    console.log(JSON.stringify({ duplicateVersionRejected: true, originalVersionPreserved: true, latestVersion: 2 }));
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exitCode = 1; });
