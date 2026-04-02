import { describe, expect, it } from "vitest";
import { assessLatentCalibration } from "@/lib/assistant/latent_calibration";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { MemoryLedger } from "@/lib/assistant/memory_ledger";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "correct",
  algorithmChoice: "strong",
  edgeCaseAwareness: "present",
  behavior: "structured",
  readyToCode: true,
  reasoningDepth: "deep",
  testingDiscipline: "strong",
  complexityRigor: "strong",
  confidence: 0.84,
  evidence: ["Candidate explained the key invariant."],
  structuredEvidence: [],
  summary: "Candidate is progressing smoothly.",
};

const baseLedger: MemoryLedger = {
  answeredTargets: ["complexity", "tradeoff"],
  collectedEvidence: ["complexity_tradeoff", "test_cases"],
  unresolvedIssues: [],
  resolvedIssues: ["basic_validation"],
  missingEvidence: [],
  repeatedFailurePattern: null,
  persistentWeakness: null,
  recentFailedRuns: 0,
  recentHints: 0,
  recentProofStyleProbeCount: 0,
  recentlyProbedTargets: [],
  recentlyProbedIssues: [],
  summary: [],
  shouldAvoidTarget: () => false,
};

describe("assessLatentCalibration", () => {
  it("marks smooth, strong sessions as level-up ready", () => {
    const result = assessLatentCalibration({
      signals: baseSignals,
      ledger: baseLedger,
      latestExecutionRun: { status: "PASSED" },
    });

    expect(result.candidateCeiling).toBe("stretch");
    expect(result.easeOfExecution).toBe("smooth");
    expect(result.levelUpReady).toBe(true);
    expect(result.confidenceInVerdict).toBeGreaterThan(0.85);
  });

  it("marks repeated-failure sessions as strained", () => {
    const result = assessLatentCalibration({
      signals: {
        ...baseSignals,
        progress: "stuck",
        confidence: 0.62,
      },
      ledger: {
        ...baseLedger,
        recentFailedRuns: 3,
      },
      latestExecutionRun: { status: "FAILED" },
    });

    expect(result.easeOfExecution).toBe("strained");
    expect(result.levelUpReady).toBe(false);
    expect(result.confidenceInVerdict).toBeLessThan(0.7);
  });
});
