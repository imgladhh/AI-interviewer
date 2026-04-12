import { makeCandidateDecision, type CandidateDecision } from "@/lib/assistant/decision_engine";
import { getPolicyPreset, type PolicyArchetype } from "@/lib/assistant/policy-config";
import { evaluateTurnReward } from "@/lib/assistant/reward";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import { makeSystemDesignDecision } from "@/lib/assistant/system_design_decision";
import type { CodingInterviewPolicy } from "@/lib/assistant/policy";
import type { CodingInterviewStage, SystemDesignStage } from "@/lib/assistant/stages";

export type PolicyRegressionScenarioId =
  | "strong_precode"
  | "stuck_debugging"
  | "saturated_wrapup"
  | "flow_preservation"
  | "answered_target_guard"
  | "echo_recovery"
  | "idle_stall_probe_boost"
  | "wrap_up_irreversible"
  | "overconfident_wrong_answer"
  | "perfect_flow";

export type PolicyRegressionScenario = {
  id: PolicyRegressionScenarioId;
  label: string;
  currentStage: CodingInterviewStage;
  policy: CodingInterviewPolicy;
  signals: CandidateSignalSnapshot;
  recentEvents?: Array<{ eventType: string; eventTime?: Date | string; payloadJson?: unknown }>;
  latestExecutionRun?: {
    status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
    stdout?: string | null;
    stderr?: string | null;
  } | null;
};

export type PolicyRegressionResult = {
  scenarioId: PolicyRegressionScenarioId;
  archetype: PolicyArchetype;
  action: CandidateDecision["action"];
  normalizedAction?: CandidateDecision["normalizedAction"];
  target: CandidateDecision["target"];
  totalScore?: number;
  scoreGapFromBest?: number;
  averageReward?: number;
  cumulativeReward?: number;
  rewardGapFromBest?: number;
  pressure?: CandidateDecision["pressure"];
  timing?: CandidateDecision["timing"];
  suggestedStage?: CandidateDecision["suggestedStage"];
  scoreWeightProfile?: CandidateDecision["scoreWeightProfile"];
  decisionTimeline: Array<{
    turn: number;
    action: CandidateDecision["action"];
    target: CandidateDecision["target"];
    normalizedAction?: CandidateDecision["normalizedAction"];
    totalScore?: number;
    rewardTotal?: number;
    rewardPenalties: string[];
  }>;
  decisionPathway?: string[];
  reason: string;
};

export type PolicyRegressionScenarioReport = {
  scenarioId: PolicyRegressionScenarioId;
  label: string;
  results: PolicyRegressionResult[];
  divergentFields: Array<"action" | "target" | "pressure" | "timing" | "suggestedStage">;
  scoreSpread: {
    maxTotalScore: number;
    minTotalScore: number;
    spread: number;
    bestArchetype: PolicyArchetype;
    weakestArchetype: PolicyArchetype;
  } | null;
  rewardSpread: {
    maxAverageReward: number;
    minAverageReward: number;
    spread: number;
    bestArchetype: PolicyArchetype;
    weakestArchetype: PolicyArchetype;
  } | null;
  summary: string;
};

export type PolicyTuningSuggestion = {
  id: string;
  title: string;
  rationale: string;
  recommendedAdjustments: string[];
};

export type SystemDesignRegressionScenarioId =
  | "no_estimation_candidate"
  | "handwave_candidate"
  | "strong_tradeoff_candidate";

export type SystemDesignRegressionScenario = {
  id: SystemDesignRegressionScenarioId;
  label: string;
  currentStage: SystemDesignStage;
  signals: CandidateSignalSnapshot;
  recentEvents?: Array<{ eventType: string; eventTime?: Date | string; payloadJson?: unknown }>;
};

export type SystemDesignRegressionResult = {
  scenarioId: SystemDesignRegressionScenarioId;
  label: string;
  decisionTimeline: Array<{
    turn: number;
    action: CandidateDecision["action"];
    target: CandidateDecision["target"];
    systemDesignActionType: string;
    totalScore?: number;
    rewardTotal: number;
    rewardPenalties: string[];
  }>;
  totalScore: number;
  averageReward: number;
  cumulativeReward: number;
};

export type SystemDesignRegressionReport = {
  scenarioId: SystemDesignRegressionScenarioId;
  label: string;
  result: SystemDesignRegressionResult;
  scoreDiffFromBest: number;
  rewardDiffFromBest: number;
};

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "partial",
  algorithmChoice: "reasonable",
  edgeCaseAwareness: "partial",
  behavior: "structured",
  readyToCode: false,
  reasoningDepth: "moderate",
  testingDiscipline: "partial",
  complexityRigor: "partial",
  confidence: 0.76,
  evidence: ["Candidate explained the approach clearly."],
  structuredEvidence: [],
  summary: "Understanding is clear and progress is progressing.",
  trendSummary: "Candidate state is broadly stable relative to the previous snapshot.",
};

const baseSystemDesignSignals: CandidateSignalSnapshot = {
  ...baseSignals,
  summary: "System design candidate snapshot",
  designSignals: {
    signals: {
      requirement_missing: false,
      capacity_missing: false,
      tradeoff_missed: false,
      spof_missed: false,
      bottleneck_unexamined: false,
    },
    evidenceRefs: {
      requirement_missing: [],
      capacity_missing: [],
      tradeoff_missed: [],
      spof_missed: [],
      bottleneck_unexamined: [],
    },
    summary: "design signals baseline",
  },
};

const basePolicy: CodingInterviewPolicy = {
  currentStage: "IMPLEMENTATION",
  recommendedAction: "LET_IMPLEMENT",
  shouldServeHint: false,
  nextStage: "IMPLEMENTATION",
  stageExitSatisfied: false,
  exitCriteria: ["Keep coding"],
  checklist: [],
  promptStrategy: "GUIDED",
  reason: "Continue implementation.",
};

export const POLICY_REGRESSION_SCENARIOS: PolicyRegressionScenario[] = [
  {
    id: "strong_precode",
    label: "Strong candidate ready to code",
    currentStage: "APPROACH_DISCUSSION",
    policy: {
      ...basePolicy,
      currentStage: "APPROACH_DISCUSSION",
      nextStage: "APPROACH_DISCUSSION",
      recommendedAction: "PROBE_APPROACH",
      reason: "Probe the approach before implementation.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: false,
    },
    signals: {
      ...baseSignals,
      readyToCode: true,
      algorithmChoice: "strong",
      complexityRigor: "missing",
      testingDiscipline: "partial",
      edgeCaseAwareness: "present",
      reasoningDepth: "deep",
    },
  },
  {
    id: "stuck_debugging",
    label: "Candidate stuck in debugging with repeated failures",
    currentStage: "IMPLEMENTATION",
    policy: basePolicy,
    signals: {
      ...baseSignals,
      progress: "stuck",
      codeQuality: "buggy",
      confidence: 0.42,
    },
    recentEvents: [
      { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "FAILED" } },
      { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "ERROR" } },
    ],
    latestExecutionRun: { status: "ERROR", stderr: "IndexError: list index out of range" },
  },
  {
    id: "saturated_wrapup",
    label: "Evidence already saturated during wrap-up",
    currentStage: "WRAP_UP",
    policy: {
      ...basePolicy,
      currentStage: "WRAP_UP",
      nextStage: "WRAP_UP",
      recommendedAction: "WRAP_UP",
      reason: "Close the interview cleanly.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: true,
    },
    signals: {
      ...baseSignals,
      progress: "done",
      codeQuality: "correct",
      algorithmChoice: "strong",
      testingDiscipline: "strong",
      complexityRigor: "strong",
      readyToCode: false,
      confidence: 0.91,
      summary: "The candidate has already closed the loop on implementation, testing, and complexity.",
    },
    recentEvents: [
      { eventType: "ANSWERED_TARGET_RECORDED", payloadJson: { target: "testing" } },
      { eventType: "ANSWERED_TARGET_RECORDED", payloadJson: { target: "complexity" } },
      { eventType: "ANSWERED_TARGET_RECORDED", payloadJson: { target: "summary" } },
    ],
    latestExecutionRun: { status: "PASSED", stdout: "ok" },
  },
  {
    id: "flow_preservation",
    label: "Strong coding flow should not be interrupted",
    currentStage: "IMPLEMENTATION",
    policy: {
      ...basePolicy,
      currentStage: "IMPLEMENTATION",
      nextStage: "IMPLEMENTATION",
      recommendedAction: "PROBE_APPROACH",
      reason: "Probe tradeoffs while the candidate codes.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: false,
    },
    signals: {
      ...baseSignals,
      readyToCode: true,
      progress: "progressing",
      communication: "clear",
      algorithmChoice: "strong",
      codeQuality: "partial",
      complexityRigor: "partial",
      testingDiscipline: "partial",
      confidence: 0.88,
      summary: "The candidate is coding steadily and explaining the implementation clearly.",
    },
    recentEvents: [
      { eventType: "CANDIDATE_SPOKE", payloadJson: { text: "I am updating the hashmap as I go." } },
      { eventType: "CANDIDATE_SPOKE", payloadJson: { text: "Now I am checking the complement before insert." } },
      { eventType: "SIGNAL_SNAPSHOT_RECORDED", payloadJson: { signals: { readyToCode: true, progress: "progressing" } } },
    ],
  },
  {
    id: "answered_target_guard",
    label: "Answered-target guard blocks repeated probing",
    currentStage: "TESTING_AND_COMPLEXITY",
    policy: {
      ...basePolicy,
      currentStage: "TESTING_AND_COMPLEXITY",
      nextStage: "TESTING_AND_COMPLEXITY",
      recommendedAction: "VALIDATE_AND_TEST",
      reason: "Collect explicit testing evidence.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: false,
    },
    signals: {
      ...baseSignals,
      progress: "progressing",
      codeQuality: "correct",
      edgeCaseAwareness: "present",
      testingDiscipline: "strong",
      complexityRigor: "strong",
      confidence: 0.9,
      summary: "The candidate already provided concrete edge cases and exact outputs.",
    },
    recentEvents: [
      { eventType: "ANSWERED_TARGET_RECORDED", payloadJson: { target: "testing" } },
      { eventType: "ANSWERED_TARGET_RECORDED", payloadJson: { target: "edge_case" } },
      { eventType: "COLLECTED_EVIDENCE_RECORDED", payloadJson: { evidence: "test_cases" } },
    ],
    latestExecutionRun: { status: "PASSED", stdout: "ok" },
  },
  {
    id: "echo_recovery",
    label: "Candidate echoes interviewer prompt and should be forced into constrained format",
    currentStage: "APPROACH_DISCUSSION",
    policy: {
      ...basePolicy,
      currentStage: "APPROACH_DISCUSSION",
      nextStage: "APPROACH_DISCUSSION",
      recommendedAction: "PROBE_APPROACH",
      reason: "Collect direct reasoning evidence.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: false,
    },
    signals: {
      ...baseSignals,
      communication: "mixed",
      reasoningDepth: "thin",
      echoLikely: true,
      echoStrength: "high",
      echoOverlapRatio: 0.92,
      summary: "Latest candidate turn appears to echo the interviewer wording instead of answering directly.",
    },
    recentEvents: [
      { eventType: "CANDIDATE_ECHO_DETECTED", payloadJson: { echoStrength: "high", echoOverlapRatio: 0.92 } },
    ],
  },
  {
    id: "idle_stall_probe_boost",
    label: "Idle and stalled trajectory should increase probe value",
    currentStage: "APPROACH_DISCUSSION",
    policy: {
      ...basePolicy,
      currentStage: "APPROACH_DISCUSSION",
      nextStage: "APPROACH_DISCUSSION",
      recommendedAction: "PROBE_APPROACH",
      reason: "Collect missing reasoning evidence after idle window.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: false,
    },
    signals: {
      ...baseSignals,
      progress: "stuck",
      reasoningDepth: "thin",
      confidence: 0.58,
    },
    recentEvents: [
      { eventType: "CANDIDATE_SPOKE", eventTime: "2026-04-10T12:00:00.000Z", payloadJson: { text: "not sure" } },
      { eventType: "AI_SPOKE", eventTime: "2026-04-10T12:02:20.000Z", payloadJson: { source: "fallback" } },
      { eventType: "DECISION_RECORDED", eventTime: "2026-04-10T12:02:30.000Z", payloadJson: { decision: { action: "ask_for_clarification", target: "reasoning" } } },
    ],
  },
  {
    id: "wrap_up_irreversible",
    label: "Wrap-up should not reopen with advance/probe families",
    currentStage: "WRAP_UP",
    policy: {
      ...basePolicy,
      currentStage: "WRAP_UP",
      nextStage: "WRAP_UP",
      recommendedAction: "WRAP_UP",
      reason: "Close cleanly.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: true,
    },
    signals: {
      ...baseSignals,
      progress: "done",
      codeQuality: "correct",
      testingDiscipline: "strong",
      complexityRigor: "strong",
      confidence: 0.9,
    },
    recentEvents: [
      { eventType: "DECISION_RECORDED", payloadJson: { decision: { action: "move_to_wrap_up", target: "summary" } } },
    ],
    latestExecutionRun: { status: "PASSED", stdout: "ok" },
  },
  {
    id: "overconfident_wrong_answer",
    label: "Overconfident wrong answer should trigger correctness pressure",
    currentStage: "IMPLEMENTATION",
    policy: {
      ...basePolicy,
      currentStage: "IMPLEMENTATION",
      nextStage: "DEBUGGING",
      recommendedAction: "LET_IMPLEMENT",
      reason: "Implementation exists, but correctness evidence is weak.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: false,
    },
    signals: {
      ...baseSignals,
      progress: "stuck",
      communication: "clear",
      reasoningDepth: "thin",
      confidence: 0.92,
      codeQuality: "buggy",
      edgeCaseAwareness: "missing",
      summary: "Candidate sounds confident, but the implementation is producing wrong answers on boundary inputs.",
    },
    recentEvents: [
      { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "FAILED", stderr: "wrong answer on boundary case" } },
      { eventType: "CANDIDATE_SPOKE", payloadJson: { text: "I am pretty sure this is correct." } },
    ],
    latestExecutionRun: { status: "FAILED", stderr: "wrong answer on [0,0,1] input" },
  },
  {
    id: "perfect_flow",
    label: "Perfect flow should preserve momentum and close cleanly",
    currentStage: "TESTING_AND_COMPLEXITY",
    policy: {
      ...basePolicy,
      currentStage: "TESTING_AND_COMPLEXITY",
      nextStage: "WRAP_UP",
      recommendedAction: "VALIDATE_AND_TEST",
      reason: "Candidate is in strong closure flow.",
      promptStrategy: "GUIDED",
      stageExitSatisfied: true,
    },
    signals: {
      ...baseSignals,
      progress: "done",
      communication: "clear",
      codeQuality: "correct",
      algorithmChoice: "strong",
      edgeCaseAwareness: "present",
      testingDiscipline: "strong",
      complexityRigor: "strong",
      confidence: 0.95,
      summary: "Candidate provided complete implementation, tests, and complexity with clean communication.",
    },
    recentEvents: [
      { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "PASSED" } },
      { eventType: "ANSWERED_TARGET_RECORDED", payloadJson: { target: "testing" } },
      { eventType: "ANSWERED_TARGET_RECORDED", payloadJson: { target: "complexity" } },
    ],
    latestExecutionRun: { status: "PASSED", stdout: "ok" },
  },
];

export const SYSTEM_DESIGN_REGRESSION_SCENARIOS: SystemDesignRegressionScenario[] = [
  {
    id: "no_estimation_candidate",
    label: "No estimation candidate",
    currentStage: "HIGH_LEVEL",
    signals: {
      ...baseSystemDesignSignals,
      designSignals: {
        signals: {
          requirement_missing: false,
          capacity_missing: true,
          tradeoff_missed: false,
          spof_missed: false,
          bottleneck_unexamined: false,
        },
        evidenceRefs: {
          requirement_missing: ["USER#1: requirements are clear"],
          capacity_missing: ["No QPS/data estimate provided yet."],
          tradeoff_missed: ["USER#2: discussed one architecture path only"],
          spof_missed: ["USER#3: reliability is underspecified"],
          bottleneck_unexamined: ["USER#3: no hotspot analysis yet"],
        },
        summary: "Capacity estimates are still missing.",
      },
    },
  },
  {
    id: "handwave_candidate",
    label: "Handwave candidate",
    currentStage: "DEEP_DIVE",
    signals: {
      ...baseSystemDesignSignals,
      reasoningDepth: "thin",
      communication: "mixed",
      designSignals: {
        signals: {
          requirement_missing: false,
          capacity_missing: false,
          tradeoff_missed: true,
          spof_missed: true,
          bottleneck_unexamined: false,
        },
        evidenceRefs: {
          requirement_missing: ["USER#1: basic requirements listed"],
          capacity_missing: ["USER#2: rough scale stated"],
          tradeoff_missed: ["No explicit option A vs option B tradeoff."],
          spof_missed: ["Single metadata service without mitigation."],
          bottleneck_unexamined: ["Partial hotspot mention only."],
        },
        summary: "Tradeoff and SPOF reasoning are still handwavy.",
      },
    },
  },
  {
    id: "strong_tradeoff_candidate",
    label: "Strong tradeoff candidate",
    currentStage: "WRAP_UP",
    signals: {
      ...baseSystemDesignSignals,
      reasoningDepth: "deep",
      communication: "clear",
      designSignals: {
        signals: {
          requirement_missing: false,
          capacity_missing: false,
          tradeoff_missed: false,
          spof_missed: false,
          bottleneck_unexamined: false,
        },
        evidenceRefs: {
          requirement_missing: ["Requirements are complete."],
          capacity_missing: ["Capacity estimates already integrated."],
          tradeoff_missed: ["Alternatives compared with pros/cons."],
          spof_missed: ["SPOF and failover covered."],
          bottleneck_unexamined: ["Hotspots and optimizations covered."],
        },
        summary: "Design coverage is complete.",
      },
    },
  },
];

export function evaluatePolicyScenario(
  scenario: PolicyRegressionScenario,
  archetype: PolicyArchetype,
): PolicyRegressionResult {
  const decisionTimeline = runScenarioTimeline(scenario, archetype);
  const firstDecision = decisionTimeline[0];
  const cumulativeReward = Number(
    decisionTimeline.reduce((sum, entry) => sum + (typeof entry.rewardTotal === "number" ? entry.rewardTotal : 0), 0).toFixed(2),
  );
  const averageReward =
    decisionTimeline.length > 0 ? Number((cumulativeReward / decisionTimeline.length).toFixed(2)) : 0;

  return {
    scenarioId: scenario.id,
    archetype,
    action: firstDecision?.action ?? "ask_followup",
    normalizedAction: firstDecision?.normalizedAction,
    target: firstDecision?.target ?? "reasoning",
    totalScore: firstDecision?.totalScore,
    averageReward,
    cumulativeReward,
    scoreWeightProfile: firstDecision?.scoreWeightProfile,
    pressure: firstDecision?.pressure,
    timing: firstDecision?.timing,
    suggestedStage: firstDecision?.suggestedStage,
    decisionTimeline,
    decisionPathway: firstDecision?.decisionPathway,
    reason: firstDecision?.reason ?? "No decision produced for this scenario.",
  };
}

export function runPolicyRegressionLab(
  archetypes: PolicyArchetype[] = ["bar_raiser", "collaborative"],
  scenarios: PolicyRegressionScenario[] = POLICY_REGRESSION_SCENARIOS,
) {
  return scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    label: scenario.label,
    ...summarizeScenarioRegression(archetypes.map((archetype) => evaluatePolicyScenario(scenario, archetype))),
  }));
}

export function derivePolicyTuningSuggestions(
  reports: PolicyRegressionScenarioReport[],
): PolicyTuningSuggestion[] {
  const allPenalties = reports
    .flatMap((report) => report.results)
    .flatMap((result) => result.decisionTimeline)
    .flatMap((turn) => turn.rewardPenalties);
  const penaltyCount = new Map<string, number>();
  for (const penalty of allPenalties) {
    penaltyCount.set(penalty, (penaltyCount.get(penalty) ?? 0) + 1);
  }

  const suggestions: PolicyTuningSuggestion[] = [];

  const interruptionPenalties =
    (penaltyCount.get("interrupted_when_should_wait") ?? 0) +
    (penaltyCount.get("interrupted_self_correction_window") ?? 0) +
    (penaltyCount.get("high_interrupt_cost_low_urgency") ?? 0);
  if (interruptionPenalties >= 2) {
    suggestions.push({
      id: "reduce_bad_interruptions",
      title: "Reduce interruption-heavy decisions in coding flow",
      rationale:
        `Detected ${interruptionPenalties} interruption-related penalties across scenario timelines, indicating timing pressure is too aggressive.`,
      recommendedAdjustments: [
        "Increase `scoreWeights.timing` and `scoreWeights.temporalCodingInterruptionPenalty` by +0.05~+0.12 for aggressive archetypes.",
        "Increase `actionBias.Hold` by +0.03 and decrease `actionBias.Probe` by -0.03 in flow-sensitive modes.",
      ],
    });
  }

  const repetitionPenalties = penaltyCount.get("repeated_target") ?? 0;
  if (repetitionPenalties >= 2) {
    suggestions.push({
      id: "reduce_repetition",
      title: "Reduce repeated-target probing",
      rationale:
        `Detected ${repetitionPenalties} repeated-target penalties, suggesting anti-repetition pressure is still too weak in some policy paths.`,
      recommendedAdjustments: [
        "Increase anti-repetition soft penalty weight via lower `scoreWeights.need` on Probe by -0.05 in collaborative/guided modes.",
        "Add +0.04 to `actionBias.Advance` when `answeredTargets` already includes the target family.",
      ],
    });
  }

  const wrapupPenalties = penaltyCount.get("reopened_wrap_up") ?? 0;
  if (wrapupPenalties >= 1) {
    suggestions.push({
      id: "harden_wrap_up",
      title: "Harden wrap-up closure preference",
      rationale:
        `Detected ${wrapupPenalties} wrap-up reopening penalties; closure invariants are present but policy bias can still drift toward extra probing.`,
      recommendedAdjustments: [
        "Increase `scoreWeights.closure` by +0.08 in bar-raiser/speed paths.",
        "Increase `actionBias.Close` by +0.04 and reduce `actionBias.Probe` by -0.02 during WRAP_UP policy mode.",
      ],
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: "no_major_penalty_hotspot",
      title: "No major penalty hotspot detected",
      rationale:
        "Current scenario timelines do not show concentrated penalty clusters; continue tuning by expanding scenario coverage.",
      recommendedAdjustments: [
        "Add harder adversarial scenarios before changing weights (for example mixed partial-answer echo or alternating pass/fail runs).",
      ],
    });
  }

  return suggestions;
}

type ScenarioTimelineDecision = CandidateDecision & {
  reward: ReturnType<typeof evaluateTurnReward>;
};

function runScenarioTimeline(
  scenario: PolicyRegressionScenario,
  archetype: PolicyArchetype,
  maxTurns = 3,
) {
  const recentEvents = [...(scenario.recentEvents ?? [])];
  const timeline: ScenarioTimelineDecision[] = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const decision = makeCandidateDecision({
      currentStage: scenario.currentStage,
      policy: scenario.policy,
      policyConfig: getPolicyPreset(archetype),
      signals: scenario.signals,
      recentEvents,
      latestExecutionRun: scenario.latestExecutionRun ?? null,
    });
    const reward = evaluateTurnReward({
      stage: scenario.currentStage,
      decision,
      recentEvents,
    });
    timeline.push({ ...decision, reward });

    recentEvents.push(
      {
        eventType: "DECISION_RECORDED",
        payloadJson: {
          stage: scenario.currentStage,
          decision: {
            action: decision.action,
            target: decision.target,
            normalizedAction: decision.normalizedAction,
            totalScore: decision.totalScore,
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          stage: scenario.currentStage,
          reward,
        },
      },
    );

    if (decision.action === "close_topic" || decision.action === "end_interview") {
      break;
    }
  }

  return timeline.map((entry, index) => ({
    turn: index + 1,
    action: entry.action,
    target: entry.target,
    normalizedAction: entry.normalizedAction,
    totalScore: entry.totalScore,
    rewardTotal: entry.reward.total,
    rewardPenalties: entry.reward.penalties,
    pressure: entry.pressure,
    timing: entry.timing,
    suggestedStage: entry.suggestedStage,
    scoreWeightProfile: entry.scoreWeightProfile,
    decisionPathway: entry.decisionPathway,
    reason: entry.reason,
  }));
}

function summarizeScenarioRegression(results: PolicyRegressionResult[]): Omit<PolicyRegressionScenarioReport, "scenarioId" | "label"> {
  const fields: Array<"action" | "target" | "pressure" | "timing" | "suggestedStage"> = [
    "action",
    "target",
    "pressure",
    "timing",
    "suggestedStage",
  ];
  const divergentFields = fields.filter((field) => {
    const first = results[0]?.[field];
    return results.some((result) => result[field] !== first);
  });

  const scoreSpread = buildScoreSpread(results);
  const rewardSpread = buildRewardSpread(results);
  const scoreSummary = scoreSpread
    ? `score spread ${scoreSpread.spread.toFixed(2)} (${scoreSpread.bestArchetype} vs ${scoreSpread.weakestArchetype})`
    : "score spread unavailable";
  const rewardSummary = rewardSpread
    ? `reward spread ${rewardSpread.spread.toFixed(2)} (${rewardSpread.bestArchetype} vs ${rewardSpread.weakestArchetype})`
    : "reward spread unavailable";

  const summary =
    divergentFields.length === 0
      ? `The archetypes converge on the same move for this scenario (${scoreSummary}; ${rewardSummary}).`
      : `The archetypes diverge on ${divergentFields.join(", ")} for this scenario (${scoreSummary}; ${rewardSummary}).`;

  const bestScore = scoreSpread?.maxTotalScore ?? null;
  const bestReward = rewardSpread?.maxAverageReward ?? null;
  const enrichedResults = results.map((result) => ({
    ...result,
    scoreGapFromBest:
      bestScore === null || typeof result.totalScore !== "number"
        ? undefined
        : Number((bestScore - result.totalScore).toFixed(2)),
    rewardGapFromBest:
      bestReward === null || typeof result.averageReward !== "number"
        ? undefined
        : Number((bestReward - result.averageReward).toFixed(2)),
  }));

  return {
    results: enrichedResults,
    divergentFields,
    scoreSpread,
    rewardSpread,
    summary,
  };
}

function buildScoreSpread(results: PolicyRegressionResult[]) {
  const scored = results
    .filter((result): result is PolicyRegressionResult & { totalScore: number } => typeof result.totalScore === "number")
    .sort((left, right) => right.totalScore - left.totalScore);

  if (scored.length === 0) {
    return null;
  }

  const best = scored[0];
  const weakest = scored[scored.length - 1];
  return {
    maxTotalScore: Number(best.totalScore.toFixed(2)),
    minTotalScore: Number(weakest.totalScore.toFixed(2)),
    spread: Number((best.totalScore - weakest.totalScore).toFixed(2)),
    bestArchetype: best.archetype,
    weakestArchetype: weakest.archetype,
  };
}

function buildRewardSpread(results: PolicyRegressionResult[]) {
  const scored = results
    .filter((result): result is PolicyRegressionResult & { averageReward: number } => typeof result.averageReward === "number")
    .sort((left, right) => right.averageReward - left.averageReward);

  if (scored.length === 0) {
    return null;
  }

  const best = scored[0];
  const weakest = scored[scored.length - 1];
  return {
    maxAverageReward: Number(best.averageReward.toFixed(2)),
    minAverageReward: Number(weakest.averageReward.toFixed(2)),
    spread: Number((best.averageReward - weakest.averageReward).toFixed(2)),
    bestArchetype: best.archetype,
    weakestArchetype: weakest.archetype,
  };
}

export function evaluateSystemDesignScenario(
  scenario: SystemDesignRegressionScenario,
  maxTurns = 3,
): SystemDesignRegressionResult {
  const decisionTimeline = runSystemDesignScenarioTimeline(scenario, maxTurns);
  const totalScore = Number((decisionTimeline[0]?.totalScore ?? 0).toFixed(2));
  const cumulativeReward = Number(
    decisionTimeline.reduce((sum, item) => sum + item.rewardTotal, 0).toFixed(2),
  );
  const averageReward =
    decisionTimeline.length > 0
      ? Number((cumulativeReward / decisionTimeline.length).toFixed(2))
      : 0;

  return {
    scenarioId: scenario.id,
    label: scenario.label,
    decisionTimeline,
    totalScore,
    averageReward,
    cumulativeReward,
  };
}

export function runSystemDesignRegressionLab(
  scenarios: SystemDesignRegressionScenario[] = SYSTEM_DESIGN_REGRESSION_SCENARIOS,
): SystemDesignRegressionReport[] {
  const results = scenarios.map((scenario) => evaluateSystemDesignScenario(scenario));
  const bestScore = Math.max(...results.map((item) => item.totalScore));
  const bestReward = Math.max(...results.map((item) => item.averageReward));

  return results.map((result) => ({
    scenarioId: result.scenarioId,
    label: result.label,
    result,
    scoreDiffFromBest: Number((bestScore - result.totalScore).toFixed(2)),
    rewardDiffFromBest: Number((bestReward - result.averageReward).toFixed(2)),
  }));
}

function runSystemDesignScenarioTimeline(
  scenario: SystemDesignRegressionScenario,
  maxTurns: number,
) {
  const recentEvents = [...(scenario.recentEvents ?? [])];
  const signals: CandidateSignalSnapshot = JSON.parse(JSON.stringify(scenario.signals));
  const timeline: Array<{
    turn: number;
    action: CandidateDecision["action"];
    target: CandidateDecision["target"];
    systemDesignActionType: string;
    totalScore?: number;
    rewardTotal: number;
    rewardPenalties: string[];
  }> = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const decision = makeSystemDesignDecision({
      currentStage: scenario.currentStage,
      signals,
    });
    const reward = evaluateTurnReward({
      stage: scenario.currentStage,
      decision,
      recentEvents,
    });

    timeline.push({
      turn: turn + 1,
      action: decision.action,
      target: decision.target,
      systemDesignActionType: decision.systemDesignActionType,
      totalScore: decision.totalScore,
      rewardTotal: reward.total,
      rewardPenalties: reward.penalties,
    });

    recentEvents.push(
      {
        eventType: "DECISION_RECORDED",
        payloadJson: {
          stage: scenario.currentStage,
          decision: {
            action: decision.action,
            target: decision.target,
            totalScore: decision.totalScore,
            systemDesignActionType: decision.systemDesignActionType,
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          stage: scenario.currentStage,
          reward,
        },
      },
    );

    const designSignals = signals.designSignals?.signals;
    if (designSignals) {
      switch (decision.systemDesignActionType) {
        case "ASK_REQUIREMENT":
          designSignals.requirement_missing = false;
          break;
        case "ASK_CAPACITY":
          designSignals.capacity_missing = false;
          break;
        case "PROBE_TRADEOFF":
          designSignals.tradeoff_missed = false;
          break;
        case "CHALLENGE_SPOF":
          designSignals.spof_missed = false;
          break;
        case "ZOOM_IN":
          designSignals.bottleneck_unexamined = false;
          break;
        case "WRAP_UP":
          break;
      }
    }

    if (decision.systemDesignActionType === "WRAP_UP") {
      break;
    }
  }

  return timeline;
}

