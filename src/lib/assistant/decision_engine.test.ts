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

  it("moves directly into implementation from problem understanding when the direction is already workable", () => {
    const result = makeCandidateDecision({
      currentStage: "PROBLEM_UNDERSTANDING",
      policy: {
        ...basePolicy,
        currentStage: "PROBLEM_UNDERSTANDING",
        nextStage: "PROBLEM_UNDERSTANDING",
        recommendedAction: "CLARIFY",
      },
      signals: {
        ...baseSignals,
        understanding: "clear",
        algorithmChoice: "reasonable",
        progress: "progressing",
        communication: "clear",
        behavior: "structured",
        confidence: 0.78,
      },
    });

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
    expect(result.question).toMatch(/implement|coding|algorithmic direction|go ahead/i);
  });

  it("lets the candidate start coding in approach discussion when the direction is solid", () => {
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
        readyToCode: true,
        understanding: "clear",
        algorithmChoice: "strong",
        progress: "progressing",
        communication: "clear",
        behavior: "structured",
        confidence: 0.8,
        structuredEvidence: [],
      },
    });

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
    expect(result.question).toMatch(/implement|coding|workable plan|go ahead/i);
  });

  it("prefers implementation over generic clarification when implementation evidence already exists", () => {
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
        readyToCode: true,
        confidence: 0.34,
      },
    });

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
    expect(result.reason).toMatch(/avoid regressing into generic clarification/i);
  });

  it("still prefers implementation if recent signal history already showed ready-to-code evidence", () => {
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
        readyToCode: false,
      },
      recentEvents: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              readyToCode: true,
              understanding: "clear",
              algorithmChoice: "strong",
              progress: "progressing",
            },
          },
        },
      ],
    });

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
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

    expect(["probe_correctness", "ask_for_test_case", "end_interview"]).toContain(result.action);
    expect(result.specificIssue).toMatch(/invariant/i);
    expect(result.question).toMatch(/invariant|correctness/i);
  });

  it("defers proof-style probing until after implementation when the candidate is already ready to code", () => {
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
        readyToCode: true,
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

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
  });

  it("does not spend more than one proof-style turn before implementation once the candidate is ready to code", () => {
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
        readyToCode: true,
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
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              action: "probe_correctness",
              target: "correctness",
              specificIssue: "The correctness invariant is still underspecified.",
            },
          },
        },
      ],
    });

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
    expect(result.reason).toMatch(/implementation|proof-style|front-loading/i);
  });

  it("forces implementation once algorithm, complexity, and test evidence are already present before coding", () => {
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
        readyToCode: true,
        complexityRigor: "partial",
        testingDiscipline: "partial",
        edgeCaseAwareness: "partial",
      },
      latestExecutionRun: null,
    });

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
    expect(result.reason).toMatch(/enough pre-code evidence|move into implementation/i);
  });

  it("still prefers implementation from testing-and-complexity if no code exists yet but pre-code evidence is already sufficient", () => {
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
        readyToCode: true,
        complexityRigor: "strong",
        testingDiscipline: "strong",
        edgeCaseAwareness: "present",
      },
      latestExecutionRun: null,
    });

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
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
    expect(result.specificIssue).toMatch(/boundary|edge-case|validation/i);
    expect(result.expectedAnswer).toMatch(/boundary case|expected output/i);
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

  it("does not hold the floor when unresolved correctness issues are still on the ledger", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        progress: "progressing",
        behavior: "structured",
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
      recentEvents: [
        { eventType: "CANDIDATE_SPOKE" },
        { eventType: "AI_SPOKE" },
        { eventType: "CANDIDATE_SPOKE" },
      ],
    });

    expect(result.action).not.toBe("hold_and_listen");
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

    expect(["probe_correctness", "ask_for_test_case", "end_interview"]).toContain(result.action);
    expect(["correctness", "edge_case"]).toContain(result.target);
    expect(result.expectedAnswer).toMatch(/boundary case|exact output|concrete example|invariant/i);
    expect(result.question).toMatch(/correct|invariant|concrete example|boundary condition|exact output/i);
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

  it("does not immediately repeat complexity after the candidate already answered complexity and tradeoff", () => {
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
        testingDiscipline: "strong",
        edgeCaseAwareness: "present",
        complexityRigor: "strong",
      },
      latestExecutionRun: { status: "PASSED" },
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "complexity", action: "ask_for_complexity" } },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "tradeoff", action: "probe_tradeoff" } },
        },
      ],
    });

    expect(["move_stage", "move_to_wrap_up"]).toContain(result.action);
    expect(result.suggestedStage).toBe("WRAP_UP");
    expect(result.question).not.toMatch(/time complexity|space complexity|tradeoff/i);
  });

  it("does not immediately repeat testing after the candidate already supplied exact boundary cases and outputs", () => {
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
        testingDiscipline: "strong",
        edgeCaseAwareness: "present",
      },
      latestExecutionRun: { status: "PASSED" },
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "testing", action: "ask_for_test_case" } },
        },
      ],
    });

    expect(result.action).not.toBe("ask_for_test_case");
  });

  it("refuses to fully wrap up when correctness evidence is still missing", () => {
    const result = makeCandidateDecision({
      currentStage: "WRAP_UP",
      policy: {
        ...basePolicy,
        currentStage: "WRAP_UP",
        nextStage: "WRAP_UP",
        recommendedAction: "WRAP_UP",
      },
      signals: {
        ...baseSignals,
        progress: "done",
        reasoningDepth: "thin",
      },
    });

    expect(["probe_correctness", "ask_for_test_case", "end_interview"]).toContain(result.action);
    expect(result.question).toMatch(/proof sketch|invariant|correct|done here|close this question/i);
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

    expect(["encourage_and_continue", "move_stage"]).toContain(result.action);
    expect(["IMPLEMENTATION", "APPROACH_DISCUSSION"]).toContain(result.suggestedStage);
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

  it("treats repeated thin reasoning as a persistent weakness", () => {
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
      recentEvents: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: { signals: { reasoningDepth: "thin" } },
        },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: { signals: { reasoningDepth: "moderate" } },
        },
      ],
    });

    expect(result.action).toBe("ask_for_reasoning");
    expect(result.specificIssue).toMatch(/reasoning depth has remained weak/i);
    expect(result.question).toMatch(/proof sketch|invariant/i);
  });

  it("treats repeated weak testing as a persistent weakness during testing stage", () => {
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
        testingDiscipline: "partial",
      },
      recentEvents: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: { signals: { testingDiscipline: "missing" } },
        },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: { signals: { testingDiscipline: "partial" } },
        },
      ],
    });

    expect(result.action).toBe("ask_for_test_case");
    expect(result.specificIssue).toMatch(/testing discipline has remained weak/i);
    expect(result.question).toMatch(/exact high-risk test cases|expected output/i);
  });

  it("treats repeated weak complexity rigor as a persistent weakness during testing stage", () => {
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
        complexityRigor: "partial",
      },
      recentEvents: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: { signals: { complexityRigor: "missing" } },
        },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: { signals: { complexityRigor: "partial" } },
        },
      ],
    });

    expect(result.action).toBe("probe_tradeoff");
    expect(result.specificIssue).toMatch(/complexity reasoning has remained shallow/i);
    expect(result.question).toMatch(/tradeoff|constraints/i);
  });

  it("avoids repeating the same reasoning target after it was already pressed multiple times", () => {
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
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "reasoning", action: "ask_for_reasoning", specificIssue: "Reasoning depth is weak." } },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "correctness", action: "probe_correctness", specificIssue: "Invariant still weak." } },
        },
      ],
    });

    expect(result.action).not.toBe("ask_for_reasoning");
    expect(result.question).not.toMatch(/proof sketch or invariant/i);
  });

  it("ends the question once wrap-up evidence is already saturated", () => {
    const result = makeCandidateDecision({
      currentStage: "WRAP_UP",
      policy: {
        ...basePolicy,
        currentStage: "WRAP_UP",
        nextStage: "WRAP_UP",
        recommendedAction: "WRAP_UP",
      },
      signals: {
        ...baseSignals,
        progress: "done",
        testingDiscipline: "strong",
        edgeCaseAwareness: "present",
        complexityRigor: "strong",
      },
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "summary", action: "move_to_wrap_up" } },
        },
      ],
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.action).toBe("end_interview");
    expect(result.question).toMatch(/done here|covers this question well/i);
  });

  it("asks for clarification instead of probing hard when signal confidence is low", () => {
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
        confidence: 0.34,
        progress: "progressing",
      },
    });

    expect(result.action).toBe("ask_for_clarification");
    expect(result.question).toMatch(/tiny example|state or output|reading your state correctly/i);
  });

  it("holds and listens when confidence is low but the candidate still has the floor", () => {
    const result = makeCandidateDecision({
      currentStage: "IMPLEMENTATION",
      policy: basePolicy,
      signals: {
        ...baseSignals,
        confidence: 0.35,
        progress: "progressing",
      },
      recentEvents: [
        { eventType: "AI_SPOKE" },
        { eventType: "CANDIDATE_SPOKE" },
        { eventType: "CANDIDATE_SPOKE" },
      ],
    });

    expect(result.action).toBe("hold_and_listen");
    expect(result.reason).toMatch(/confidence is low/i);
  });
});




