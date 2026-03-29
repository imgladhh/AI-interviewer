import {
  deriveCurrentCodingStage,
  describeCodingStage,
  isCodingInterviewStage,
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
  issue?: string;
  score: number;
  maxScore: number;
  evidence: string;
  impact?: string;
  improvement?: string[];
};

type CandidateSignalSummary = {
  understanding?: string;
  progress?: string;
  communication?: string;
  codeQuality?: string;
  algorithmChoice?: string;
  edgeCaseAwareness?: string;
  behavior?: string;
  reasoningDepth?: string;
  testingDiscipline?: string;
  complexityRigor?: string;
  confidence?: number;
  evidence?: string[];
  structuredEvidence?: Array<{
    area?: string;
    issue?: string;
    behavior?: string;
    evidence?: string;
    impact?: string;
    fix?: string;
  }>;
  summary?: string;
};

type CandidateDecisionSummary = {
  action?: string;
  target?: string;
  question?: string;
  reason?: string;
  confidence?: number;
  targetCodeLine?: string;
  specificIssue?: string;
  expectedAnswer?: string;
  suggestedStage?: string;
  hintStyle?: string;
  hintLevel?: string;
  policyAction?: string;
};

type StageReplayGroup = {
  stage: string;
  label: string;
  evidence: string[];
  signalSnapshots: CandidateSignalSummary[];
  decisions: CandidateDecisionSummary[];
  turns: Array<{ speaker: string; text: string }>;
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
  const stageReplay = buildStageReplay(input.events, input.transcripts, stageJourney, currentStage);
  const latestSignal = findLatestSignalSnapshot(input.events);
  const latestDecision = findLatestDecisionSnapshot(input.events);
  const hintRequestedCount = input.events.filter((event) => event.eventType === "HINT_REQUESTED").length;
  const hintServedCount = input.events.filter((event) => event.eventType === "HINT_SERVED").length;
  const userTurns = input.transcripts.filter((segment) => segment.speaker === "USER");
  const aiTurns = input.transcripts.filter((segment) => segment.speaker === "AI");
  const latestUserText = [...userTurns].reverse().map((segment) => segment.text.toLowerCase()).join(" ");
  const codeRunCount = input.executionRuns.length;
  const passedRuns = input.executionRuns.filter((run) => run.status === "PASSED").length;
  const failedRuns = input.executionRuns.filter((run) => run.status !== "PASSED").length;

  const dimensions: DimensionScore[] = [
    scoreProblemUnderstanding(stageJourney, latestUserText, latestSignal),
    scoreCommunication(userTurns, latestSignal),
    scoreImplementation(codeRunCount, passedRuns, failedRuns, latestSignal),
    scoreDebugging(input.executionRuns, latestDecision),
    scoreTestingAndComplexity(stageJourney, latestUserText, latestSignal),
  ];

  const scoreSum = dimensions.reduce((total, dimension) => total + dimension.score, 0);
  const maxSum = dimensions.reduce((total, dimension) => total + dimension.maxScore, 0);
  const overallScore = Math.round((scoreSum / maxSum) * 100);
  const recommendation = toRecommendation(overallScore);
  const strengths = collectStrengths(dimensions, latestSignal, stageReplay, passedRuns, hintRequestedCount);
  const weaknesses = collectWeaknesses(dimensions, currentStage, latestSignal, hintRequestedCount);
  const missedSignals = collectMissedSignals(stageJourney, latestSignal, latestUserText, passedRuns);
  const improvementPlan = collectImprovementPlan(dimensions, latestSignal, hintServedCount);
  const overallSummary = buildOverallSummary({
    recommendation,
    currentStage,
    passedRuns,
    failedRuns,
    hintRequestedCount,
    stageJourney,
    latestSignal,
  });

  return {
    overallScore,
    recommendation,
    overallSummary,
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
      candidateState: latestSignal,
      latestDecision,
      stageReplay,
      dimensions,
      strengths,
      weaknesses,
      missedSignals,
      improvementPlan,
      overallScore,
      recommendation,
      overallSummary,
    },
  };
}

function scoreProblemUnderstanding(
  stageJourney: string[],
  latestUserText: string,
  latestSignal: CandidateSignalSummary | null,
): DimensionScore {
  const clear = latestSignal?.understanding === "clear";
  const partial = latestSignal?.understanding === "partial";
  const score =
    clear || stageJourney.includes("Approach Discussion") || stageJourney.includes("Implementation")
      ? 5
      : partial || /\b(constraint|input|output|clarify|assume)\b/.test(latestUserText)
        ? 3
        : 2;

  return {
    key: "problem_understanding",
    label: "Problem Understanding",
    issue: clear ? "Problem framing was sufficient." : "Problem framing stayed incomplete or only partially explicit.",
    score,
    maxScore: 5,
    evidence:
      clear
        ? "The candidate clarified constraints or grounded the prompt in examples before moving on."
        : "The session showed only partial evidence that the candidate fully framed the problem before advancing.",
    impact:
      score >= 4
        ? "This gave the rest of the interview a stable foundation."
        : "Weak initial framing makes downstream algorithm and implementation decisions less reliable.",
    improvement: [
      "Restate the problem in your own words before choosing an algorithm.",
      "Name assumptions about input shape, constraints, and expected output.",
    ],
  };
}

function scoreCommunication(userTurns: TranscriptLike[], latestSignal: CandidateSignalSummary | null): DimensionScore {
  const averageLength =
    userTurns.length === 0
      ? 0
      : userTurns.reduce((total, turn) => total + turn.text.split(/\s+/).filter(Boolean).length, 0) / userTurns.length;
  const score =
    latestSignal?.communication === "clear" && latestSignal?.reasoningDepth === "deep"
      ? 5
      : latestSignal?.communication === "clear"
        ? 5
        : latestSignal?.communication === "mixed"
        ? 3
        : userTurns.length >= 2 && averageLength >= 8
          ? 4
          : userTurns.length >= 1
            ? 3
            : 1;

  return {
    key: "communication",
    label: "Communication",
    issue:
      score >= 4
        ? "Communication exposed the candidate's thinking clearly."
        : "Communication left parts of the reasoning implicit or compressed.",
    score,
    maxScore: 5,
    evidence:
      score >= 4
        ? "The candidate produced multiple substantive turns and exposed enough reasoning for the interviewer to inspect."
        : "Communication was present, but parts of the reasoning still arrived in compressed or incomplete chunks.",
    impact:
      score >= 4
        ? "Strong communication made follow-up questions more targeted and efficient."
        : "When reasoning stays implicit, the interviewer has to spend turns reconstructing the thought process.",
    improvement: [
      "Use explicit sequencing words like first, then, and finally.",
      "Tie each major step to one concrete example or invariant.",
    ],
  };
}

function scoreImplementation(
  codeRunCount: number,
  passedRuns: number,
  failedRuns: number,
  latestSignal: CandidateSignalSummary | null,
): DimensionScore {
  const score =
    latestSignal?.codeQuality === "correct"
      ? 5
      : latestSignal?.codeQuality === "buggy"
        ? 2
        : passedRuns > 0
          ? 5
          : codeRunCount > 0 && failedRuns > 0
            ? 3
            : 1;

  return {
    key: "implementation",
    label: "Implementation",
    issue:
      passedRuns > 0
        ? "Implementation reached a working state."
        : "Implementation evidence remained incomplete or unstable.",
    score,
    maxScore: 5,
    evidence:
      passedRuns > 0
        ? "At least one passing execution run was recorded, so the implementation reached a working state."
        : codeRunCount > 0
          ? "The candidate attempted implementation, but the current execution evidence still contains failures."
          : "There was little implementation evidence captured through code execution.",
    impact:
      passedRuns > 0
        ? "Working code gave the interviewer room to probe validation and tradeoffs instead of raw syntax."
        : "Without a stable implementation, later signals like complexity and testing remain less trustworthy.",
    improvement: [
      "After coding the main loop, run the simplest happy-path case immediately.",
      "Localize the most failure-prone branch before expanding the full implementation.",
    ],
  };
}

function scoreDebugging(executionRuns: ExecutionRunLike[], latestDecision: CandidateDecisionSummary | null): DimensionScore {
  const passedRuns = executionRuns.filter((run) => run.status === "PASSED").length;
  const failingRuns = executionRuns.filter((run) => run.status !== "PASSED").length;
  const score = failingRuns === 0 ? 3 : passedRuns > 0 ? 5 : latestDecision?.target === "debugging" ? 3 : 2;

  return {
    key: "debugging",
    label: "Debugging",
    issue:
      passedRuns > 0
        ? "The candidate demonstrated at least one successful recovery from failure."
        : failingRuns > 0
          ? "The session surfaced failures without a strong recovery signal."
          : "The session did not produce much explicit debugging evidence.",
    score,
    maxScore: 5,
    evidence:
      failingRuns === 0
        ? "The session did not surface much explicit debugging evidence."
        : passedRuns > 0
          ? "The candidate recovered from at least one failing run, which is a strong debugging signal."
          : "The session showed failing runs without later evidence of a successful recovery.",
    impact:
      passedRuns > 0
        ? "Successful debugging is a positive sign for production-style reasoning under pressure."
        : "Unrecovered execution failures weaken confidence in correctness and momentum.",
    improvement: [
      "When a run fails, identify the first incorrect state transition before rewriting larger blocks.",
      "Use one tiny reproducer input to isolate the failing path.",
    ],
  };
}

function scoreTestingAndComplexity(
  stageJourney: string[],
  latestUserText: string,
  latestSignal: CandidateSignalSummary | null,
): DimensionScore {
  const discussedTesting =
    latestSignal?.testingDiscipline === "strong" ||
    latestSignal?.edgeCaseAwareness === "present" ||
    /\b(edge case|test|empty|duplicate|null)\b/.test(latestUserText);
  const discussedComplexity =
    latestSignal?.complexityRigor === "strong" ||
    /\b(time complexity|space complexity|o\(|linear|quadratic)\b/.test(latestUserText);
  const reachedStage = stageJourney.includes("Testing And Complexity") || stageJourney.includes("Wrap Up");
  const score = reachedStage && discussedTesting && discussedComplexity ? 5 : reachedStage || discussedTesting || discussedComplexity ? 3 : 1;

  return {
    key: "testing_and_complexity",
    label: "Testing and Complexity",
    issue:
      score >= 5
        ? "Validation and complexity coverage were both visible."
        : score >= 3
          ? "Testing or complexity was discussed, but the close-out stayed incomplete."
          : "The session ended without a strong testing and complexity close-out.",
    score,
    maxScore: 5,
    evidence:
      score >= 5
        ? "The candidate covered edge cases and final complexity, which completes the technical story well."
        : score >= 3
          ? "The session touched testing or complexity, but not yet with full coverage."
          : "Testing and complexity discussion stayed limited in the captured session.",
    impact:
      score >= 5
        ? "This gives stronger evidence that the candidate can close out a coding interview cleanly."
        : "Without explicit validation and complexity discussion, the final signal remains incomplete.",
    improvement: [
      "Always end with edge cases plus final time and space complexity.",
      "Name one correctness argument and one tradeoff before wrap-up.",
    ],
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

function buildStageReplay(
  events: SessionEventLike[],
  transcripts: TranscriptLike[],
  stageJourney: string[],
  currentStage: string,
): StageReplayGroup[] {
  const orderedStages = [...stageJourney];
  const currentLabel = describeCodingStageSafe(currentStage);
  if (!orderedStages.includes(currentLabel)) {
    orderedStages.push(currentLabel);
  }

  const groups = new Map<string, StageReplayGroup>();
  for (const stage of orderedStages) {
    groups.set(stage, {
      stage,
      label: stage,
      evidence: [],
      signalSnapshots: [],
      decisions: [],
      turns: [],
    });
  }

  let activeStage = orderedStages[0] ?? currentLabel;
  let turnIndex = 0;

  for (const event of events) {
    if (event.eventType === "STAGE_ADVANCED") {
      const nextStage = describeCodingStageSafe(stringValue(asRecord(event.payloadJson).stage) ?? activeStage);
      if (groups.has(nextStage)) {
        activeStage = nextStage;
      }
      groups.get(activeStage)?.evidence.push(`Stage advanced: ${buildStageAdvanceEvidence(asRecord(event.payloadJson))}`);
      continue;
    }

    if (event.eventType === "SIGNAL_SNAPSHOT_RECORDED") {
      const payload = asRecord(event.payloadJson);
      const stage = describeCodingStageSafe(stringValue(payload.stage) ?? activeStage);
      const target = groups.get(stage) ?? groups.get(activeStage);
      const signals = asRecord(payload.signals) as unknown as CandidateSignalSummary;
      target?.signalSnapshots.push(signals);
      target?.evidence.push(`Signal snapshot: ${signals.summary ?? "candidate state updated"}.`);
      continue;
    }

    if (event.eventType === "DECISION_RECORDED") {
      const payload = asRecord(event.payloadJson);
      const stage = describeCodingStageSafe(stringValue(payload.stage) ?? activeStage);
      const target = groups.get(stage) ?? groups.get(activeStage);
      const decision = asRecord(payload.decision) as unknown as CandidateDecisionSummary;
      target?.decisions.push(decision);
      target?.evidence.push(`Decision: ${decision.action ?? "unknown action"} toward ${decision.target ?? "unknown target"}.`);
      continue;
    }

    if (event.eventType === "HINT_SERVED") {
      groups.get(activeStage)?.evidence.push(`Hint served: ${(stringValue(asRecord(event.payloadJson).hintLevel) ?? "LIGHT").toLowerCase()} ${(stringValue(asRecord(event.payloadJson).hintStyle) ?? "hint").replaceAll("_", " ").toLowerCase()}.`);
      continue;
    }

    if (event.eventType === "CODE_RUN_COMPLETED") {
      const payload = asRecord(event.payloadJson);
      groups.get(activeStage)?.evidence.push(`Code run result: ${stringValue(payload.status) ?? "unknown"}.`);
      continue;
    }
  }

  for (const segment of transcripts.filter((item) => item.speaker !== "SYSTEM")) {
    const stage = orderedStages[Math.min(turnIndex, orderedStages.length - 1)] ?? currentLabel;
    groups.get(stage)?.turns.push({
      speaker: segment.speaker,
      text: truncate(segment.text, 160),
    });
    if (segment.speaker === "USER") {
      turnIndex += 1;
    }
  }

  return [...groups.values()].filter((group) => group.evidence.length > 0 || group.turns.length > 0);
}

function buildOverallSummary(input: {
  recommendation: Recommendation;
  currentStage: string;
  passedRuns: number;
  failedRuns: number;
  hintRequestedCount: number;
  stageJourney: string[];
  latestSignal: CandidateSignalSummary | null;
}) {
  return [
    `Recommendation: ${input.recommendation}.`,
    `The session reached ${describeCodingStageSafe(input.currentStage)} and covered ${input.stageJourney.join(" -> ")}.`,
    input.latestSignal?.summary ? `Latest candidate state: ${input.latestSignal.summary}.` : null,
    `Code execution produced ${input.passedRuns} passing run(s) and ${input.failedRuns} non-passing run(s).`,
    input.hintRequestedCount > 0
      ? `The candidate requested ${input.hintRequestedCount} hint(s), which suggests some reliance on interviewer guidance.`
      : "The candidate completed the session without asking for explicit hints.",
  ]
    .filter(Boolean)
    .join(" ");
}

function collectStrengths(
  dimensions: DimensionScore[],
  latestSignal: CandidateSignalSummary | null,
  stageReplay: StageReplayGroup[],
  passedRuns: number,
  hintRequestedCount: number,
) {
  const strengths = dimensions
    .filter((dimension) => dimension.score >= 4)
    .map((dimension) => `${dimension.label}: ${dimension.evidence}`);

  if (latestSignal?.behavior === "structured") {
    strengths.push("Behavior: the candidate explained the solution in a structured sequence rather than a purely reactive way.");
  }

  if (latestSignal?.reasoningDepth === "deep") {
    strengths.push("Reasoning depth: the candidate explained why the solution works instead of only naming the approach.");
  }

  if (latestSignal?.complexityRigor === "strong") {
    strengths.push("Complexity rigor: the candidate articulated final complexity and tradeoffs clearly.");
  }

  if (passedRuns > 0) {
    strengths.push("Code execution: at least one passing run was achieved.");
  }

  if (stageReplay.some((group) => group.decisions.some((decision) => decision.action === "ask_for_complexity"))) {
    strengths.push("Interview coverage: the session progressed far enough to probe validation and final complexity signals.");
  }

  if (hintRequestedCount === 0) {
    strengths.push("Independence: the candidate did not rely on explicit hint requests.");
  }

  return strengths.slice(0, 4);
}

function collectWeaknesses(
  dimensions: DimensionScore[],
  currentStage: string,
  latestSignal: CandidateSignalSummary | null,
  hintRequestedCount: number,
) {
  const weaknesses = dimensions
    .filter((dimension) => dimension.score <= 3)
    .map((dimension) => `${dimension.label}: ${dimension.evidence}`);

  if (latestSignal?.progress === "stuck") {
    weaknesses.push("Momentum: the latest candidate state still looked stuck, so the interviewer had to constrain the next step heavily.");
  }

  if (latestSignal?.reasoningDepth === "thin") {
    weaknesses.push("Reasoning depth: the candidate often named a direction without fully explaining why it works.");
  }

  if (latestSignal?.testingDiscipline === "missing") {
    weaknesses.push("Testing discipline: the candidate did not present a concrete test plan before closing the loop.");
  }

  for (const item of latestSignal?.structuredEvidence ?? []) {
    weaknesses.push(`${prettifyArea(item.area ?? "issue")}: ${item.issue ?? item.evidence ?? "A concrete issue was observed."}`);
  }

  if (hintRequestedCount >= 2) {
    weaknesses.push("The candidate needed repeated hints, which may indicate difficulty sustaining momentum independently.");
  }

  if (currentStage !== "WRAP_UP") {
    weaknesses.push(`The session ended before fully closing out the interview flow; it currently sits at ${describeCodingStageSafe(currentStage)}.`);
  }

  return weaknesses.slice(0, 4);
}

function collectMissedSignals(
  stageJourney: string[],
  latestSignal: CandidateSignalSummary | null,
  latestUserText: string,
  passedRuns: number,
) {
  const missed: string[] = [];

  if (!stageJourney.includes("Testing And Complexity") && !stageJourney.includes("Wrap Up")) {
    missed.push("The session did not cleanly reach a full testing and complexity discussion.");
  }

  if (!/\b(time complexity|space complexity|o\(|linear|quadratic)\b/.test(latestUserText)) {
    missed.push("The candidate did not clearly articulate final time and space complexity.");
  }

  if (latestSignal?.reasoningDepth === "thin") {
    missed.push("The session never fully surfaced the candidate's reasoning depth behind the chosen approach.");
  }

  if (latestSignal?.edgeCaseAwareness === "missing") {
    missed.push("Edge-case awareness remained weak in the final candidate state snapshot.");
  }

  if (passedRuns === 0) {
    missed.push("The session did not produce a passing execution run.");
  }

  return missed.slice(0, 4);
}

function collectImprovementPlan(
  dimensions: DimensionScore[],
  latestSignal: CandidateSignalSummary | null,
  hintServedCount: number,
) {
  const improvements: string[] = [];

  if (dimensions.find((dimension) => dimension.key === "problem_understanding")?.score ?? 0 < 5) {
    improvements.push("State assumptions and constraints explicitly before locking into an algorithm.");
  }

  if ((dimensions.find((dimension) => dimension.key === "implementation")?.score ?? 0) < 5) {
    improvements.push("Practice translating the chosen approach into code faster, then validate with an immediate run.");
  }

  if ((dimensions.find((dimension) => dimension.key === "testing_and_complexity")?.score ?? 0) < 5) {
    improvements.push("Always finish by naming key edge cases and the final time/space complexity.");
  }

  if (latestSignal?.reasoningDepth === "thin") {
    improvements.push("When you state an approach, immediately explain why it works on one concrete example or invariant.");
  }

  if (latestSignal?.complexityRigor === "missing") {
    improvements.push("Practice ending each solution with explicit time complexity, space complexity, and one tradeoff.");
  }

  if (latestSignal?.behavior === "overthinking") {
    improvements.push("When you stall, choose one concrete next step instead of exploring many branches at once.");
  }

  if (hintServedCount > 0) {
    improvements.push("Try to delay asking for hints until after you have walked through one concrete example yourself.");
  }

  for (const item of latestSignal?.structuredEvidence ?? []) {
    if (item.fix) {
      improvements.push(item.fix);
    }
  }

  return improvements.slice(0, 4);
}

function prettifyArea(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function findLatestSignalSnapshot(events: SessionEventLike[]) {
  const latestSignalEvent = [...events]
    .reverse()
    .find((event) => event.eventType === "SIGNAL_SNAPSHOT_RECORDED");
  if (!latestSignalEvent) {
    return null;
  }

  return asRecord(asRecord(latestSignalEvent.payloadJson).signals) as unknown as CandidateSignalSummary;
}

function findLatestDecisionSnapshot(events: SessionEventLike[]) {
  const latestDecisionEvent = [...events]
    .reverse()
    .find((event) => event.eventType === "DECISION_RECORDED");
  if (!latestDecisionEvent) {
    return null;
  }

  return asRecord(asRecord(latestDecisionEvent.payloadJson).decision) as unknown as CandidateDecisionSummary;
}

function buildStageAdvanceEvidence(payload: Record<string, unknown>) {
  const previousStage = describeCodingStageSafe(stringValue(payload.previousStage) ?? "unknown");
  const nextStage = describeCodingStageSafe(stringValue(payload.stage) ?? "unknown");
  const reason = stringValue(payload.reason);
  return reason ? `${previousStage} -> ${nextStage}: ${reason}` : `${previousStage} -> ${nextStage}`;
}

function toRecommendation(score: number): Recommendation {
  if (score >= 85) return "STRONG_HIRE";
  if (score >= 70) return "HIRE";
  if (score >= 55) return "BORDERLINE";
  return "NO_HIRE";
}

function describeCodingStageSafe(stage: string) {
  try {
    return isCodingInterviewStage(stage) ? describeCodingStage(stage) : stage;
  } catch {
    return stage;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}








