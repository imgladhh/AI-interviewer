import {
  deriveCurrentCodingStage,
  describeCodingStage,
  type CodingInterviewStage,
} from "@/lib/assistant/stages";
import type { Recommendation } from "@prisma/client";

type TranscriptLike = {
  speaker: "USER" | "AI" | "SYSTEM";
  text: string;
};

type SessionEventLike = {
  eventType: string;
  eventTime?: Date | string;
  payloadJson?: unknown;
};

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
  runtimeMs?: number | null;
  createdAt?: Date | string;
};

type SessionReportInput = {
  sessionId: string;
  questionTitle: string;
  questionPrompt?: string | null;
  targetLevel?: string | null;
  selectedLanguage?: string | null;
  transcripts: TranscriptLike[];
  events: SessionEventLike[];
  executionRuns: ExecutionRunLike[];
};

type DimensionScore = {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  evidence: string;
};

export type GeneratedSessionReport = {
  overallScore: number;
  recommendation: Recommendation;
  overallSummary: string;
  strengths: string[];
  weaknesses: string[];
  missedSignals: string[];
  improvementPlan: string[];
  dimensions: DimensionScore[];
  reportJson: Record<string, unknown>;
};

export function generateSessionReport(input: SessionReportInput): GeneratedSessionReport {
  const currentStage = deriveCurrentCodingStage({
    events: input.events,
    transcripts: input.transcripts,
    latestExecutionRun: input.executionRuns[0] ?? null,
  });
  const stageJourney = buildStageJourney(input.events, currentStage);
  const hintRequestedCount = input.events.filter((event) => event.eventType === "HINT_REQUESTED").length;
  const hintServedCount = input.events.filter((event) => event.eventType === "HINT_SERVED").length;
  const userTurns = input.transcripts.filter((segment) => segment.speaker === "USER");
  const aiTurns = input.transcripts.filter((segment) => segment.speaker === "AI");
  const latestUserText = [...userTurns].reverse().map((segment) => segment.text.toLowerCase()).join(" ");
  const codeRunCount = input.executionRuns.length;
  const passedRuns = input.executionRuns.filter((run) => run.status === "PASSED").length;
  const failedRuns = input.executionRuns.filter((run) => run.status !== "PASSED").length;

  const dimensions: DimensionScore[] = [
    scoreProblemUnderstanding(stageJourney, latestUserText),
    scoreCommunication(userTurns),
    scoreImplementation(codeRunCount, passedRuns, failedRuns),
    scoreDebugging(input.executionRuns),
    scoreTestingAndComplexity(stageJourney, latestUserText),
  ];

  const scoreSum = dimensions.reduce((total, dimension) => total + dimension.score, 0);
  const maxSum = dimensions.reduce((total, dimension) => total + dimension.maxScore, 0);
  const overallScore = Math.round((scoreSum / maxSum) * 100);
  const recommendation = toRecommendation(overallScore);
  const strengths = collectStrengths(dimensions, passedRuns, hintRequestedCount);
  const weaknesses = collectWeaknesses(dimensions, currentStage, hintRequestedCount);
  const missedSignals = collectMissedSignals(stageJourney, latestUserText, passedRuns);
  const improvementPlan = collectImprovementPlan(dimensions, hintServedCount);

  return {
    overallScore,
    recommendation,
    overallSummary: buildOverallSummary({
      recommendation,
      currentStage,
      passedRuns,
      failedRuns,
      hintRequestedCount,
      stageJourney,
    }),
    strengths,
    weaknesses,
    missedSignals,
    improvementPlan,
    dimensions,
    reportJson: {
      generatedAt: new Date().toISOString(),
      sessionId: input.sessionId,
      questionTitle: input.questionTitle,
      targetLevel: input.targetLevel,
      selectedLanguage: input.selectedLanguage,
      currentStage,
      stageJourney,
      codeRunSummary: {
        totalRuns: codeRunCount,
        passedRuns,
        failedRuns,
      },
      hintSummary: {
        requested: hintRequestedCount,
        served: hintServedCount,
      },
      transcriptSummary: {
        userTurns: userTurns.length,
        aiTurns: aiTurns.length,
      },
      dimensions,
      strengths,
      weaknesses,
      missedSignals,
      improvementPlan,
      overallScore,
      recommendation,
      overallSummary: buildOverallSummary({
        recommendation,
        currentStage,
        passedRuns,
        failedRuns,
        hintRequestedCount,
        stageJourney,
      }),
    },
  };
}

function scoreProblemUnderstanding(stageJourney: string[], latestUserText: string): DimensionScore {
  const score =
    stageJourney.includes("APPROACH_DISCUSSION") || stageJourney.includes("IMPLEMENTATION")
      ? 5
      : /\b(constraint|input|output|clarify|assume)\b/.test(latestUserText)
        ? 4
        : 2;

  return {
    key: "problem_understanding",
    label: "Problem Understanding",
    score,
    maxScore: 5,
    evidence:
      score >= 4
        ? "Candidate progressed beyond problem framing and surfaced constraints or assumptions."
        : "Candidate showed limited evidence of clarifying constraints before moving on.",
  };
}

function scoreCommunication(userTurns: TranscriptLike[]): DimensionScore {
  const averageLength =
    userTurns.length === 0
      ? 0
      : userTurns.reduce((total, turn) => total + turn.text.split(/\s+/).filter(Boolean).length, 0) / userTurns.length;
  const score = userTurns.length >= 3 && averageLength >= 8 ? 5 : userTurns.length >= 2 ? 4 : userTurns.length >= 1 ? 3 : 1;

  return {
    key: "communication",
    label: "Communication",
    score,
    maxScore: 5,
    evidence:
      score >= 4
        ? "Candidate maintained multiple substantive turns and explained reasoning in a reasonably complete way."
        : "Communication was present, but the session did not yet show many fully developed candidate turns.",
  };
}

function scoreImplementation(codeRunCount: number, passedRuns: number, failedRuns: number): DimensionScore {
  const score = passedRuns > 0 ? 5 : codeRunCount > 0 && failedRuns > 0 ? 3 : 1;

  return {
    key: "implementation",
    label: "Implementation",
    score,
    maxScore: 5,
    evidence:
      passedRuns > 0
        ? "Candidate reached at least one passing execution run."
        : codeRunCount > 0
          ? "Candidate attempted implementation, but the current runs did not pass."
          : "No implementation evidence was captured through code execution.",
  };
}

function scoreDebugging(executionRuns: ExecutionRunLike[]): DimensionScore {
  const passedRuns = executionRuns.filter((run) => run.status === "PASSED").length;
  const failingRuns = executionRuns.filter((run) => run.status !== "PASSED").length;
  const score = failingRuns === 0 ? 3 : passedRuns > 0 ? 5 : 2;

  return {
    key: "debugging",
    label: "Debugging",
    score,
    maxScore: 5,
    evidence:
      failingRuns === 0
        ? "The session did not surface much explicit debugging evidence."
        : passedRuns > 0
          ? "Candidate recovered from at least one failing run."
          : "The session showed failing runs without a subsequent passing recovery.",
  };
}

function scoreTestingAndComplexity(stageJourney: string[], latestUserText: string): DimensionScore {
  const discussedTesting = /\b(edge case|test|empty|duplicate|null)\b/.test(latestUserText);
  const discussedComplexity = /\b(time complexity|space complexity|o\(|linear|quadratic)\b/.test(latestUserText);
  const reachedStage = stageJourney.includes("TESTING_AND_COMPLEXITY") || stageJourney.includes("WRAP_UP");
  const score = reachedStage && discussedTesting && discussedComplexity ? 5 : reachedStage || discussedTesting || discussedComplexity ? 3 : 1;

  return {
    key: "testing_and_complexity",
    label: "Testing and Complexity",
    score,
    maxScore: 5,
    evidence:
      score >= 5
        ? "Candidate covered both validation signals and complexity discussion."
        : score >= 3
          ? "The session touched testing or complexity, but not both in a fully convincing way."
          : "Testing and complexity discussion was limited in the captured session.",
  };
}

function buildStageJourney(events: SessionEventLike[], currentStage: string) {
  const stages = events
    .filter((event) => event.eventType === "STAGE_ADVANCED")
    .map((event) => asRecord(event.payloadJson).stage)
    .filter((value): value is string => typeof value === "string");

  const ordered = [...stages, currentStage];
  return ordered.filter((stage, index) => ordered.indexOf(stage) === index).map((stage) => describeCodingStageSafe(stage));
}

function buildOverallSummary(input: {
  recommendation: Recommendation;
  currentStage: string;
  passedRuns: number;
  failedRuns: number;
  hintRequestedCount: number;
  stageJourney: string[];
}) {
  return [
    `Recommendation: ${input.recommendation}.`,
    `The session reached ${describeCodingStageSafe(input.currentStage)} and covered ${input.stageJourney.join(" -> ")}.`,
    `Code execution produced ${input.passedRuns} passing run(s) and ${input.failedRuns} non-passing run(s).`,
    input.hintRequestedCount > 0
      ? `The candidate requested ${input.hintRequestedCount} hint(s), which suggests some reliance on interviewer guidance.`
      : "The candidate completed the session without asking for explicit hints.",
  ].join(" ");
}

function collectStrengths(dimensions: DimensionScore[], passedRuns: number, hintRequestedCount: number) {
  const strengths = dimensions
    .filter((dimension) => dimension.score >= 4)
    .map((dimension) => `${dimension.label}: ${dimension.evidence}`);

  if (passedRuns > 0) {
    strengths.push("Code execution: at least one passing run was achieved.");
  }

  if (hintRequestedCount === 0) {
    strengths.push("Independence: the candidate did not rely on explicit hint requests.");
  }

  return strengths.slice(0, 3);
}

function collectWeaknesses(dimensions: DimensionScore[], currentStage: string, hintRequestedCount: number) {
  const weaknesses = dimensions
    .filter((dimension) => dimension.score <= 3)
    .map((dimension) => `${dimension.label}: ${dimension.evidence}`);

  if (hintRequestedCount >= 2) {
    weaknesses.push("The candidate needed repeated hints, which may indicate difficulty sustaining momentum independently.");
  }

  if (currentStage !== "WRAP_UP") {
    weaknesses.push(`The session ended before fully closing out the interview flow; it currently sits at ${describeCodingStageSafe(currentStage)}.`);
  }

  return weaknesses.slice(0, 3);
}

function collectMissedSignals(stageJourney: string[], latestUserText: string, passedRuns: number) {
  const missed: string[] = [];

  if (!stageJourney.includes("TESTING_AND_COMPLEXITY") && !stageJourney.includes("Wrap Up")) {
    missed.push("The session did not cleanly reach a full testing and complexity discussion.");
  }

  if (!/\b(time complexity|space complexity|o\(|linear|quadratic)\b/.test(latestUserText)) {
    missed.push("The candidate did not clearly articulate final time and space complexity.");
  }

  if (passedRuns === 0) {
    missed.push("The session did not produce a passing execution run.");
  }

  return missed.slice(0, 3);
}

function collectImprovementPlan(dimensions: DimensionScore[], hintServedCount: number) {
  const improvements: string[] = [];

  if (dimensions.find((dimension) => dimension.key === "problem_understanding")?.score ?? 0 < 5) {
    improvements.push("State assumptions and constraints explicitly before locking into an algorithm.");
  }

  if (dimensions.find((dimension) => dimension.key === "implementation")?.score ?? 0 < 5) {
    improvements.push("Practice translating the chosen approach into code faster, then validate with an immediate run.");
  }

  if (dimensions.find((dimension) => dimension.key === "testing_and_complexity")?.score ?? 0 < 5) {
    improvements.push("Always finish by naming key edge cases and the final time/space complexity.");
  }

  if (hintServedCount > 0) {
    improvements.push("Try to delay asking for hints until after you have walked through one concrete example yourself.");
  }

  return improvements.slice(0, 3);
}

function toRecommendation(score: number): Recommendation {
  if (score >= 85) return "STRONG_HIRE";
  if (score >= 70) return "HIRE";
  if (score >= 55) return "BORDERLINE";
  return "NO_HIRE";
}

function describeCodingStageSafe(stage: string) {
  try {
    return describeCodingStage(stage as CodingInterviewStage);
  } catch {
    return stage;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}


