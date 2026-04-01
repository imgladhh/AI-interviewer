import { describe, expect, it } from "vitest";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
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
  confidence: 0.74,
  evidence: ["Candidate explained the approach."],
  structuredEvidence: [],
  summary: "Candidate is broadly progressing.",
};

describe("buildMemoryLedger", () => {
  it("tracks recently pressed targets and avoids repeating them", () => {
    const ledger = buildMemoryLedger({
      currentStage: "APPROACH_DISCUSSION",
      signals: baseSignals,
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "reasoning", specificIssue: "Proof sketch is still missing." } },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "correctness", specificIssue: "Invariant was not explicit." } },
        },
      ],
    });

    expect(ledger.recentlyProbedTargets).toEqual(["reasoning", "correctness"]);
    expect(ledger.shouldAvoidTarget("reasoning", "correctness")).toBe(true);
  });

  it("derives missing evidence and repeated failure patterns", () => {
    const ledger = buildMemoryLedger({
      currentStage: "WRAP_UP",
      signals: {
        ...baseSignals,
        reasoningDepth: "thin",
        edgeCaseAwareness: "missing",
        testingDiscipline: "missing",
        complexityRigor: "missing",
      },
      latestExecutionRun: { status: "TIMEOUT", stderr: "Execution timed out" },
      recentEvents: [
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "TIMEOUT", stderr: "Execution timed out" } },
      ],
    });

    expect(ledger.missingEvidence).toEqual(
      expect.arrayContaining([
        "correctness_proof",
        "exact_test_outputs",
        "boundary_coverage",
        "constraint_tradeoff",
      ]),
    );
    expect(ledger.repeatedFailurePattern).toBe("timeout");
  });

  it("tracks answered targets and collected evidence once the candidate has already covered testing and complexity", () => {
    const ledger = buildMemoryLedger({
      currentStage: "TESTING_AND_COMPLEXITY",
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
          payloadJson: { decision: { target: "testing", action: "ask_for_test_case" } },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "tradeoff", action: "probe_tradeoff" } },
        },
      ],
    });

    expect(ledger.collectedEvidence).toEqual(
      expect.arrayContaining(["test_cases", "exact_test_outputs", "complexity_tradeoff"]),
    );
    expect(ledger.answeredTargets).toEqual(expect.arrayContaining(["testing", "tradeoff", "complexity"]));
  });

  it("treats wrap-up as answered once summary evidence has already been collected", () => {
    const ledger = buildMemoryLedger({
      currentStage: "WRAP_UP",
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
          payloadJson: { decision: { target: "summary", action: "move_stage" } },
        },
      ],
    });

    expect(ledger.answeredTargets).toContain("summary");
  });
});
