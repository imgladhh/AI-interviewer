import { describe, expect, it } from "vitest";
import { makeCandidateDecision } from "@/lib/assistant/decision_engine";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "partial",
  algorithmChoice: "reasonable",
  edgeCaseAwareness: "partial",
  behavior: "structured",
  reasoningDepth: "moderate",
  testingDiscipline: "partial",
  complexityRigor: "partial",
  confidence: 0.76,
  evidence: ["Candidate explained the approach clearly."],
  structuredEvidence: [],
  summary: "Understanding is clear and progress is progressing.",
  trendSummary: "Candidate state is broadly stable relative to the previous snapshot.",
};

const basePolicy = {
  currentStage: "IMPLEMENTATION",
  recommendedAction: "LET_IMPLEMENT",
  shouldServeHint: false,
  nextStage: "IMPLEMENTATION",
  exitCriteria: ["Keep coding"],
  checklist: [],
  checklistProgress: { completed: 0, total: 0, remaining: 0 },
  explanation: "Continue implementation.",
} as const;

describe("makeCandidateDecision", () => {
  it("forces a narrow debug move after repeated failures", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        progress: "stuck",
        codeQuality: "buggy",
      },
      recentEvents: [
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "FAILED" } },
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "ERROR" } },
      ],
      latestExecutionRun: { status: "ERROR", stderr: "IndexError" },
    });

    expect(result.action).toBe("ask_for_debug_plan");
    expect(result.target).toBe("debugging");
    expect(result.suggestedStage).toBe("DEBUGGING");
    expect(result.expectedAnswer).toMatch(/failing input|line|branch/i);
  });

  it("special-cases indexing failures into a bounds-focused debugging follow-up", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        progress: "stuck",
        codeQuality: "buggy",
      },
      latestExecutionRun: { status: "ERROR", stderr: "IndexError: list index out of range" },
    });

    expect(result.action).toBe("ask_for_debug_plan");
    expect(result.question).toMatch(/index|bounds|pointer|valid range/i);
    expect(result.targetCodeLine).toMatch(/pointer|array access|valid range/i);
  });

  it("special-cases timeout failures into a complexity-focused debugging follow-up", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        progress: "stuck",
        codeQuality: "buggy",
      },
      latestExecutionRun: { status: "TIMEOUT", stderr: "Execution timed out" },
    });

    expect(result.action).toBe("ask_for_debug_plan");
    expect(result.question).toMatch(/timeout|runtime|loop|recursion/i);
    expect(result.expectedAnswer).toMatch(/expensive step|cost|alternative/i);
  });

  it("pushes on tradeoffs when understanding is clear but algorithm choice is weak", () => {
    const result = makeCandidateDecision({
      currentStage: "APPROACH_DISCUSSION",
      policy: {
        ...basePolicy,
        currentStage: "APPROACH_DISCUSSION",
        nextStage: "APPROACH_DISCUSSION",
        recommendedAction: "PROBE_APPROACH",
      },
      signals: {
        ...baseSignals,
        algorithmChoice: "suboptimal",
      },
    });

    expect(result.action).toBe("probe_tradeoff");
    expect(result.target).toBe("tradeoff");
    expect(result.specificIssue).toMatch(/algorithm choice/i);
    expect(result.question).toMatch(/runtime|efficient|alternative|tradeoff/i);
  });

  it("uses correctness evidence to ask for an explicit invariant in approach discussion", () => {
    const result = makeCandidateDecision({
      currentStage: "APPROACH_DISCUSSION",
      policy: {
        ...basePolicy,
        currentStage: "APPROACH_DISCUSSION",
        nextStage: "APPROACH_DISCUSSION",
        recommendedAction: "PROBE_APPROACH",
      },
      signals: {
        ...baseSignals,
        structuredEvidence: [
          {
            area: "correctness",
            issue: "The correctness invariant is still underspecified.",
            behavior: "The candidate described the plan, but did not anchor it to an invariant.",
            evidence: "The recent explanation never stated what remains true after each step.",
            impact: "The interviewer still lacks strong correctness evidence.",
            fix: "State one invariant explicitly.",
          },
        ],
      },
    });

    expect(result.action).toBe("probe_correctness");
    expect(result.specificIssue).toMatch(/invariant/i);
    expect(result.question).toMatch(/invariant|correctness/i);
  });

  it("uses tradeoff evidence to ask a more surgical tradeoff follow-up", () => {
    const result = makeCandidateDecision({
      currentStage: "TESTING_AND_COMPLEXITY",
      policy: {
        ...basePolicy,
        currentStage: "TESTING_AND_COMPLEXITY",
        nextStage: "WRAP_UP",
        recommendedAction: "VALIDATE_AND_TEST",
      },
      signals: {
        ...baseSignals,
        structuredEvidence: [
          {
            area: "complexity",
            issue: "Complexity was named, but the tradeoff analysis stayed shallow.",
            behavior: "The candidate stated Big-O, but did not compare it to an alternative.",
            evidence: "Recent turns mention complexity without explaining what memory/runtime tradeoff was accepted.",
            impact: "The tradeoff reasoning is still weak.",
            fix: "Compare against one realistic alternative.",
          },
        ],
      },
    });

    expect(result.action).toBe("probe_tradeoff");
    expect(result.specificIssue).toMatch(/tradeoff/i);
    expect(result.question).toMatch(/tradeoff|alternative/i);
  });

  it("uses boundary evidence to ask for explicit boundary cases after a passing run", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        codeQuality: "correct",
        edgeCaseAwareness: "partial",
        structuredEvidence: [
          {
            area: "edge_case",
            issue: "Boundary coverage is still too narrow.",
            behavior: "The candidate mentioned validation, but only at a surface level.",
            evidence: "The explanation did not cover enough empty or minimal cases.",
            impact: "Thin boundary coverage leaves correctness gaps.",
            fix: "Name at least two boundary cases.",
          },
        ],
      },
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.action).toBe("ask_for_test_case");
    expect(result.specificIssue).toMatch(/boundary coverage/i);
    expect(result.expectedAnswer).toMatch(/boundary cases|expected output/i);
  });

  it("holds the floor for the candidate when implementation is progressing in a structured way", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        progress: "progressing",
        behavior: "structured",
      },
      recentEvents: [
        { eventType: "CANDIDATE_SPOKE" },
        { eventType: "AI_SPOKE" },
        { eventType: "CANDIDATE_SPOKE" },
      ],
    });

    expect(result.action).toBe("hold_and_listen");
    expect(result.target).toBe("implementation");
  });

  it("probes correctness when the code looks close but the reasoning is still thin", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        codeQuality: "correct",
        reasoningDepth: "thin",
      },
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.action).toBe("probe_correctness");
    expect(result.target).toBe("correctness");
    expect(result.expectedAnswer).toMatch(/concrete example|invariant/i);
    expect(result.question).toMatch(/correct|invariant|concrete example/i);
  });

  it("asks for edge cases when implementation is complete but validation is thin", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        codeQuality: "correct",
        edgeCaseAwareness: "missing",
      },
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.action).toBe("ask_for_test_case");
    expect(result.target).toBe("edge_case");
    expect(result.question).toMatch(/empty-input|single-element|duplicate|boundary/i);
    expect(result.suggestedStage).toBe("TESTING_AND_COMPLEXITY");
  });

  it("pushes for explicit reasoning when the candidate names an approach without enough explanation", () => {
    const result = makeCandidateDecision({
      currentStage: "APPROACH_DISCUSSION",
      policy: {
        ...basePolicy,
        currentStage: "APPROACH_DISCUSSION",
        nextStage: "APPROACH_DISCUSSION",
        recommendedAction: "PROBE_APPROACH",
      },
      signals: {
        ...baseSignals,
        reasoningDepth: "thin",
      },
    });

    expect(result.action).toBe("ask_for_reasoning");
    expect(result.target).toBe("reasoning");
    expect(result.question).toMatch(/why does this approach work|invariant|concrete example/i);
  });

  it("asks for complexity rigor before wrap-up when testing is covered but complexity is still weak", () => {
    const result = makeCandidateDecision({
      currentStage: "TESTING_AND_COMPLEXITY",
      policy: {
        ...basePolicy,
        currentStage: "TESTING_AND_COMPLEXITY",
        nextStage: "WRAP_UP",
        recommendedAction: "VALIDATE_AND_TEST",
      },
      signals: {
        ...baseSignals,
        edgeCaseAwareness: "present",
        testingDiscipline: "strong",
        complexityRigor: "missing",
      },
    });

    expect(result.action).toBe("ask_for_complexity");
    expect(result.question).toMatch(/time and space complexity|tradeoff/i);
  });

  it("moves faster into implementation when the candidate-state trend is clearly improving", () => {
    const result = makeCandidateDecision({
      currentStage: "APPROACH_DISCUSSION",
      policy: {
        ...basePolicy,
        currentStage: "APPROACH_DISCUSSION",
        nextStage: "APPROACH_DISCUSSION",
        recommendedAction: "PROBE_APPROACH",
      },
      signals: {
        ...baseSignals,
        trendSummary: "Recent state trend: progress moved from stuck to progressing; testing discipline moved from missing to partial.",
      },
    });

    expect(result.action).toBe("encourage_and_continue");
    expect(result.suggestedStage).toBe("IMPLEMENTATION");
  });

  it("forces a tighter implementation follow-up when the candidate-state trend is getting worse", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        trendSummary: "Recent state trend: progress moved from progressing to stuck; code quality changed from correct to buggy.",
      },
    });

    expect(result.action).toBe("ask_followup");
    expect(result.target).toBe("implementation");
    expect(result.question).toMatch(/state update|branch|tiny input/i);
  });
});

