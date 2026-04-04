import { describe, expect, it } from "vitest";
import { assessPassConditions, selectRelevantPassAssessment } from "@/lib/assistant/pass_conditions";
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
  readyToCode: true,
  reasoningDepth: "moderate",
  testingDiscipline: "partial",
  complexityRigor: "partial",
  confidence: 0.8,
  evidence: ["Candidate explained a concrete one-pass solution."],
  structuredEvidence: [],
  summary: "Candidate is ready to code.",
  trendSummary: "Candidate state is broadly stable relative to the previous snapshot.",
};

describe("pass conditions", () => {
  it("marks implementation gate complete when the candidate is clearly ready to code", () => {
    const ledger = buildMemoryLedger({
      currentStage: "APPROACH_DISCUSSION",
      signals: baseSignals,
      recentEvents: [],
      latestExecutionRun: null,
    });
    const assessment = assessPassConditions({
      currentStage: "APPROACH_DISCUSSION",
      signals: baseSignals,
      memory: ledger,
      latestExecutionRun: null,
    });

    expect(assessment.implementation.complete).toBe(true);
    expect(assessment.implementation.missing).toEqual([]);
  });

  it("keeps testing gate incomplete when exact outputs are still missing", () => {
    const ledger = buildMemoryLedger({
      currentStage: "TESTING_AND_COMPLEXITY",
      signals: {
        ...baseSignals,
        readyToCode: false,
        edgeCaseAwareness: "present",
      },
      recentEvents: [],
      latestExecutionRun: { status: "PASSED" },
    });
    const assessment = assessPassConditions({
      currentStage: "TESTING_AND_COMPLEXITY",
      signals: {
        ...baseSignals,
        readyToCode: false,
        edgeCaseAwareness: "present",
      },
      memory: ledger,
      latestExecutionRun: { status: "PASSED" },
    });

    expect(assessment.testing.complete).toBe(false);
    expect(assessment.testing.missing).toContain("expected_output_is_precise");
  });

  it("selects the complexity gate for tradeoff decisions", () => {
    const ledger = buildMemoryLedger({
      currentStage: "TESTING_AND_COMPLEXITY",
      signals: baseSignals,
      recentEvents: [],
      latestExecutionRun: { status: "PASSED" },
    });
    const assessment = assessPassConditions({
      currentStage: "TESTING_AND_COMPLEXITY",
      signals: baseSignals,
      memory: ledger,
      latestExecutionRun: { status: "PASSED" },
    });

    const relevant = selectRelevantPassAssessment("tradeoff", "TESTING_AND_COMPLEXITY", assessment);
    expect(relevant.topic).toBe("complexity");
    expect(relevant.passConditions).toContain("time_complexity_stated");
  });
});
