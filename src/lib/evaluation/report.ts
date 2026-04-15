import {
  deriveCurrentCodingStage,
  deriveCurrentSystemDesignStage,
  describeInterviewStage,
  describeCodingStage,
  isCodingInterviewStage,
  type CodingInterviewStage,
} from "@/lib/assistant/stages";
import { buildHintingLedger, type HintLedger } from "@/lib/assistant/hinting_ledger";
import { summarizeSessionCritic, type SessionCriticSummary } from "@/lib/assistant/session_critic";
import type { Recommendation } from "@prisma/client";

type TranscriptLike = {
  speaker: "USER" | "AI" | "SYSTEM";
  text: string;
};

type SessionEventLike = {
  id?: string;
  eventType: string;
  eventTime?: Date | string;
  payloadJson?: unknown;
};

type ExecutionRunLike = {
  id?: string;
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
  runtimeMs?: number | null;
  createdAt?: Date | string;
};

type CandidateStateSnapshotLike = {
  id?: string;
  stage?: string | null;
  source?: string | null;
  snapshotJson: unknown;
  createdAt?: Date | string;
};

type InterviewerDecisionSnapshotLike = {
  id?: string;
  stage?: string | null;
  source?: string | null;
  decisionJson: unknown;
  createdAt?: Date | string;
};

type IntentSnapshotLike = {
  id?: string;
  stage?: string | null;
  source?: string | null;
  intentJson: unknown;
  createdAt?: Date | string;
};

type TrajectorySnapshotLike = {
  id?: string;
  stage?: string | null;
  source?: string | null;
  trajectoryJson: unknown;
  createdAt?: Date | string;
};

type SessionReportInput = {
  sessionId: string;
  mode?: "CODING" | "SYSTEM_DESIGN" | null;
  questionTitle: string;
  questionPrompt?: string | null;
  targetLevel?: string | null;
  selectedLanguage?: string | null;
  transcripts: TranscriptLike[];
  events: SessionEventLike[];
  executionRuns: ExecutionRunLike[];
  candidateStateSnapshots?: CandidateStateSnapshotLike[];
  interviewerDecisionSnapshots?: InterviewerDecisionSnapshotLike[];
  intentSnapshots?: IntentSnapshotLike[];
  trajectorySnapshots?: TrajectorySnapshotLike[];
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
  designSignals?: {
    signals?: {
      requirement_missing?: boolean;
      capacity_missing?: boolean;
      tradeoff_missed?: boolean;
      spof_missed?: boolean;
      bottleneck_unexamined?: boolean;
    };
    evidenceRefs?: {
      requirement_missing?: string[];
      capacity_missing?: string[];
      tradeoff_missed?: string[];
      spof_missed?: string[];
      bottleneck_unexamined?: string[];
    };
    summary?: string;
  };
  summary?: string;
};

type CandidateDecisionSummary = {
  action?: string;
  normalizedAction?: string;
  target?: string;
  question?: string;
  reason?: string;
  confidence?: number;
  totalScore?: number;
  tieBreaker?: string;
  scoreBreakdown?: Array<{
    key?: string;
    magnitude?: number;
    kind?: string;
    detail?: string;
  }>;
  candidateScores?: Array<{
    action?: string;
    totalScore?: number;
    hardMasked?: boolean;
  }>;
  targetCodeLine?: string;
  specificIssue?: string;
  expectedAnswer?: string;
  suggestedStage?: string;
  hintStyle?: string;
  hintLevel?: string;
  policyAction?: string;
  policyMode?: string;
  policyArchetype?: string;
  policyAdaptationReason?: string;
  decisionPathway?: string[];
  temporalProbeStreak?: number;
  temporalProbeDecay?: number;
  temporalIdleLikely?: boolean;
  temporalIdleProbeBoost?: number;
  temporalCodingInterruptionPenalty?: number;
  scoreWeightProfile?: {
    need?: number;
    timing?: number;
    value?: number;
    closure?: number;
    proposalBias?: number;
    temporalProbeDecay?: number;
    temporalIdleProbeBoost?: number;
    temporalCodingInterruptionPenalty?: number;
    dominantActionBias?: string;
    actionBiasSpread?: number;
  };
};

type HintSummary = HintLedger & {
  requested: number;
  served: number;
  penaltyApplied: number;
  efficiencyScore: number;
  coachability: {
    score: number;
    label: "high" | "moderate" | "low";
    rationale: string;
  };
};

type StageReplayGroup = {
  stage: string;
  label: string;
  evidence: string[];
  signalSnapshots: CandidateSignalSummary[];
  decisions: CandidateDecisionSummary[];
  turns: Array<{ speaker: string; text: string }>;
};

type EvidenceTraceItem = {
  claim: string;
  category: string;
  evidencePoints: string[];
  impact?: string;
  improvement?: string[];
  confidence?: number;
  verdict?: "strong" | "mixed" | "weak";
};

type CandidateDna = {
  headline: string;
  traits: string[];
  strengths: string[];
  watchouts: string[];
  growthEdge: string;
};

type MomentOfTruth = {
  title: string;
  detail: string;
  evidence?: string[];
  importance: "high" | "medium";
};

type RubricSummaryItem = {
  key: string;
  dimension: string;
  score: number;
  maxScore: number;
  verdict: "strong" | "mixed" | "weak";
  rationale: string;
  basis: string;
  evidence: string[];
  evidenceRefs: Array<{
    kind: "candidate_state_snapshot" | "decision_snapshot" | "execution_run" | "session_event";
    id: string;
    label: string;
    note: string;
  }>;
};

type StageReplaySection = {
  key: string;
  label: string;
  stages: string[];
  evidence: string[];
  signalSnapshots: CandidateSignalSummary[];
  decisions: CandidateDecisionSummary[];
  turns: Array<{ speaker: string; text: string }>;
};

type CounterfactualSummary = {
  autoCapturedEvidence: string[];
  selfCorrectionWindows: number[];
  wouldLikelySelfCorrect: boolean;
  shouldWaitBeforeIntervening: boolean;
};

type SnapshotTimelineEntry = {
  createdAt: string;
  stage: string | null;
  kind: "intent" | "trajectory";
  payload: Record<string, unknown>;
};

type EvaluatedLevel = {
  level: "L3" | "L4" | "L5" | "L6";
  rationale: string;
};

type RecommendationBand = "Strong Hire" | "Hire" | "Borderline" | "No Hire";

type RecommendationBasis = {
  band: RecommendationBand;
  independenceSignal: "strong" | "mixed" | "weak";
  coachabilitySignal: "high" | "moderate" | "low";
  reasoningSignal: "strong" | "mixed" | "weak";
  executionSignal: "closed" | "mixed" | "unclosed";
  notes: string[];
  evidenceTrace: RubricSummaryItem["evidenceRefs"];
};

type ShadowPolicySnapshot = {
  at: string | null;
  archetype: string | null;
  action: string | null;
  target: string | null;
  diff: string[];
  topScoreDelta: {
    action: string | null;
    delta: number;
  } | null;
};

type CalibrationMatrix = {
  finalCall: RecommendationBand;
  evaluatedLevel: EvaluatedLevel["level"];
  overallScore: number;
  executionSignal: RecommendationBasis["executionSignal"];
  reasoningSignal: RecommendationBasis["reasoningSignal"];
  independenceSignal: RecommendationBasis["independenceSignal"];
  coachabilitySignal: RecommendationBasis["coachabilitySignal"];
  notes: string[];
};

type RewardSummary = {
  totalTurns: number;
  averageTotal: number;
  latestTotal: number | null;
  positiveTurns: number;
  negativeTurns: number;
  nudgeConversion: {
    guideCount: number;
    pivotCount: number;
    conversionRate: number | null;
    noiseTaggedTurns: number;
  };
  averageComponents: {
    evidenceGain: number;
    redundancy: number;
    badInterruption: number;
    flowPreservation: number;
    cleanClosure: number;
    riskIdentified: number;
    tradeoffDepth: number;
    handwavePenalty: number;
    pivotImpact: number;
  };
  designEvidenceTypeCounts: Array<{ type: string; count: number }>;
  attributions: Array<{
    originTurnId: string | null;
    total: number;
    breakdown: {
      evidenceGain: number;
      redundancy: number;
      badInterruption: number;
      flowPreservation: number;
      cleanClosure: number;
      riskIdentified: number;
      tradeoffDepth: number;
      handwavePenalty: number;
      pivotImpact: number;
    };
  }>;
  topPenalties: Array<{ penalty: string; count: number }>;
  trend: Array<{ index: number; total: number; stage: string | null }>;
};

type SystemDesignDna = {
  requirement_clarity: number;
  capacity_instinct: number;
  tradeoff_depth: number;
  reliability_awareness: number;
  bottleneck_sensitivity: number;
  levelRecommendation: "Mid-level" | "Senior" | "Staff";
  calibrationNotes?: string[];
  strengths: string[];
  weaknesses: string[];
  evidencePins: Array<{
    dimension: "requirement_clarity" | "capacity_instinct" | "tradeoff_depth" | "reliability_awareness" | "bottleneck_sensitivity";
    score: number;
    snapshotId: string | null;
    turnIds: string[];
    evidenceRefs: string[];
    textPointers: Array<{
      turnId: string;
      start: number;
      length: number;
      excerpt: string;
    }>;
  }>;
};

type WhiteboardWeakSignalObservability = {
  auxiliaryOnly: true;
  excludedFromDecision: true;
  totalSignals: number;
  latest: {
    stage: string;
    componentCount: number;
    connectionCount: number;
    elementCount: number;
    at: string | null;
  } | null;
  stageTrend: Array<{
    stage: string;
    samples: number;
    avgComponentCount: number;
    avgConnectionCount: number;
    avgElementCount: number;
    maxComponentCount: number;
    maxConnectionCount: number;
    maxElementCount: number;
  }>;
  qualityCorrelation: {
    samplePairs: number;
    complexityToRewardPearson: number | null;
    note: string;
  };
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
  const mode = input.mode === "SYSTEM_DESIGN" ? "SYSTEM_DESIGN" : "CODING";
  const currentStage =
    mode === "SYSTEM_DESIGN"
      ? deriveCurrentSystemDesignStage({
          events: input.events,
          transcripts: input.transcripts,
        })
      : deriveCurrentCodingStage({
          events: input.events,
          transcripts: input.transcripts,
          latestExecutionRun: input.executionRuns[0] ?? null,
        });
  const stageJourney = buildStageJourney(input.events, currentStage);
  const stageReplay = buildStageReplay(
    input.events,
    input.transcripts,
    stageJourney,
    currentStage,
    input.candidateStateSnapshots ?? [],
    input.interviewerDecisionSnapshots ?? [],
  );
  const latestSignal = findLatestSignalSnapshot(input.events, input.candidateStateSnapshots ?? []);
  const latestDecision = findLatestDecisionSnapshot(input.events, input.interviewerDecisionSnapshots ?? []);
  const latestSignalSnapshotRow = (input.candidateStateSnapshots ?? []).at(-1) ?? null;
  const latestDecisionSnapshotRow = (input.interviewerDecisionSnapshots ?? []).at(-1) ?? null;
  const latestExecutionRun = input.executionRuns.at(-1) ?? null;
  const latestIntent = findLatestIntentSnapshot(input.intentSnapshots ?? []);
  const latestTrajectory = findLatestTrajectorySnapshot(input.trajectorySnapshots ?? []);
  const latestCandidateDna = findLatestEventPayload(input.events, "CANDIDATE_DNA_RECORDED", "candidateDna");
  const latestShadowPolicy = findLatestEventPayload(input.events, "SHADOW_POLICY_EVALUATED", "shadowPolicy");
  const shadowPolicySnapshots = buildShadowPolicySnapshots(input.events);
  const hintRequestedCount = input.events.filter((event) => event.eventType === "HINT_REQUESTED").length;
  const hintServedCount = input.events.filter((event) => event.eventType === "HINT_SERVED").length;
  const hintLedger = buildHintingLedger(input.events);
  const hintSummary = buildHintSummary(hintLedger, hintRequestedCount, hintServedCount, latestSignal);
  const counterfactualSummary = buildCounterfactualSummary(input.events);
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
    scoreDebugging(input.executionRuns, latestDecision, counterfactualSummary, hintSummary),
    scoreTestingAndComplexity(stageJourney, latestUserText, latestSignal),
    scoreIndependence(hintSummary, counterfactualSummary, latestSignal),
  ];

  const scoreSum = dimensions.reduce((total, dimension) => total + dimension.score, 0);
  const maxSum = dimensions.reduce((total, dimension) => total + dimension.maxScore, 0);
  const overallScore = Math.round((scoreSum / maxSum) * 100);
  const adjustedOverallScore = Math.max(0, Math.round(overallScore - hintSummary.penaltyApplied));
  const recommendation = toRecommendation(adjustedOverallScore);
  const missedSignals = collectMissedSignals(stageJourney, latestSignal, latestUserText, passedRuns);
  const improvementPlan = collectImprovementPlan(dimensions, latestSignal, hintServedCount, hintSummary);
  const evidenceTrace = buildEvidenceTrace({
    events: input.events,
    dimensions,
    latestSignal,
    stageReplay,
    hintSummary,
    counterfactualSummary,
  });
  const candidateDna = buildCandidateDna({
    latestSignal,
    hintSummary,
    counterfactualSummary,
    passedRuns,
  });
  const momentsOfTruth = buildMomentsOfTruth({
    stageReplay,
    dimensions,
    latestSignal,
    hintSummary,
    counterfactualSummary,
    passedRuns,
    failedRuns,
  });
  const stageSections = buildStageReplaySections(stageReplay);
  const rubricSummary = buildRubricSummary(dimensions, latestSignal, {
    latestSignalSnapshotId: latestSignalSnapshotRow?.id ?? null,
    latestDecisionSnapshotId: latestDecisionSnapshotRow?.id ?? null,
    latestExecutionRunId: latestExecutionRun?.id ?? null,
  });
  const sessionCritic = summarizeSessionCritic({
    events: input.events,
    latestSignals: latestSignal,
  });
  const intentTimeline = buildSnapshotTimeline("intent", input.intentSnapshots ?? []);
  const trajectoryTimeline = buildSnapshotTimeline("trajectory", input.trajectorySnapshots ?? []);
  const evaluatedLevel = inferEvaluatedLevel({
    overallScore: adjustedOverallScore,
    latestSignal,
    hintSummary,
    passedRuns,
    independenceScore: dimensions.find((dimension) => dimension.key === "independence")?.score ?? 3,
  });
  const recommendationBasis = buildRecommendationBasis({
    recommendation,
    evaluatedLevel,
    hintSummary,
    independenceScore: dimensions.find((dimension) => dimension.key === "independence")?.score ?? 3,
    passedRuns,
    failedRuns,
    latestSignal,
    rubricSummary,
  });
  const calibrationMatrix = buildCalibrationMatrix({
    overallScore: adjustedOverallScore,
    evaluatedLevel,
    recommendationBasis,
  });
  const rewardSummary = buildRewardSummary(input.events);
  const systemDesignDna =
    mode === "SYSTEM_DESIGN"
      ? buildSystemDesignDna({
          latestSignal,
          latestSignalSnapshotId: latestSignalSnapshotRow?.id ?? null,
          events: input.events,
          transcripts: input.transcripts,
        })
      : null;
  const whiteboardObservability =
    mode === "SYSTEM_DESIGN"
      ? buildWhiteboardWeakSignalObservability(input.events)
      : null;
  const strengthsBase = collectStrengths(dimensions, latestSignal, stageReplay, passedRuns, hintRequestedCount, hintSummary, counterfactualSummary);
  const weaknessesBase = collectWeaknesses(dimensions, currentStage, latestSignal, hintRequestedCount, hintSummary);
  const strengths = systemDesignDna
    ? [...strengthsBase, ...systemDesignDna.strengths].filter((item, index, list) => list.indexOf(item) === index).slice(0, 5)
    : strengthsBase;
  const weaknesses = systemDesignDna
    ? [...weaknessesBase, ...systemDesignDna.weaknesses].filter((item, index, list) => list.indexOf(item) === index).slice(0, 5)
    : weaknessesBase;
  const overallSummary = buildOverallSummary({
    recommendation,
    evaluatedLevel,
    currentStage,
    passedRuns,
    failedRuns,
    hintRequestedCount,
    hintSummary,
    stageJourney,
    latestSignal,
  });

  return {
    overallScore: adjustedOverallScore,
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
      mode,
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
        requested: hintSummary.requested,
        served: hintSummary.served,
        totalHintCost: hintSummary.totalHintCost,
        averageHintCost: hintSummary.averageHintCost,
        strongestHintLevel: hintSummary.strongestHintLevel,
        strongestHintTier: hintSummary.strongestHintTier,
        byGranularity: hintSummary.byGranularity,
        byRescueMode: hintSummary.byRescueMode,
        byInitiator: hintSummary.byInitiator,
        byRequestTiming: hintSummary.byRequestTiming,
        byMomentumAtHint: hintSummary.byMomentumAtHint,
        penaltyApplied: hintSummary.penaltyApplied,
        efficiencyScore: hintSummary.efficiencyScore,
        coachability: hintSummary.coachability,
      },
      transcriptSummary: {
        userTurns: userTurns.length,
        aiTurns: aiTurns.length,
      },
      candidateState: latestSignal,
      latestDecision,
      latestIntent,
      latestTrajectory,
      latestCandidateDna,
      latestShadowPolicy,
      shadowPolicySnapshots,
      stageReplay,
      stageSections,
      evidenceTrace,
      candidateDna,
      momentsOfTruth,
      rubricSummary,
      counterfactualSummary,
      sessionCritic,
      intentTimeline,
      trajectoryTimeline,
      dimensions,
      strengths,
      weaknesses,
      missedSignals,
      improvementPlan,
      evaluatedLevel: evaluatedLevel.level,
      levelRationale: evaluatedLevel.rationale,
      recommendationBand: recommendationBasis.band,
      recommendationBasis,
      calibrationMatrix,
      rewardSummary,
      systemDesignDna,
      whiteboardObservability,
      recommendationRationale: buildRecommendationRationale({
        recommendation,
        evaluatedLevel,
        recommendationBasis,
        passedRuns,
        failedRuns,
        hintSummary,
        latestSignal,
      }),
      overallScore: adjustedOverallScore,
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
    score: score,
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
    score: score,
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
    score: score,
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

function scoreDebugging(
  executionRuns: ExecutionRunLike[],
  latestDecision: CandidateDecisionSummary | null,
  counterfactualSummary: CounterfactualSummary,
  hintSummary: HintSummary,
): DimensionScore {
  const passedRuns = executionRuns.filter((run) => run.status === "PASSED").length;
  const failingRuns = executionRuns.filter((run) => run.status !== "PASSED").length;
  const hasSelfCorrectionSignal = counterfactualSummary.selfCorrectionWindows.length > 0;
  const baseScore =
    failingRuns === 0
      ? hasSelfCorrectionSignal
        ? 4
        : 3
      : passedRuns > 0
        ? 5
        : hasSelfCorrectionSignal
          ? 4
          : latestDecision?.target === "debugging"
            ? 3
            : 2;
  const rescuePenalty = hintSummary.byRescueMode.debug_rescue > 0 ? 1 : 0;
  const adjustedScore = Math.max(1, baseScore - rescuePenalty);

  return {
    key: "debugging",
    label: "Debugging",
    issue:
      hasSelfCorrectionSignal
        ? "The session captured a credible self-correction window during debugging."
        : passedRuns > 0
          ? "The candidate demonstrated at least one successful recovery from failure."
          : failingRuns > 0
            ? "The session surfaced failures without a strong recovery signal."
            : "The session did not produce much explicit debugging evidence.",
    score: adjustedScore,
    maxScore: 5,
    evidence:
      hasSelfCorrectionSignal
        ? `The critic explicitly allowed a ${counterfactualSummary.selfCorrectionWindows[0]}s self-correction window, which is positive evidence of debugging discipline.`
        : failingRuns === 0
          ? "The session did not surface much explicit debugging evidence."
          : passedRuns > 0
            ? "The candidate recovered from at least one failing run, which is a strong debugging signal."
            : "The session showed failing runs without later evidence of a successful recovery.",
    impact:
      hasSelfCorrectionSignal
        ? "Letting the candidate self-correct is a strong proxy for productive debugging discipline under pressure."
        : passedRuns > 0
          ? "Successful debugging is a positive sign for production-style reasoning under pressure."
          : "Unrecovered execution failures weaken confidence in correctness and momentum.",
    improvement: [
      "When a run fails, identify the first incorrect state transition before rewriting larger blocks.",
      "Use one tiny reproducer input to isolate the failing path.",
      rescuePenalty > 0
        ? "Try one local debugging hypothesis before asking for code-level debugging rescue."
        : "Keep narrating the first failing branch so your debugging path stays inspectable.",
    ],
  };
}

function scoreIndependence(
  hintSummary: HintSummary,
  counterfactualSummary: CounterfactualSummary,
  latestSignal: CandidateSignalSummary | null,
): DimensionScore {
  const selfCorrectionBoost = counterfactualSummary.selfCorrectionWindows.length > 0 ? 1 : 0;
  const autoEvidenceBoost = counterfactualSummary.autoCapturedEvidence.length > 0 ? 1 : 0;
  const baseScore =
    hintSummary.totalHintCost === 0
      ? 5
      : hintSummary.penaltyApplied <= 2
        ? 4
        : hintSummary.penaltyApplied <= 5
          ? 3
          : 2;
  const adjustedScore = Math.min(5, Math.max(1, baseScore + selfCorrectionBoost + autoEvidenceBoost - (hintSummary.byRescueMode.implementation_rescue > 0 ? 1 : 0)));

  return {
    key: "independence",
    label: "Independence",
    issue:
      adjustedScore >= 4
        ? "The candidate generated enough evidence without heavy interviewer rescue."
        : "The interviewer needed to supply meaningful rescue to keep momentum moving.",
    score: adjustedScore,
    maxScore: 5,
    evidence:
      hintSummary.totalHintCost === 0
        ? "No hint cost was recorded, so the candidate sustained momentum independently."
        : `Hint cost reached ${hintSummary.totalHintCost.toFixed(2)} with strongest tier ${hintSummary.strongestHintTier ?? "unknown"}.`,
    impact:
      adjustedScore >= 4
        ? "This strengthens confidence that the candidate can move forward without frequent external steering."
        : "Heavy rescue reduces confidence in independent execution under interview pressure.",
    improvement: [
      "Before asking for help, narrate one concrete next step or debugging hypothesis.",
      "Try to surface complexity, tests, or tradeoffs proactively so the interviewer does not need to pull them out.",
      latestSignal?.reasoningDepth === "thin"
        ? "Explain one reason why your approach works before seeking confirmation."
        : "Keep the interviewer updated on what evidence you are gathering as you code.",
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
    score: score,
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
  candidateStateSnapshots: CandidateStateSnapshotLike[] = [],
  interviewerDecisionSnapshots: InterviewerDecisionSnapshotLike[] = [],
): StageReplayGroup[] {
  const orderedStages = [...stageJourney];
  const currentLabel = describeCodingStageSafe(currentStage);
  if (!orderedStages.includes(currentLabel)) {
    orderedStages.push(currentLabel);
  }

  const groups = new Map<string, StageReplayGroup>();
  const ensureGroup = (stageLabel: string) => {
    if (!groups.has(stageLabel)) {
      groups.set(stageLabel, {
        stage: stageLabel,
        label: stageLabel,
        evidence: [],
        signalSnapshots: [],
        decisions: [],
        turns: [],
      });
      if (!orderedStages.includes(stageLabel)) {
        orderedStages.push(stageLabel);
      }
    }
    return groups.get(stageLabel)!;
  };

  for (const stage of orderedStages) {
    ensureGroup(stage);
  }

  const useSnapshotSignals = candidateStateSnapshots.length > 0;
  const useSnapshotDecisions = interviewerDecisionSnapshots.length > 0;
  let activeStage = orderedStages[0] ?? currentLabel;
  let turnIndex = 0;

  for (const event of events) {
    if (event.eventType === "STAGE_ADVANCED") {
      const nextStage = describeCodingStageSafe(stringValue(asRecord(event.payloadJson).stage) ?? activeStage);
      activeStage = nextStage;
      ensureGroup(activeStage).evidence.push(`Stage advanced: ${buildStageAdvanceEvidence(asRecord(event.payloadJson))}`);
      continue;
    }

    if (!useSnapshotSignals && event.eventType === "SIGNAL_SNAPSHOT_RECORDED") {
      const payload = asRecord(event.payloadJson);
      const stage = describeCodingStageSafe(stringValue(payload.stage) ?? activeStage);
      const target = ensureGroup(stage);
      const signals = asRecord(payload.signals) as unknown as CandidateSignalSummary;
      target.signalSnapshots.push(signals);
      target.evidence.push(`Signal snapshot: ${signals.summary ?? "candidate state updated"}.`);
      continue;
    }

    if (!useSnapshotDecisions && event.eventType === "DECISION_RECORDED") {
      const payload = asRecord(event.payloadJson);
      const stage = describeCodingStageSafe(stringValue(payload.stage) ?? activeStage);
      const target = ensureGroup(stage);
      const decision = asRecord(payload.decision) as unknown as CandidateDecisionSummary;
      target.decisions.push(decision);
      target.evidence.push(`Decision: ${decision.action ?? "unknown action"} toward ${decision.target ?? "unknown target"}.`);
      continue;
    }

    if (event.eventType === "HINT_SERVED") {
      ensureGroup(activeStage).evidence.push(`Hint served: ${(stringValue(asRecord(event.payloadJson).hintLevel) ?? "LIGHT").toLowerCase()} ${(stringValue(asRecord(event.payloadJson).hintStyle) ?? "hint").replaceAll("_", " ").toLowerCase()}${stringValue(asRecord(event.payloadJson).rescueMode) ? ` / ${stringValue(asRecord(event.payloadJson).rescueMode)?.replaceAll("_", " ")}` : ""}${typeof asRecord(event.payloadJson).hintCost === "number" ? ` / cost ${Number(asRecord(event.payloadJson).hintCost).toFixed(2)}` : ""}.`);
      continue;
    }

    if (event.eventType === "CODE_RUN_COMPLETED") {
      const payload = asRecord(event.payloadJson);
      ensureGroup(activeStage).evidence.push(`Code run result: ${stringValue(payload.status) ?? "unknown"}.`);
      continue;
    }
  }

  for (const row of candidateStateSnapshots) {
    const stage = describeCodingStageSafe(typeof row.stage === "string" ? row.stage : currentStage);
    const target = ensureGroup(stage);
    const signals = asRecord(row.snapshotJson) as unknown as CandidateSignalSummary;
    target.signalSnapshots.push(signals);
    target.evidence.push(`Signal snapshot: ${signals.summary ?? "candidate state updated"}.`);
  }

  for (const row of interviewerDecisionSnapshots) {
    const stage = describeCodingStageSafe(typeof row.stage === "string" ? row.stage : currentStage);
    const target = ensureGroup(stage);
    const decision = asRecord(row.decisionJson) as unknown as CandidateDecisionSummary;
    target.decisions.push(decision);
    target.evidence.push(`Decision: ${decision.action ?? "unknown action"} toward ${decision.target ?? "unknown target"}.`);
  }

  for (const segment of transcripts.filter((item) => item.speaker !== "SYSTEM")) {
    const stage = orderedStages[Math.min(turnIndex, orderedStages.length - 1)] ?? currentLabel;
    ensureGroup(stage).turns.push({
      speaker: segment.speaker,
      text: truncate(segment.text, 160),
    });
    if (segment.speaker === "USER") {
      turnIndex += 1;
    }
  }

  return [...groups.values()].filter((group) => group.evidence.length > 0 || group.turns.length > 0);
}

function buildCandidateDna(input: {
  latestSignal: CandidateSignalSummary | null,
  hintSummary: HintSummary,
  counterfactualSummary: CounterfactualSummary,
  passedRuns: number,
}): CandidateDna {
  const traits: string[] = [];
  const strengths: string[] = [];
  const watchouts: string[] = [];

  if (input.latestSignal?.reasoningDepth === "deep") {
    traits.push("Deep thinker");
    strengths.push("Explains why the solution works instead of only naming the approach.");
  } else if (input.latestSignal?.reasoningDepth === "thin") {
    traits.push("Conclusion-first explainer");
    watchouts.push("Reasoning sometimes arrives without enough proof or invariant detail.");
  }

  if (input.latestSignal?.testingDiscipline === "strong") {
    traits.push("Validation-aware");
    strengths.push("Surfaces edge cases and expected outputs without heavy prompting.");
  } else if (input.latestSignal?.testingDiscipline === "missing") {
    traits.push("Low testing discipline");
    watchouts.push("Needs to make validation and expected outputs more explicit before wrap-up.");
  }

  if (input.latestSignal?.complexityRigor === "strong") {
    traits.push("Tradeoff-conscious");
    strengths.push("Connects final complexity to an explicit performance tradeoff.");
  } else if (input.latestSignal?.complexityRigor === "missing") {
    watchouts.push("Performance discussion still needs a cleaner final complexity close-out.");
  }

  if (input.passedRuns > 0) {
    traits.push("Execution-capable");
    strengths.push("Turns the chosen approach into runnable code and reaches executable evidence.");
  }

  if (input.counterfactualSummary.selfCorrectionWindows.length > 0) {
    traits.push("Self-correcting debugger");
    strengths.push("Shows signs of productive self-correction before needing intervention.");
  }

  if (input.hintSummary.penaltyApplied >= 6) {
    traits.push("High rescue overhead");
    watchouts.push("Needed meaningful interviewer rescue to keep momentum moving.");
  } else if (input.hintSummary.totalHintCost === 0) {
    traits.push("Independent operator");
    strengths.push("Sustains progress without relying on explicit hints.");
  }

  const uniqueTraits = [...new Set(traits)].slice(0, 4);
  const uniqueStrengths = [...new Set(strengths)].slice(0, 3);
  const uniqueWatchouts = [...new Set(watchouts)].slice(0, 3);
  const growthEdge =
    uniqueWatchouts[0] ??
    (input.latestSignal?.behavior === "overthinking"
      ? "Compress exploration into one concrete next step sooner."
      : "Keep strengthening explicit validation and proof-style explanation under pressure.");
  const headline = uniqueTraits.length > 0 ? uniqueTraits.slice(0, 2).join(" with ") : "Balanced candidate profile";

  return {
    headline,
    traits: uniqueTraits,
    strengths: uniqueStrengths,
    watchouts: uniqueWatchouts,
    growthEdge,
  };
}

function buildMomentsOfTruth(input: {
  stageReplay: StageReplayGroup[];
  dimensions: DimensionScore[];
  latestSignal: CandidateSignalSummary | null;
  hintSummary: HintSummary;
  counterfactualSummary: CounterfactualSummary;
  passedRuns: number;
  failedRuns: number;
}): MomentOfTruth[] {
  const moments: MomentOfTruth[] = [];

  if (input.passedRuns > 0) {
    moments.push({
      title: "Reached working code",
      detail: "The candidate produced at least one passing run, which anchored the session in executable evidence.",
      evidence: ["A passing execution run was recorded during the session."],
      importance: "high",
    });
  } else if (input.failedRuns > 0) {
    moments.push({
      title: "Execution never fully stabilized",
      detail: "The session surfaced implementation attempts, but no passing run arrived to close the loop.",
      evidence: ["The execution history contains non-passing runs without a final passing run."],
      importance: "high",
    });
  }

  if (input.counterfactualSummary.selfCorrectionWindows.length > 0) {
    moments.push({
      title: "Earned a self-correction window",
      detail: "The interviewer intentionally waited, which is positive evidence that the candidate was debugging productively.",
      evidence: input.counterfactualSummary.selfCorrectionWindows.map((seconds) => `A ${seconds}s self-correction window was granted before intervention.`),
      importance: "high",
    });
  }

  if (input.hintSummary.penaltyApplied > 0) {
    moments.push({
      title: "Rescue changed the evaluation",
      detail: "Hint usage materially affected the independence signal and final scoring story.",
      evidence: [
        `Total hint cost reached ${input.hintSummary.totalHintCost.toFixed(2)}.`,
        `A ${input.hintSummary.penaltyApplied}-point penalty was applied in the report.`,
      ],
      importance: "medium",
    });
  }

  const weakestDimension = [...input.dimensions].sort((left, right) => left.score - right.score)[0];
  if (weakestDimension) {
    moments.push({
      title: `Key weakness: ${weakestDimension.label}`,
      detail: weakestDimension.issue ?? weakestDimension.evidence,
      evidence: [weakestDimension.evidence],
      importance: "medium",
    });
  }

  return moments.slice(0, 3);
}

function buildRubricEvidenceRefs(input: {
  latestSignalSnapshotId: string | null;
  latestDecisionSnapshotId?: string | null;
  latestExecutionRunId?: string | null;
  latestCodeRunEventId?: string | null;
  latestCriticEventId?: string | null;
  latestIntentEventId?: string | null;
  latestCandidateDnaEventId?: string | null;
  includeDecision?: boolean;
  includeExecutionRun?: boolean;
  includeCodeRunEvent?: boolean;
  includeCriticEvent?: boolean;
  includeIntentEvent?: boolean;
  includeDnaEvent?: boolean;
}) {
  const refs: RubricSummaryItem["evidenceRefs"] = [];

  if (input.latestSignalSnapshotId) {
    refs.push({
      kind: "candidate_state_snapshot",
      id: input.latestSignalSnapshotId,
      label: `Signal snapshot ${input.latestSignalSnapshotId}`,
      note: "Primary candidate-state evidence for this rubric dimension.",
    });
  }

  if (input.includeDecision && input.latestDecisionSnapshotId) {
    refs.push({
      kind: "decision_snapshot",
      id: input.latestDecisionSnapshotId,
      label: `Decision snapshot ${input.latestDecisionSnapshotId}`,
      note: "Interviewer decision evidence used to interpret pressure, timing, or closure quality.",
    });
  }

  if (input.includeExecutionRun && input.latestExecutionRunId) {
    refs.push({
      kind: "execution_run",
      id: input.latestExecutionRunId,
      label: `Execution run ${input.latestExecutionRunId}`,
      note: "Executable evidence for implementation correctness or debugging closure.",
    });
  }

  if (input.includeCodeRunEvent && input.latestCodeRunEventId) {
    refs.push({
      kind: "session_event",
      id: input.latestCodeRunEventId,
      label: `Code-run event ${input.latestCodeRunEventId}`,
      note: "Event-level evidence that a code run completed and affected evaluation.",
    });
  }

  if (input.includeCriticEvent && input.latestCriticEventId) {
    refs.push({
      kind: "session_event",
      id: input.latestCriticEventId,
      label: `Critic event ${input.latestCriticEventId}`,
      note: "Critic evidence about timing, self-correction, or auto-captured signal.",
    });
  }

  if (input.includeIntentEvent && input.latestIntentEventId) {
    refs.push({
      kind: "session_event",
      id: input.latestIntentEventId,
      label: `Intent event ${input.latestIntentEventId}`,
      note: "Intent evidence used to judge whether the candidate exposed complexity/tradeoff signal clearly enough.",
    });
  }

  if (input.includeDnaEvent && input.latestCandidateDnaEventId) {
    refs.push({
      kind: "session_event",
      id: input.latestCandidateDnaEventId,
      label: `DNA event ${input.latestCandidateDnaEventId}`,
      note: "Candidate DNA evidence contributing to communication and independence interpretation.",
    });
  }

  return refs;
}

function buildRewardSummary(events: SessionEventLike[]): RewardSummary | null {
  const rewardEvents = events
    .filter((event) => event.eventType === "REWARD_RECORDED")
    .map((event) => asRecord(asRecord(event.payloadJson).reward))
    .filter((reward) => typeof reward.total === "number");

  if (rewardEvents.length === 0) {
    return null;
  }

  const sumTotal = rewardEvents.reduce((sum, reward) => sum + (reward.total as number), 0);
  const positiveTurns = rewardEvents.filter((reward) => (reward.total as number) > 0).length;
  const negativeTurns = rewardEvents.filter((reward) => (reward.total as number) < 0).length;
  const penaltyCounts = new Map<string, number>();
  for (const reward of rewardEvents) {
    const penalties = Array.isArray(reward.penalties)
      ? reward.penalties.filter((item): item is string => typeof item === "string")
      : [];
    for (const penalty of penalties) {
      penaltyCounts.set(penalty, (penaltyCounts.get(penalty) ?? 0) + 1);
    }
  }

  const componentTotals = rewardEvents.reduce<{
    evidenceGain: number;
    redundancy: number;
    badInterruption: number;
    flowPreservation: number;
    cleanClosure: number;
    riskIdentified: number;
    tradeoffDepth: number;
    handwavePenalty: number;
    pivotImpact: number;
  }>(
    (acc, reward) => {
      const components = asRecord(reward.components);
      acc.evidenceGain += numberValue(components.evidenceGain);
      acc.redundancy += numberValue(components.redundancy);
      acc.badInterruption += numberValue(components.badInterruption);
      acc.flowPreservation += numberValue(components.flowPreservation);
      acc.cleanClosure += numberValue(components.cleanClosure);
      acc.riskIdentified += numberValue(components.riskIdentified);
      acc.tradeoffDepth += numberValue(components.tradeoffDepth);
      acc.handwavePenalty += numberValue(components.handwavePenalty);
      acc.pivotImpact += numberValue(components.pivotImpact);
      return acc;
    },
    {
      evidenceGain: 0,
      redundancy: 0,
      badInterruption: 0,
      flowPreservation: 0,
      cleanClosure: 0,
      riskIdentified: 0,
      tradeoffDepth: 0,
      handwavePenalty: 0,
      pivotImpact: 0,
    },
  );

  const designEvidenceTypeCounts = new Map<string, number>();
  for (const reward of rewardEvents) {
    const types = Array.isArray(reward.designEvidenceTypes)
      ? reward.designEvidenceTypes.filter((item): item is string => typeof item === "string")
      : [];
    for (const type of types) {
      designEvidenceTypeCounts.set(type, (designEvidenceTypeCounts.get(type) ?? 0) + 1);
    }
  }

  const attributions = events
    .filter((event) => event.eventType === "REWARD_RECORDED")
    .slice(-8)
    .map((event) => {
      const payload = asRecord(event.payloadJson);
      const reward = asRecord(payload.reward);
      const attribution = asRecord(reward.attribution);
      const breakdown = asRecord(attribution.breakdown);
      return {
        originTurnId: stringValue(attribution.originTurnId),
        total: typeof reward.total === "number" ? Number(reward.total.toFixed(2)) : 0,
        breakdown: {
          evidenceGain: Number(numberValue(breakdown.evidenceGain).toFixed(2)),
          redundancy: Number(numberValue(breakdown.redundancy).toFixed(2)),
          badInterruption: Number(numberValue(breakdown.badInterruption).toFixed(2)),
          flowPreservation: Number(numberValue(breakdown.flowPreservation).toFixed(2)),
          cleanClosure: Number(numberValue(breakdown.cleanClosure).toFixed(2)),
          riskIdentified: Number(numberValue(breakdown.riskIdentified).toFixed(2)),
          tradeoffDepth: Number(numberValue(breakdown.tradeoffDepth).toFixed(2)),
          handwavePenalty: Number(numberValue(breakdown.handwavePenalty).toFixed(2)),
          pivotImpact: Number(numberValue(breakdown.pivotImpact).toFixed(2)),
        },
      };
    });

  const trend = events
    .filter((event) => event.eventType === "REWARD_RECORDED")
    .slice(-5)
    .map((event, index) => {
      const payload = asRecord(event.payloadJson);
      const reward = asRecord(payload.reward);
      return {
        index: index + 1,
        total: typeof reward.total === "number" ? Number(reward.total.toFixed(2)) : 0,
        stage: stringValue(payload.stage),
      };
    });

  const count = rewardEvents.length;
  const guideCount = events.filter((event) => event.eventType === "HINT_SERVED").length;
  const pivotCount = rewardEvents.filter((reward) => numberValue(asRecord(reward.components).pivotImpact) > 0).length;
  const noiseTaggedTurns = rewardEvents.filter((reward) => {
    const tags = Array.isArray(reward.noiseTags)
      ? reward.noiseTags.filter((item): item is string => typeof item === "string")
      : [];
    return tags.length > 0;
  }).length;
  const conversionRate = guideCount > 0 ? Number((pivotCount / guideCount).toFixed(2)) : null;
  return {
    totalTurns: count,
    averageTotal: Number((sumTotal / count).toFixed(2)),
    latestTotal: Number(((rewardEvents.at(-1)?.total as number) ?? 0).toFixed(2)),
    positiveTurns,
    negativeTurns,
    nudgeConversion: {
      guideCount,
      pivotCount,
      conversionRate,
      noiseTaggedTurns,
    },
    averageComponents: {
      evidenceGain: Number((componentTotals.evidenceGain / count).toFixed(2)),
      redundancy: Number((componentTotals.redundancy / count).toFixed(2)),
      badInterruption: Number((componentTotals.badInterruption / count).toFixed(2)),
      flowPreservation: Number((componentTotals.flowPreservation / count).toFixed(2)),
      cleanClosure: Number((componentTotals.cleanClosure / count).toFixed(2)),
      riskIdentified: Number((componentTotals.riskIdentified / count).toFixed(2)),
      tradeoffDepth: Number((componentTotals.tradeoffDepth / count).toFixed(2)),
      handwavePenalty: Number((componentTotals.handwavePenalty / count).toFixed(2)),
      pivotImpact: Number((componentTotals.pivotImpact / count).toFixed(2)),
    },
    designEvidenceTypeCounts: [...designEvidenceTypeCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([type, count]) => ({ type, count })),
    attributions,
    topPenalties: [...penaltyCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([penalty, count]) => ({ penalty, count })),
    trend,
  };
}

function buildRubricSummary(
  dimensions: DimensionScore[],
  latestSignal: CandidateSignalSummary | null,
  refs: {
    latestSignalSnapshotId: string | null;
    latestDecisionSnapshotId?: string | null;
    latestExecutionRunId?: string | null;
    latestCodeRunEventId?: string | null;
    latestCriticEventId?: string | null;
    latestIntentEventId?: string | null;
    latestCandidateDnaEventId?: string | null;
  },
): RubricSummaryItem[] {
  const communication = dimensions.find((dimension) => dimension.key === "communication");
  const implementation = dimensions.find((dimension) => dimension.key === "implementation");
  const debugging = dimensions.find((dimension) => dimension.key === "debugging");
  const testingAndComplexity = dimensions.find((dimension) => dimension.key === "testing_and_complexity");

  const correctnessScore = clampRubricScore(
    Math.round(((implementation?.score ?? 3) + (debugging?.score ?? 3)) / 2),
  );
  const complexityScore = clampRubricScore(
    latestSignal?.complexityRigor === "strong"
      ? 5
      : latestSignal?.complexityRigor === "moderate"
        ? 4
        : latestSignal?.complexityRigor === "missing"
          ? 2
          : testingAndComplexity?.score ?? 3,
  );
  const communicationScore = clampRubricScore(communication?.score ?? 3);

  return [
    {
      key: "correctness",
      dimension: "Correctness",
      score: correctnessScore,
      maxScore: 5,
      verdict: rubricVerdict(correctnessScore, 5),
      rationale:
        implementation?.issue ??
        debugging?.issue ??
        "Correctness evidence was inferred from implementation and debugging outcomes.",
      basis:
        correctnessScore >= 4
          ? "Working code or strong recovery signals supported a high-confidence correctness read."
          : correctnessScore === 3
            ? "Correctness signals were mixed: the solution direction was sound, but execution or debugging evidence stayed incomplete."
            : "Correctness evidence remained weak because the session never closed the loop on implementation or recovery.",
      evidence: [implementation?.evidence, debugging?.evidence].filter((item): item is string => Boolean(item)),
      evidenceRefs: buildRubricEvidenceRefs({
        latestSignalSnapshotId: refs.latestSignalSnapshotId,
        latestDecisionSnapshotId: refs.latestDecisionSnapshotId,
        latestExecutionRunId: refs.latestExecutionRunId,
        latestCodeRunEventId: refs.latestCodeRunEventId,
        latestCriticEventId: refs.latestCriticEventId,
        includeDecision: true,
        includeExecutionRun: true,
        includeCodeRunEvent: true,
        includeCriticEvent: true,
      }),
    },
    {
      key: "complexity",
      dimension: "Complexity",
      score: complexityScore,
      maxScore: 5,
      verdict: rubricVerdict(complexityScore, 5),
      rationale:
        testingAndComplexity?.issue ??
        "Complexity scoring was inferred from the final testing and tradeoff discussion.",
      basis:
        complexityScore >= 4
          ? "The candidate closed with an explicit time/space story and a credible tradeoff explanation."
          : complexityScore === 3
            ? "Some complexity evidence was present, but the tradeoff or final performance story stayed partial."
            : "Complexity rigor stayed weak or absent, so the performance story remained under-specified.",
      evidence: [testingAndComplexity?.evidence].filter((item): item is string => Boolean(item)),
      evidenceRefs: buildRubricEvidenceRefs({
        latestSignalSnapshotId: refs.latestSignalSnapshotId,
        latestDecisionSnapshotId: refs.latestDecisionSnapshotId,
        latestIntentEventId: refs.latestIntentEventId,
        includeDecision: true,
        includeIntentEvent: true,
      }),
    },
    {
      key: "communication",
      dimension: "Communication",
      score: communicationScore,
      maxScore: 5,
      verdict: rubricVerdict(communicationScore, 5),
      rationale:
        communication?.issue ??
        "Communication scoring was inferred from how clearly the candidate exposed reasoning.",
      basis:
        communicationScore >= 4
          ? "The candidate consistently exposed reasoning clearly enough for targeted follow-up."
          : communicationScore === 3
            ? "Communication was serviceable, but parts of the reasoning remained compressed."
            : "Communication gaps forced the interviewer to reconstruct the thought process repeatedly.",
      evidence: [communication?.evidence].filter((item): item is string => Boolean(item)),
      evidenceRefs: buildRubricEvidenceRefs({
        latestSignalSnapshotId: refs.latestSignalSnapshotId,
        latestCandidateDnaEventId: refs.latestCandidateDnaEventId,
        includeDnaEvent: true,
      }),
    },
  ];
}

function buildStageReplaySections(stageReplay: StageReplayGroup[]): StageReplaySection[] {
  const sectionDefinitions = [
    {
      key: "discussion",
      label: "Discussion",
      stageMatchers: ["problem understanding", "approach discussion"],
    },
    {
      key: "coding",
      label: "Coding",
      stageMatchers: ["implementation", "debugging"],
    },
    {
      key: "testing",
      label: "Testing",
      stageMatchers: ["testing and complexity", "wrap up"],
    },
  ];

  return sectionDefinitions
    .map((section) => {
      const groups = stageReplay.filter((group) =>
        section.stageMatchers.includes(group.stage.trim().toLowerCase()),
      );
      return {
        key: section.key,
        label: section.label,
        stages: groups.map((group) => group.label),
        evidence: groups.flatMap((group) => group.evidence),
        signalSnapshots: groups.flatMap((group) => group.signalSnapshots),
        decisions: groups.flatMap((group) => group.decisions),
        turns: groups.flatMap((group) => group.turns).slice(0, 6),
      };
    })
    .filter(
      (section) =>
        section.evidence.length > 0 ||
        section.signalSnapshots.length > 0 ||
        section.decisions.length > 0 ||
        section.turns.length > 0,
    );
}

function rubricVerdict(score: number, maxScore: number): "strong" | "mixed" | "weak" {
  return score >= maxScore - 1 ? "strong" : score <= Math.ceil(maxScore / 2) ? "weak" : "mixed";
}

function clampRubricScore(value: number) {
  return Math.max(1, Math.min(5, value));
}

function buildOverallSummary(input: {
  recommendation: Recommendation;
  evaluatedLevel: EvaluatedLevel;
  currentStage: string;
  passedRuns: number;
  failedRuns: number;
  hintRequestedCount: number;
  hintSummary: HintSummary;
  stageJourney: string[];
  latestSignal: CandidateSignalSummary | null;
}) {
  return [
    `Recommendation: ${input.recommendation}.`,
    `Estimated level: ${input.evaluatedLevel.level}.`,
    `The session reached ${describeCodingStageSafe(input.currentStage)} and covered ${input.stageJourney.join(" -> ")}.`,
    input.latestSignal?.summary ? `Latest candidate state: ${input.latestSignal.summary}.` : null,
    `Code execution produced ${input.passedRuns} passing run(s) and ${input.failedRuns} non-passing run(s).`,
    input.hintRequestedCount > 0
      ? `The candidate requested ${input.hintRequestedCount} hint(s), with a total hint cost of ${input.hintSummary.totalHintCost.toFixed(2)} and an interview-score penalty of ${input.hintSummary.penaltyApplied}.`
      : "The candidate completed the session without asking for explicit hints.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildRecommendationRationale(input: {
  recommendation: Recommendation;
  evaluatedLevel: EvaluatedLevel;
  recommendationBasis: RecommendationBasis;
  passedRuns: number;
  failedRuns: number;
  hintSummary: HintSummary;
  latestSignal: CandidateSignalSummary | null;
}) {
  const executionLine =
    input.passedRuns > 0
      ? `Execution closed with ${input.passedRuns} passing run(s).`
      : `Execution never closed with a passing run and left ${input.failedRuns} non-passing run(s).`;
  const hintLine =
    input.hintSummary.totalHintCost > 0
      ? `Hint cost reached ${input.hintSummary.totalHintCost.toFixed(2)}, which reduced confidence in independent execution.`
      : "The candidate finished without meaningful hint cost, which supports independent execution.";
  const rigorLine =
    input.latestSignal?.complexityRigor === "strong" || input.latestSignal?.reasoningDepth === "deep"
      ? "Reasoning and complexity signals were strong enough to support a higher-level read."
      : "Reasoning or complexity signals stayed mixed, which limits the final recommendation.";

  return `${input.recommendationBasis.band} is the final call, mapping to an estimated ${input.evaluatedLevel.level} fit here. ${executionLine} ${hintLine} Independence signal was ${input.recommendationBasis.independenceSignal}, and coachability read as ${input.recommendationBasis.coachabilitySignal}. ${rigorLine}`;
}

function buildRecommendationBasis(input: {
  recommendation: Recommendation;
  evaluatedLevel: EvaluatedLevel;
  hintSummary: HintSummary;
  independenceScore: number;
  passedRuns: number;
  failedRuns: number;
  latestSignal: CandidateSignalSummary | null;
  rubricSummary: RubricSummaryItem[];
}): RecommendationBasis {
  const independenceSignal =
    input.independenceScore >= 4 ? "strong" : input.independenceScore >= 3 ? "mixed" : "weak";
  const coachabilitySignal = input.hintSummary.coachability.label;
  const reasoningSignal =
    input.latestSignal?.reasoningDepth === "deep" || input.latestSignal?.complexityRigor === "strong"
      ? "strong"
      : input.latestSignal?.reasoningDepth === "thin" || input.latestSignal?.complexityRigor === "missing"
        ? "weak"
        : "mixed";
  const executionSignal =
    input.passedRuns > 0 ? "closed" : input.failedRuns > 0 ? "mixed" : "unclosed";
  const notes: string[] = [];

  if (executionSignal === "closed") {
    notes.push(`Execution closed with ${input.passedRuns} passing run(s).`);
  } else if (executionSignal === "mixed") {
    notes.push(`Execution produced attempts, but ${input.failedRuns} non-passing run(s) remained open.`);
  } else {
    notes.push("Execution never stabilized into a passing run.");
  }

  if (independenceSignal === "strong") {
    notes.push("Independence stayed strong throughout the session.");
  } else if (independenceSignal === "mixed") {
    notes.push("Independence was mixed and needed some interviewer steering.");
  } else {
    notes.push("Independence stayed weak because rescue was needed to keep progress moving.");
  }

  if (coachabilitySignal === "high") {
    notes.push("Coachability was high: light guidance converted into forward progress.");
  } else if (coachabilitySignal === "moderate") {
    notes.push("Coachability was moderate: guidance helped, but required more than one layer.");
  } else {
    notes.push("Coachability was low: progress often required specific or near-solution rescue.");
  }

  if (reasoningSignal === "strong") {
    notes.push("Reasoning and tradeoff signals were strong enough to support a senior-leaning read.");
  } else if (reasoningSignal === "weak") {
    notes.push("Reasoning or complexity signals stayed weak, which limited the final call.");
  }

  const band: RecommendationBand =
    input.recommendation === "STRONG_HIRE"
      ? independenceSignal === "strong" && executionSignal === "closed" && reasoningSignal === "strong"
        ? "Strong Hire"
        : "Hire"
      : input.recommendation === "HIRE"
        ? executionSignal === "unclosed" || independenceSignal === "weak"
          ? "Borderline"
          : "Hire"
        : input.recommendation === "BORDERLINE"
          ? coachabilitySignal === "high" && executionSignal !== "unclosed"
            ? "Borderline"
            : "No Hire"
          : "No Hire";

  const evidenceTrace = input.rubricSummary.flatMap((item) => item.evidenceRefs).slice(0, 6);

  return {
    band,
    independenceSignal,
    coachabilitySignal,
    reasoningSignal,
    executionSignal,
    notes,
    evidenceTrace,
  };
}

function buildCalibrationMatrix(input: {
  overallScore: number;
  evaluatedLevel: EvaluatedLevel;
  recommendationBasis: RecommendationBasis;
}): CalibrationMatrix {
  return {
    finalCall: input.recommendationBasis.band,
    evaluatedLevel: input.evaluatedLevel.level,
    overallScore: input.overallScore,
    executionSignal: input.recommendationBasis.executionSignal,
    reasoningSignal: input.recommendationBasis.reasoningSignal,
    independenceSignal: input.recommendationBasis.independenceSignal,
    coachabilitySignal: input.recommendationBasis.coachabilitySignal,
    notes: input.recommendationBasis.notes,
  };
}

function inferEvaluatedLevel(input: {
  overallScore: number;
  latestSignal: CandidateSignalSummary | null;
  hintSummary: HintSummary;
  passedRuns: number;
  independenceScore: number;
}): EvaluatedLevel {
  if (
    input.overallScore >= 88 &&
    input.hintSummary.totalHintCost === 0 &&
    input.passedRuns > 0 &&
    input.independenceScore >= 4 &&
    input.latestSignal?.reasoningDepth === "deep" &&
    input.latestSignal?.complexityRigor === "strong"
  ) {
    return {
      level: "L6",
      rationale: "Strong execution, zero hint cost, and deep reasoning/complexity signals point to staff-leaning interview behavior.",
    };
  }

  if (
    input.overallScore >= 78 &&
    input.passedRuns > 0 &&
    input.hintSummary.totalHintCost <= 2.5 &&
    input.independenceScore >= 3 &&
    (input.latestSignal?.reasoningDepth === "deep" || input.latestSignal?.complexityRigor === "strong")
  ) {
    return {
      level: "L5",
      rationale: "The candidate converted the interview into a clean passing execution with solid reasoning and limited rescue.",
    };
  }

  if (input.overallScore >= 62) {
    return {
      level: "L4",
      rationale: "The candidate showed workable mid-level signal, but still relied on partial guidance, partial rigor, or incomplete closure.",
    };
  }

  return {
    level: "L3",
    rationale: "The candidate showed junior-leaning signal because execution, rigor, or independence still needed substantial interviewer support.",
  };
}

function collectStrengths(
  dimensions: DimensionScore[],
  latestSignal: CandidateSignalSummary | null,
  stageReplay: StageReplayGroup[],
  passedRuns: number,
  hintRequestedCount: number,
  hintSummary: HintSummary,
  counterfactualSummary: CounterfactualSummary,
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

  if (counterfactualSummary.selfCorrectionWindows.length > 0) {
    strengths.push(
      `Debugging discipline: the candidate earned a ${counterfactualSummary.selfCorrectionWindows[0]}s self-correction window, which is strong evidence of productive debugging flow.`,
    );
  }

  if (stageReplay.some((group) => group.decisions.some((decision) => decision.action === "ask_for_complexity"))) {
    strengths.push("Interview coverage: the session progressed far enough to probe validation and final complexity signals.");
  }

  if (hintRequestedCount === 0) {
    strengths.push("Independence: the candidate did not rely on explicit hint requests.");
  } else if (hintSummary.strongestHintLevel === "LIGHT" && hintSummary.totalHintCost <= 2.5) {
    strengths.push("Guidance usage: the candidate only needed light-touch hints rather than implementation-heavy rescue.");
  }

  return strengths.slice(0, 4);
}

function collectWeaknesses(
  dimensions: DimensionScore[],
  currentStage: string,
  latestSignal: CandidateSignalSummary | null,
  hintRequestedCount: number,
  hintSummary: HintSummary,
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

  if (hintSummary.penaltyApplied > 0) {
    weaknesses.push(`Hint reliance: interviewer rescue carried a measurable cost (${hintSummary.totalHintCost.toFixed(2)} total hint cost, ${hintSummary.penaltyApplied}-point report penalty).`);
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
  hintSummary: HintSummary,
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

  if (hintSummary.byRescueMode.implementation_rescue > 0 || hintSummary.byRescueMode.debug_rescue > 0) {
    improvements.push("Practice recovering from implementation stalls with one local debugging hypothesis before asking for code-level rescue.");
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

function findLatestSignalSnapshot(
  events: SessionEventLike[],
  candidateStateSnapshots: CandidateStateSnapshotLike[] = [],
) {
  const latestSnapshot = candidateStateSnapshots.at(-1);
  if (latestSnapshot) {
    return asRecord(latestSnapshot.snapshotJson) as unknown as CandidateSignalSummary;
  }

  const latestSignalEvent = [...events]
    .reverse()
    .find((event) => event.eventType === "SIGNAL_SNAPSHOT_RECORDED");
  if (!latestSignalEvent) {
    return null;
  }

  return asRecord(asRecord(latestSignalEvent.payloadJson).signals) as unknown as CandidateSignalSummary;
}

function findLatestDecisionSnapshot(
  events: SessionEventLike[],
  interviewerDecisionSnapshots: InterviewerDecisionSnapshotLike[] = [],
) {
  const latestSnapshot = interviewerDecisionSnapshots.at(-1);
  if (latestSnapshot) {
    return asRecord(latestSnapshot.decisionJson) as unknown as CandidateDecisionSummary;
  }

  const latestDecisionEvent = [...events]
    .reverse()
    .find((event) => event.eventType === "DECISION_RECORDED");
  if (!latestDecisionEvent) {
    return null;
  }

  return asRecord(asRecord(latestDecisionEvent.payloadJson).decision) as unknown as CandidateDecisionSummary;
}

function findLatestIntentSnapshot(intentSnapshots: IntentSnapshotLike[] = []) {
  const latestSnapshot = intentSnapshots.at(-1);
  return latestSnapshot ? asRecord(latestSnapshot.intentJson) : null;
}

function findLatestTrajectorySnapshot(trajectorySnapshots: TrajectorySnapshotLike[] = []) {
  const latestSnapshot = trajectorySnapshots.at(-1);
  return latestSnapshot ? asRecord(latestSnapshot.trajectoryJson) : null;
}

function findLatestEventPayload(
  events: SessionEventLike[],
  eventType: string,
  field: string,
) {
  const latestEvent = [...events].reverse().find((event) => event.eventType === eventType);
  if (!latestEvent) {
    return null;
  }

  return asRecord(asRecord(latestEvent.payloadJson)[field]);
}

function buildShadowPolicySnapshots(events: SessionEventLike[]): ShadowPolicySnapshot[] {
  return events
    .filter((event) => event.eventType === "SHADOW_POLICY_EVALUATED")
    .slice(-8)
    .map((event) => {
      const payload = asRecord(event.payloadJson);
      const shadow = asRecord(payload.shadowPolicy);
      const scoreDiff = Array.isArray(shadow.scoreDiff)
        ? shadow.scoreDiff.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        : [];
      const top = scoreDiff
        .map((item) => ({
          action: stringValue(item.action),
          delta: typeof item.delta === "number" ? item.delta : Number.NaN,
        }))
        .filter((item) => Number.isFinite(item.delta))
        .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0];
      const diff = Array.isArray(shadow.diff)
        ? shadow.diff.filter((item): item is string => typeof item === "string")
        : [];

      return {
        at: event.eventTime ? new Date(event.eventTime).toISOString() : null,
        archetype: stringValue(shadow.archetype),
        action: stringValue(shadow.action),
        target: stringValue(shadow.target),
        diff,
        topScoreDelta: top
          ? {
              action: top.action,
              delta: Number(top.delta.toFixed(2)),
            }
          : null,
      };
    })
    .reverse();
}

function buildSnapshotTimeline(
  kind: "intent" | "trajectory",
  rows: Array<{
    stage?: string | null;
    createdAt?: Date | string;
    intentJson?: unknown;
    trajectoryJson?: unknown;
  }>,
): SnapshotTimelineEntry[] {
  return rows.map((row) => ({
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date(0).toISOString(),
    stage: row.stage ?? null,
    kind,
    payload: asRecord(kind === "intent" ? row.intentJson : row.trajectoryJson),
  }));
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
    const interviewStageLabel = describeInterviewStage(stage);
    if (interviewStageLabel) {
      return interviewStageLabel;
    }
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

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function numericValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}














function buildHintSummary(
  ledger: HintLedger,
  requested: number,
  served: number,
  latestSignal: CandidateSignalSummary | null,
): HintSummary {
  const reasoningMultiplier =
    latestSignal?.reasoningDepth === "deep"
      ? 0.65
      : latestSignal?.reasoningDepth === "moderate"
        ? 0.85
        : latestSignal?.reasoningDepth === "thin"
          ? 1.15
          : 1;
  const rescueWeight =
    ledger.byRescueMode.implementation_rescue * 0.45 +
    ledger.byRescueMode.debug_rescue * 0.6 +
    ledger.byGranularity.near_solution * 0.8;
  const penaltyApplied = Math.max(
    0,
    Math.round(Math.min(10, ledger.totalHintCost * reasoningMultiplier + rescueWeight)),
  );

  const efficiencyBase =
    100 -
    Math.round(ledger.totalHintCost * 8) -
    served * 4 -
    ledger.byInitiator.candidate_request * 8 -
    ledger.byRequestTiming.early * 7 -
    ledger.byMomentumAtHint.productive * 6 +
    ledger.byRescueMode.debug_rescue * 2;
  const efficiencyScore = Math.max(0, Math.min(100, efficiencyBase));

  const coachabilityRaw =
    70 +
    ledger.byTier.L0_NUDGE * 8 +
    ledger.byTier.L1_AREA * 5 -
    ledger.byTier.L2_SPECIFIC * 4 -
    ledger.byTier.L3_SOLUTION * 10 -
    ledger.byInitiator.candidate_request * 6 +
    ledger.byRescueMode.implementation_rescue * 2;
  const coachabilityScore = Math.max(0, Math.min(100, coachabilityRaw));
  const coachabilityLabel =
    coachabilityScore >= 75 ? "high" : coachabilityScore >= 50 ? "moderate" : "low";
  const coachabilityRationale =
    coachabilityLabel === "high"
      ? "The candidate tended to respond well to light-touch guidance instead of needing hand-held rescue."
      : coachabilityLabel === "moderate"
        ? "The candidate responded to guidance, but needed more than one layer of scaffolding to regain momentum."
        : "The candidate often needed specific or near-solution rescue before progress resumed.";

  return {
    ...ledger,
    requested,
    served,
    penaltyApplied,
    efficiencyScore,
    coachability: {
      score: coachabilityScore,
      label: coachabilityLabel,
      rationale: coachabilityRationale,
    },
  };
}

function buildSystemDesignDna(input: {
  latestSignal: CandidateSignalSummary | null;
  latestSignalSnapshotId: string | null;
  events: SessionEventLike[];
  transcripts: TranscriptLike[];
}): SystemDesignDna {
  const signalValues = asRecord(input.latestSignal?.designSignals?.signals);
  const refs = asRecord(input.latestSignal?.designSignals?.evidenceRefs);
  const turnPins = buildDesignEvidenceTurnPins(input.events);
  const scoreByMissing = (missing: unknown) => {
    if (missing === false) {
      return 4.5;
    }
    if (missing === true) {
      return 2;
    }
    // Unknown / no evidence should never be treated as "pass".
    return 0.5;
  };

  const requirementScore = scoreByMissing(signalValues.requirement_missing);
  const capacityScore = scoreByMissing(signalValues.capacity_missing);
  const tradeoffScore = scoreByMissing(signalValues.tradeoff_missed);
  const reliabilityScore = scoreByMissing(signalValues.spof_missed);
  const bottleneckScore = scoreByMissing(signalValues.bottleneck_unexamined);
  const avgScore = (requirementScore + capacityScore + tradeoffScore + reliabilityScore + bottleneckScore) / 5;
  const pivotSummary = summarizeSystemDesignPivot(input.events);

  const baseLevelRecommendation: SystemDesignDna["levelRecommendation"] =
    avgScore >= 4.2 ? "Staff" : avgScore >= 3.4 ? "Senior" : "Mid-level";
  const levelCapResult = applySystemDesignLevelCap({
    baseLevel: baseLevelRecommendation,
    tradeoffScore,
    capacityScore,
    reliabilityScore,
    bottleneckScore,
    pivotSummary,
  });
  const levelRecommendation = levelCapResult.level;

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (requirementScore >= 4) {
    strengths.push("Requirement framing stayed clear with functional scope and non-functional constraints.");
  } else {
    weaknesses.push("Requirement clarity is incomplete; functional boundaries or non-functional constraints are still thin.");
  }
  if (capacityScore >= 4) {
    strengths.push("Capacity instinct is solid; estimates were connected to architecture decisions.");
  } else {
    weaknesses.push("Capacity reasoning needs stronger QPS/data-volume estimates linked to design choices.");
  }
  if (tradeoffScore >= 4) {
    strengths.push("Tradeoff depth is strong; alternatives and pros/cons were discussed explicitly.");
  } else {
    weaknesses.push("Tradeoff analysis stayed shallow; compare at least two options with concrete pros/cons.");
  }
  if (reliabilityScore >= 4) {
    strengths.push("Reliability awareness is visible through SPOF identification and mitigation discussion.");
  } else {
    weaknesses.push("Reliability awareness is incomplete; SPOF risks or failover strategy need explicit coverage.");
  }
  if (bottleneckScore >= 4) {
    strengths.push("Bottleneck sensitivity is good; likely hotspots and optimization paths were examined.");
  } else {
    weaknesses.push("Bottleneck analysis is limited; identify likely hotspots and mitigation plans.");
  }

  const asStringArray = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  return {
    requirement_clarity: Number(requirementScore.toFixed(2)),
    capacity_instinct: Number(capacityScore.toFixed(2)),
    tradeoff_depth: Number(tradeoffScore.toFixed(2)),
    reliability_awareness: Number(reliabilityScore.toFixed(2)),
    bottleneck_sensitivity: Number(bottleneckScore.toFixed(2)),
    levelRecommendation,
    calibrationNotes: levelCapResult.notes,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    evidencePins: [
      {
        dimension: "requirement_clarity",
        score: Number(requirementScore.toFixed(2)),
        snapshotId: input.latestSignalSnapshotId,
        turnIds: turnPins.requirement,
        evidenceRefs: asStringArray(refs.requirement_missing),
        textPointers: buildTextPointers({
          evidenceRefs: asStringArray(refs.requirement_missing),
          turnIds: turnPins.requirement,
          transcripts: input.transcripts,
        }),
      },
      {
        dimension: "capacity_instinct",
        score: Number(capacityScore.toFixed(2)),
        snapshotId: input.latestSignalSnapshotId,
        turnIds: turnPins.capacity,
        evidenceRefs: asStringArray(refs.capacity_missing),
        textPointers: buildTextPointers({
          evidenceRefs: asStringArray(refs.capacity_missing),
          turnIds: turnPins.capacity,
          transcripts: input.transcripts,
        }),
      },
      {
        dimension: "tradeoff_depth",
        score: Number(tradeoffScore.toFixed(2)),
        snapshotId: input.latestSignalSnapshotId,
        turnIds: turnPins.tradeoff,
        evidenceRefs: asStringArray(refs.tradeoff_missed),
        textPointers: buildTextPointers({
          evidenceRefs: asStringArray(refs.tradeoff_missed),
          turnIds: turnPins.tradeoff,
          transcripts: input.transcripts,
        }),
      },
      {
        dimension: "reliability_awareness",
        score: Number(reliabilityScore.toFixed(2)),
        snapshotId: input.latestSignalSnapshotId,
        turnIds: turnPins.spof,
        evidenceRefs: asStringArray(refs.spof_missed),
        textPointers: buildTextPointers({
          evidenceRefs: asStringArray(refs.spof_missed),
          turnIds: turnPins.spof,
          transcripts: input.transcripts,
        }),
      },
      {
        dimension: "bottleneck_sensitivity",
        score: Number(bottleneckScore.toFixed(2)),
        snapshotId: input.latestSignalSnapshotId,
        turnIds: turnPins.bottleneck,
        evidenceRefs: asStringArray(refs.bottleneck_unexamined),
        textPointers: buildTextPointers({
          evidenceRefs: asStringArray(refs.bottleneck_unexamined),
          turnIds: turnPins.bottleneck,
          transcripts: input.transcripts,
        }),
      },
    ],
  };
}

function applySystemDesignLevelCap(input: {
  baseLevel: SystemDesignDna["levelRecommendation"];
  tradeoffScore: number;
  capacityScore: number;
  reliabilityScore: number;
  bottleneckScore: number;
  pivotSummary: {
    count: number;
    averageImpact: number;
  };
}) {
  const notes: string[] = [];
  let level = input.baseLevel;
  const tradeoffWeak = input.tradeoffScore < 4;
  const capacityWeak = input.capacityScore < 4;
  const reliabilityWeak = input.reliabilityScore < 4;
  const bottleneckWeak = input.bottleneckScore < 4;

  if (tradeoffWeak) {
    notes.push("Calibration guard: tradeoff depth is below strong-level threshold.");
  }
  if (capacityWeak) {
    notes.push("Calibration guard: capacity instinct is below strong-level threshold.");
  }

  if (input.baseLevel === "Staff" && tradeoffWeak) {
    level = "Senior";
    notes.push("Staff-level cap applied: tradeoff depth signal is below the required threshold.");
  }
  if (level === "Staff" && capacityWeak) {
    level = "Senior";
    notes.push("Staff-level cap applied: capacity instinct signal is below the required threshold.");
  }

  if (input.capacityScore >= 4 && (reliabilityWeak || bottleneckWeak)) {
    notes.push("Cross-stage consistency: strong capacity estimate must be backed by reliability and bottleneck depth.");
    if (level === "Staff") {
      level = "Senior";
      notes.push("Cross-stage cap applied: deep-dive evidence is not yet consistent with stated scale assumptions.");
    } else if (level === "Senior" && input.reliabilityScore < 3.5 && input.bottleneckScore < 3.5) {
      level = "Mid-level";
      notes.push("Cross-stage cap applied: reliability and bottleneck analysis stayed too shallow for senior recommendation.");
    }
  }

  const pivotStrong = input.pivotSummary.count >= 2 && input.pivotSummary.averageImpact >= 0.35;
  if (pivotStrong && level === "Mid-level" && !tradeoffWeak && !capacityWeak) {
    level = "Senior";
    notes.push("Pivot boost applied: sustained hint-to-insight conversion improved level recommendation within guardrails.");
  }

  return {
    level,
    notes,
  };
}

function summarizeSystemDesignPivot(events: SessionEventLike[]) {
  const impacts: number[] = [];
  for (const event of events) {
    if (event.eventType !== "REWARD_RECORDED") {
      continue;
    }
    const payload = asRecord(event.payloadJson);
    const reward = asRecord(payload.reward);
    const tags = Array.isArray(reward.noiseTags)
      ? reward.noiseTags.filter((item): item is string => typeof item === "string")
      : [];
    if (tags.length > 0) {
      continue;
    }
    const components = asRecord(reward.components);
    const impact = numberValue(components.pivotImpact);
    if (impact > 0) {
      impacts.push(impact);
    }
  }

  if (impacts.length === 0) {
    return {
      count: 0,
      averageImpact: 0,
    };
  }

  const sum = impacts.reduce((acc, value) => acc + value, 0);
  return {
    count: impacts.length,
    averageImpact: Number((sum / impacts.length).toFixed(2)),
  };
}

function buildTextPointers(input: {
  evidenceRefs: string[];
  turnIds: string[];
  transcripts: TranscriptLike[];
}) {
  const pointers: Array<{
    turnId: string;
    start: number;
    length: number;
    excerpt: string;
  }> = [];
  const bySpeaker: Record<"USER" | "AI" | "SYSTEM", TranscriptLike[]> = {
    USER: [],
    AI: [],
    SYSTEM: [],
  };
  for (const transcript of input.transcripts) {
    bySpeaker[transcript.speaker].push(transcript);
  }

  for (const ref of input.evidenceRefs) {
    const parsed = parseEvidenceTurnRef(ref);
    if (!parsed) {
      continue;
    }
    const transcript = bySpeaker[parsed.speaker][parsed.index - 1];
    if (!transcript) {
      continue;
    }
    const fallbackLength = Math.min(transcript.text.length, 80);
    const snippetLower = parsed.snippet.toLowerCase();
    const textLower = transcript.text.toLowerCase();
    const snippetStart = snippetLower.length > 0 ? textLower.indexOf(snippetLower) : -1;
    const start = snippetStart >= 0 ? snippetStart : 0;
    const length = snippetStart >= 0 ? parsed.snippet.length : fallbackLength;
    const excerpt = transcript.text.slice(start, Math.min(transcript.text.length, start + Math.max(length, 1)));
    pointers.push({
      turnId: `${parsed.speaker}#${parsed.index}`,
      start,
      length: Math.max(1, Math.min(length, transcript.text.length - start)),
      excerpt: excerpt || transcript.text.slice(0, fallbackLength),
    });
  }

  if (pointers.length > 0) {
    return pointers;
  }

  return input.turnIds.slice(0, 2).map((turnId) => ({
    turnId,
    start: 0,
    length: 0,
    excerpt: "",
  }));
}

function parseEvidenceTurnRef(ref: string): { speaker: "USER" | "AI" | "SYSTEM"; index: number; snippet: string } | null {
  const match = /^(USER|AI|SYSTEM)#(\d+)\s*:\s*(.+)$/i.exec(ref.trim());
  if (!match) {
    return null;
  }
  const speaker = match[1]?.toUpperCase();
  const index = Number(match[2]);
  const snippet = match[3]?.trim() ?? "";
  if ((speaker !== "USER" && speaker !== "AI" && speaker !== "SYSTEM") || !Number.isFinite(index) || index < 1) {
    return null;
  }
  return {
    speaker,
    index,
    snippet,
  };
}

function buildDesignEvidenceTurnPins(events: SessionEventLike[]) {
  const byType: Record<"requirement" | "capacity" | "tradeoff" | "spof" | "bottleneck", Set<string>> = {
    requirement: new Set<string>(),
    capacity: new Set<string>(),
    tradeoff: new Set<string>(),
    spof: new Set<string>(),
    bottleneck: new Set<string>(),
  };

  for (const event of events) {
    if (event.eventType !== "REWARD_RECORDED") {
      continue;
    }
    const payload = asRecord(event.payloadJson);
    const trace = asRecord(payload.trace);
    const reward = asRecord(payload.reward);
    const turnId = stringValue(trace.transcriptSegmentId);
    if (!turnId) {
      continue;
    }
    const types = Array.isArray(reward.designEvidenceTypes)
      ? reward.designEvidenceTypes.filter((item): item is string => typeof item === "string")
      : [];
    for (const type of types) {
      if (type === "requirement" || type === "capacity" || type === "tradeoff" || type === "spof" || type === "bottleneck") {
        byType[type].add(turnId);
      }
    }
  }

  return {
    requirement: [...byType.requirement],
    capacity: [...byType.capacity],
    tradeoff: [...byType.tradeoff],
    spof: [...byType.spof],
    bottleneck: [...byType.bottleneck],
  };
}

function buildWhiteboardWeakSignalObservability(
  events: SessionEventLike[],
): WhiteboardWeakSignalObservability {
  const signals = events
    .filter((event) => event.eventType === "WHITEBOARD_SIGNAL_RECORDED")
    .map((event) => {
      const payload = asRecord(event.payloadJson);
      const weak = asRecord(payload.whiteboardSignal);
      return {
        stage: stringValue(payload.stage) ?? "UNKNOWN",
        componentCount: numericValue(weak.component_count) ?? 0,
        connectionCount: numericValue(weak.connection_count) ?? 0,
        elementCount: numericValue(weak.element_count) ?? 0,
        at: asIsoString(event.eventTime),
      };
    });

  const trendMap = new Map<
    string,
    { components: number[]; connections: number[]; elements: number[] }
  >();
  for (const signal of signals) {
    const row = trendMap.get(signal.stage) ?? { components: [], connections: [], elements: [] };
    row.components.push(signal.componentCount);
    row.connections.push(signal.connectionCount);
    row.elements.push(signal.elementCount);
    trendMap.set(signal.stage, row);
  }

  const stageTrend = [...trendMap.entries()].map(([stage, values]) => ({
    stage,
    samples: values.components.length,
    avgComponentCount: avg(values.components),
    avgConnectionCount: avg(values.connections),
    avgElementCount: avg(values.elements),
    maxComponentCount: values.components.length > 0 ? Math.max(...values.components) : 0,
    maxConnectionCount: values.connections.length > 0 ? Math.max(...values.connections) : 0,
    maxElementCount: values.elements.length > 0 ? Math.max(...values.elements) : 0,
  }));

  const rewardTotals = events
    .filter((event) => event.eventType === "REWARD_RECORDED")
    .map((event) => {
      const payload = asRecord(event.payloadJson);
      const reward = asRecord(payload.reward);
      return numericValue(reward.total);
    })
    .filter((value): value is number => typeof value === "number");
  const complexitySeries = signals.map((signal) => signal.componentCount + signal.connectionCount);
  const samplePairs = Math.min(complexitySeries.length, rewardTotals.length);
  const complexityToRewardPearson =
    samplePairs >= 2
      ? pearson(complexitySeries.slice(-samplePairs), rewardTotals.slice(-samplePairs))
      : null;

  const qualityCorrelationNote =
    samplePairs < 2
      ? "Not enough paired whiteboard/reward samples to estimate correlation."
      : complexityToRewardPearson === null
      ? "Correlation is undefined because one series has near-zero variance."
      : `Pearson correlation between whiteboard complexity and reward totals is ${complexityToRewardPearson.toFixed(2)} over ${samplePairs} paired turns.`;

  return {
    auxiliaryOnly: true,
    excludedFromDecision: true,
    totalSignals: signals.length,
    latest: signals.at(-1) ?? null,
    stageTrend,
    qualityCorrelation: {
      samplePairs,
      complexityToRewardPearson,
      note: qualityCorrelationNote,
    },
  };
}

function avg(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function pearson(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) {
    return null;
  }
  const leftAvg = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightAvg = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const deltaLeft = left[index] - leftAvg;
    const deltaRight = right[index] - rightAvg;
    numerator += deltaLeft * deltaRight;
    leftVariance += deltaLeft * deltaLeft;
    rightVariance += deltaRight * deltaRight;
  }
  if (leftVariance <= 1e-9 || rightVariance <= 1e-9) {
    return null;
  }
  return Number((numerator / Math.sqrt(leftVariance * rightVariance)).toFixed(4));
}

function asIsoString(value: Date | string | undefined) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return value.toISOString();
}

function buildEvidenceTrace(input: {
  events: SessionEventLike[];
  dimensions: DimensionScore[];
  latestSignal: CandidateSignalSummary | null;
  stageReplay: StageReplayGroup[];
  hintSummary: HintSummary;
  counterfactualSummary: CounterfactualSummary;
}) {
  const timelineEvidence = input.events
    .filter((event) =>
      ["STAGE_ADVANCED", "HINT_SERVED", "CODE_RUN_COMPLETED", "DECISION_RECORDED", "REWARD_RECORDED"].includes(
        event.eventType,
      ),
    )
    .slice(-8)
    .map((event) => buildEvidencePoint(event));

  const traces: EvidenceTraceItem[] = input.dimensions.map((dimension) => ({
    claim: dimension.issue ?? `${dimension.label} was evaluated in this session.`,
    category: dimension.label,
    evidencePoints: [dimension.evidence, ...timelineEvidence.slice(0, 2)].filter(Boolean),
    impact: dimension.impact,
    improvement: dimension.improvement,
    confidence: input.latestSignal?.confidence,
    verdict:
      dimension.score >= dimension.maxScore - 1 ? "strong" : dimension.score <= Math.ceil(dimension.maxScore / 2) ? "weak" : "mixed",
  }));

  if (input.latestSignal?.structuredEvidence?.length) {
    for (const item of input.latestSignal.structuredEvidence.slice(0, 3)) {
      traces.push({
        claim: item.issue ?? "Observed candidate issue",
        category: prettifyArea(item.area ?? "issue"),
        evidencePoints: [item.evidence ?? item.behavior ?? "Observed through candidate state extraction."],
        impact: item.impact,
        improvement: item.fix ? [item.fix] : undefined,
        confidence: input.latestSignal?.confidence,
      verdict: "mixed",
      });
    }
  }

  if (input.counterfactualSummary.autoCapturedEvidence.length > 0) {
    traces.push({
      claim: "Some evaluation evidence was captured without needing an extra interviewer interruption.",
      category: "Counterfactual",
      evidencePoints: input.counterfactualSummary.autoCapturedEvidence.map((item) => `Auto-captured evidence: ${item}.`),
      impact: "This improved naturalness by letting the candidate surface evidence unprompted.",
      improvement: ["Keep narrating complexity, tests, and local debugging observations as you work."],
      confidence: input.latestSignal?.confidence,
      verdict: "mixed",
    });
  }

  if (input.counterfactualSummary.selfCorrectionWindows.length > 0) {
    traces.push({
      claim: "The candidate showed evidence of self-correction instead of needing immediate debugging intervention.",
      category: "Debugging",
      evidencePoints: input.counterfactualSummary.selfCorrectionWindows.map((seconds) => `A ${seconds}s self-correction window was granted before intervention.`),
      impact: "This is positive evidence for debugging discipline and productive debugging flow.",
      improvement: ["When you notice a bug, narrate the first hypothesis and check one tiny reproducer before asking for rescue."],
      confidence: input.latestSignal?.confidence,
      verdict: "mixed",
    });
  }

  if (input.hintSummary.penaltyApplied > 0) {
    traces.push({
      claim: "Interviewer rescue affected the independence signal.",
      category: "Hinting",
      evidencePoints: [
        `Hints served: ${input.hintSummary.served}.`, `Efficiency score: ${input.hintSummary.efficiencyScore}.`, `Coachability: ${input.hintSummary.coachability.label}.`,
        `Total hint cost: ${input.hintSummary.totalHintCost.toFixed(2)}.`,
        `Strongest hint level: ${input.hintSummary.strongestHintLevel ?? "none"}.`,
      ],
      impact: `Applied a ${input.hintSummary.penaltyApplied}-point report penalty to reflect how much rescue was needed.`,
      improvement: ["Try one concrete example or local debugging hypothesis before asking for another hint."],
      confidence: input.latestSignal?.confidence,
      verdict: "mixed",
    });
  }

  return traces.slice(0, 10);
}

function buildEvidencePoint(event: SessionEventLike) {
  const payload = asRecord(event.payloadJson);
  const time = event.eventTime ? formatEvidenceTime(event.eventTime) : null;
  const prefix = time ? `[${time}] ` : "";

  if (event.eventType === "STAGE_ADVANCED") {
    return `${prefix}Stage advanced to ${describeCodingStageSafe(stringValue(payload.stage) ?? "unknown")}.`;
  }
  if (event.eventType === "CODE_RUN_COMPLETED") {
    return `${prefix}Code run finished with ${stringValue(payload.status) ?? "unknown"}.`;
  }
  if (event.eventType === "HINT_SERVED") {
    return `${prefix}Hint served: ${(stringValue(payload.hintLevel) ?? "LIGHT").toLowerCase()} ${stringValue(payload.hintStyle)?.replaceAll("_", " ").toLowerCase() ?? "hint"}.`;
  }
  if (event.eventType === "DECISION_RECORDED") {
    const decision = asRecord(payload.decision);
    return `${prefix}Interviewer targeted ${stringValue(decision.target) ?? "unknown"} with ${stringValue(decision.action) ?? "unknown action"}.`;
  }
  if (event.eventType === "REWARD_RECORDED") {
    const reward = asRecord(payload.reward);
    const total = typeof reward.total === "number" ? reward.total.toFixed(2) : "n/a";
    return `${prefix}Reward v1 scored this turn at ${total}.`;
  }

  return `${prefix}${event.eventType.toLowerCase().replaceAll("_", " ")}.`;
}

function formatEvidenceTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(11, 19);
}


function buildCounterfactualSummary(events: SessionEventLike[]): CounterfactualSummary {
  const criticEvents = events
    .filter((event) => event.eventType === "CRITIC_VERDICT_RECORDED")
    .map((event) => asRecord(asRecord(event.payloadJson).criticVerdict));

  const autoCapturedEvidence = [...new Set(
    criticEvents.flatMap((verdict) =>
      Array.isArray(verdict.autoCapturedEvidence)
        ? verdict.autoCapturedEvidence.filter((item): item is string => typeof item === "string")
        : [],
    ),
  )];

  const selfCorrectionWindows = criticEvents.flatMap((verdict) =>
    typeof verdict.selfCorrectionWindowSeconds === "number" ? [verdict.selfCorrectionWindowSeconds] : [],
  );

  return {
    autoCapturedEvidence,
    selfCorrectionWindows,
    wouldLikelySelfCorrect: criticEvents.some((verdict) => verdict.wouldLikelySelfCorrect === true),
    shouldWaitBeforeIntervening: criticEvents.some((verdict) => verdict.shouldWaitBeforeIntervening === true),
  };
}













































