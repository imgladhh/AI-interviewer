import Link from "next/link";
import { InterviewRoomClient } from "@/components/interview/interview-room-client";
import { deriveCurrentCodingStage } from "@/lib/assistant/stages";
import { prisma } from "@/lib/db";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { resolveLowCostMode, summarizeUsageFromSessionEvents } from "@/lib/usage/cost";

type InterviewRoomPageProps = {
  params: Promise<{ id: string }>;
};

export default async function InterviewRoomPage({ params }: InterviewRoomPageProps) {
  const { id } = await params;

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
      question: true,
      interviewerContext: true,
      interviewerProfile: true,
      transcripts: {
        orderBy: { segmentIndex: "asc" },
      },
      events: {
        orderBy: { eventTime: "asc" },
        take: 25,
      },
      executionRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!session) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 32 }}>
        <div style={{ maxWidth: 640, textAlign: "center" }}>
          <h1>Session not found</h1>
          <p>This interview session does not exist yet.</p>
          <Link href="/setup">Back to setup</Link>
        </div>
      </main>
    );
  }

  const hasQuestionShown = session.events.some((event) => event.eventType === SESSION_EVENT_TYPES.QUESTION_SHOWN);
  if (!hasQuestionShown) {
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: SESSION_EVENT_TYPES.QUESTION_SHOWN,
        payloadJson: {
          questionId: session.questionId,
          surfacedInRoom: true,
        },
      },
    });
  }

  const initialStage = deriveCurrentCodingStage({
    events: session.events,
    transcripts: session.transcripts,
    latestExecutionRun: session.executionRuns[0] ?? null,
  });
  const lowCostMode = resolveLowCostMode(session.events);
  const usageSummary = summarizeUsageFromSessionEvents(session.events);

  return (
    <InterviewRoomClient
      sessionId={session.id}
      questionTitle={session.question?.title ?? "Question loading"}
      questionPrompt={session.question?.prompt ?? "No question selected yet."}
      mode={session.mode}
      selectedLanguage={session.selectedLanguage}
      targetLevel={session.targetLevel}
      personaEnabled={session.personaEnabled}
      personaSummary={session.interviewerProfile?.personaSummary ?? null}
      appliedPromptContext={session.interviewerContext?.appliedPromptContext ?? null}
      lowCostMode={lowCostMode}
      initialUsageSummary={usageSummary}
      initialStage={initialStage}
      initialTranscripts={session.transcripts.map((segment) => ({
        id: segment.id,
        speaker: segment.speaker,
        segmentIndex: segment.segmentIndex,
        text: segment.text,
        createdAt: segment.createdAt.toISOString(),
      }))}
      initialEvents={session.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        eventTime: event.eventTime.toISOString(),
        payloadJson: event.payloadJson,
      }))}
    />
  );
}
