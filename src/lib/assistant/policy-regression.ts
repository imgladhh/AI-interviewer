import { makeCandidateDecision, type CandidateDecision } from "@/lib/assistant/decision_engine";
import { getPolicyPreset, type PolicyArchetype } from "@/lib/assistant/policy-config";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewPolicy } from "@/lib/assistant/policy";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

export type PolicyRegressionScenarioId =
  | "strong_precode"
  | "stuck_debugging"
  | "saturated_wrapup"
  | "flow_preservation"
  | "answered_target_guard";

export type PolicyRegressionScenario = {
  id: PolicyRegressionScenarioId;
  label: string;
  currentStage: CodingInterviewStage;
  policy: CodingInterviewPolicy;
  signals: CandidateSignalSnapshot;
  recentEvents?: Array<{ eventType: string; payloadJson?: unknown }>;
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
  target: CandidateDecision["target"];
  pressure?: CandidateDecision["pressure"];
  timing?: CandidateDecision["timing"];
  suggestedStage?: CandidateDecision["suggestedStage"];
  decisionPathway?: string[];
  reason: string;
};

export type PolicyRegressionScenarioReport = {
  scenarioId: PolicyRegressionScenarioId;
  label: string;
  results: PolicyRegressionResult[];
  divergentFields: Array<"action" | "target" | "pressure" | "timing" | "suggestedStage">;
  summary: string;
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
];

export function evaluatePolicyScenario(
  scenario: PolicyRegressionScenario,
  archetype: PolicyArchetype,
): PolicyRegressionResult {
  const decision = makeCandidateDecision({
    currentStage: scenario.currentStage,
    policy: scenario.policy,
    policyConfig: getPolicyPreset(archetype),
    signals: scenario.signals,
    recentEvents: scenario.recentEvents,
    latestExecutionRun: scenario.latestExecutionRun ?? null,
  });

  return {
    scenarioId: scenario.id,
    archetype,
    action: decision.action,
    target: decision.target,
    pressure: decision.pressure,
    timing: decision.timing,
    suggestedStage: decision.suggestedStage,
    decisionPathway: decision.decisionPathway,
    reason: decision.reason,
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

  const summary =
    divergentFields.length === 0
      ? "The archetypes converge on the same move for this scenario."
      : `The archetypes diverge on ${divergentFields.join(", ")} for this scenario.`;

  return {
    results,
    divergentFields,
    summary,
  };
}
