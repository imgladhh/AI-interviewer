import { Prisma } from "@prisma/client";
import { generateSessionReport } from "@/lib/evaluation/report";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { readCandidateStateSnapshots, readInterviewerDecisionSnapshots } from "@/lib/session/snapshots";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, { params }: RouteContext) {
  const { id } = await params;

  const report = await prisma.feedbackReport.findUnique({
    where: { sessionId: id },
  });

  if (!report) {
    return fail("Feedback report not found", 404);
  }

  return ok({
    reportVersion: report.reportVersion,
    reportJson: report.reportJson,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  });
}

export async function POST(_: Request, { params }: RouteContext) {
  const { id } = await params;

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
      question: true,
      transcripts: {
        orderBy: { segmentIndex: "asc" },
      },
      events: {
        orderBy: { eventTime: "asc" },
      },
      executionRuns: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      evaluation: {
        include: {
          dimensionScores: true,
        },
      },
      feedbackReport: true,
    },
  });

  if (!session) {
    return fail("Interview session not found", 404);
  }

  const [candidateStateSnapshots, interviewerDecisionSnapshots] = await Promise.all([
    readCandidateStateSnapshots(id),
    readInterviewerDecisionSnapshots(id),
  ]);

  await prisma.sessionEvent.create({
    data: {
      sessionId: id,
      eventType: SESSION_EVENT_TYPES.EVALUATION_STARTED,
      payloadJson: {
        source: "report-route",
      },
    },
  });

  const generated = generateSessionReport({
    sessionId: session.id,
    questionTitle: session.question?.title ?? "Coding interview",
    questionPrompt: session.question?.prompt ?? "",
    targetLevel: session.targetLevel,
    selectedLanguage: session.selectedLanguage,
    transcripts: session.transcripts.map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
    })),
    events: session.events,
    executionRuns: session.executionRuns.map((run) => ({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      runtimeMs: run.runtimeMs,
      createdAt: run.createdAt,
    })),
    candidateStateSnapshots: candidateStateSnapshots.map((row) => ({
      id: row.id,
      stage: row.stage,
      source: row.source,
      snapshotJson: row.snapshotJson,
      createdAt: row.createdAt,
    })),
    interviewerDecisionSnapshots: interviewerDecisionSnapshots.map((row) => ({
      id: row.id,
      stage: row.stage,
      source: row.source,
      decisionJson: row.decisionJson,
      createdAt: row.createdAt,
    })),
  });

  const evaluation = await prisma.evaluation.upsert({
    where: { sessionId: id },
    update: {
      overallScore: generated.overallScore,
      overallSummary: generated.overallSummary,
      strengths: generated.strengths,
      weaknesses: generated.weaknesses,
      missedSignals: generated.missedSignals,
      improvementPlan: generated.improvementPlan,
      recommendation: generated.recommendation,
    },
    create: {
      sessionId: id,
      overallScore: generated.overallScore,
      overallSummary: generated.overallSummary,
      strengths: generated.strengths,
      weaknesses: generated.weaknesses,
      missedSignals: generated.missedSignals,
      improvementPlan: generated.improvementPlan,
      recommendation: generated.recommendation,
    },
  });

  await prisma.evaluationDimensionScore.deleteMany({
    where: { evaluationId: evaluation.id },
  });

  await prisma.evaluationDimensionScore.createMany({
    data: generated.dimensions.map((dimension) => ({
      evaluationId: evaluation.id,
      dimensionKey: dimension.key,
      score: dimension.score,
      maxScore: dimension.maxScore,
      evidence: dimension.evidence,
    })),
  });

  const feedbackReport = await prisma.feedbackReport.upsert({
    where: { sessionId: id },
    update: {
      reportVersion: "v0",
      reportJson: generated.reportJson as Prisma.InputJsonObject,
    },
    create: {
      sessionId: id,
      reportVersion: "v0",
      reportJson: generated.reportJson as Prisma.InputJsonObject,
    },
  });

  await prisma.interviewSession.update({
    where: { id },
    data: {
      finalRecommendation: generated.recommendation,
      status: "COMPLETED",
      endedAt: session.endedAt ?? new Date(),
    },
  });

  const reportGeneratedEvent = await prisma.sessionEvent.create({
    data: {
      sessionId: id,
      eventType: SESSION_EVENT_TYPES.REPORT_GENERATED,
      payloadJson: {
        source: "report-route",
        reportVersion: "v0",
        recommendation: generated.recommendation,
        overallScore: generated.overallScore,
      },
    },
  });

  return ok(
    {
      evaluation: {
        id: evaluation.id,
        overallScore: generated.overallScore,
        overallSummary: generated.overallSummary,
        strengths: generated.strengths,
        weaknesses: generated.weaknesses,
        missedSignals: generated.missedSignals,
        improvementPlan: generated.improvementPlan,
        recommendation: generated.recommendation,
        dimensions: generated.dimensions,
      },
      feedbackReport: {
        id: feedbackReport.id,
        reportVersion: feedbackReport.reportVersion,
        reportJson: feedbackReport.reportJson,
      },
      event: reportGeneratedEvent,
    },
    { status: 201 },
  );
}




