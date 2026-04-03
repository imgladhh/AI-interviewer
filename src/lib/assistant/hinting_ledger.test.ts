import { describe, expect, it } from "vitest";
import {
  buildHintingLedger,
  classifyHintGranularity,
  estimateHintCost,
  resolveRescueMode,
} from "@/lib/assistant/hinting_ledger";

describe("hinting_ledger", () => {
  it("classifies stronger implementation nudges as near-solution hints", () => {
    expect(classifyHintGranularity("IMPLEMENTATION_NUDGE", "STRONG")).toBe("near_solution");
    expect(classifyHintGranularity("CLARIFYING_NUDGE", "LIGHT")).toBe("conceptual");
  });

  it("estimates higher cost for candidate-requested early implementation hints", () => {
    expect(
      estimateHintCost({
        hintStyle: "IMPLEMENTATION_NUDGE",
        hintLevel: "STRONG",
        hintInitiator: "candidate_request",
        hintRequestTiming: "early",
        momentumAtHint: "productive",
      }),
    ).toBeGreaterThan(
      estimateHintCost({
        hintStyle: "CLARIFYING_NUDGE",
        hintLevel: "LIGHT",
        hintInitiator: "system_rescue",
        hintRequestTiming: "mid",
        momentumAtHint: "stalled",
      }),
    );
  });

  it("builds aggregated hint ledgers from served hint events with initiator and timing", () => {
    const ledger = buildHintingLedger([
      {
        eventType: "HINT_SERVED",
        payloadJson: {
          hintLevel: "LIGHT",
          hintStyle: "APPROACH_NUDGE",
          rescueMode: "conceptual_rescue",
          hintGranularity: "conceptual",
          hintCost: 1.2,
          hintInitiator: "candidate_request",
          hintRequestTiming: "early",
          momentumAtHint: "fragile",
        },
      },
      {
        eventType: "HINT_SERVED",
        payloadJson: {
          hintLevel: "STRONG",
          hintStyle: "IMPLEMENTATION_NUDGE",
          rescueMode: "implementation_rescue",
          hintGranularity: "near_solution",
          hintCost: 4.05,
          hintInitiator: "system_rescue",
          hintRequestTiming: "mid",
          momentumAtHint: "stalled",
        },
      },
    ]);

    expect(ledger.totalHints).toBe(2);
    expect(ledger.totalHintCost).toBe(5.25);
    expect(ledger.averageHintCost).toBe(2.63);
    expect(ledger.strongestHintLevel).toBe("STRONG");
    expect(ledger.strongestHintTier).toBe("L3_SOLUTION");
    expect(ledger.byGranularity.near_solution).toBe(1);
    expect(ledger.byRescueMode.implementation_rescue).toBe(1);
    expect(ledger.byTier.L3_SOLUTION).toBe(1);
    expect(ledger.byInitiator.candidate_request).toBe(1);
    expect(ledger.byRequestTiming.early).toBe(1);
    expect(ledger.byMomentumAtHint.stalled).toBe(1);
  });

  it("maps stuck implementation turns into implementation rescue", () => {
    const rescue = resolveRescueMode({
      currentStage: "IMPLEMENTATION",
      hintStyle: "IMPLEMENTATION_NUDGE",
      recentFailedRuns: 0,
      signals: {
        understanding: "clear",
        progress: "stuck",
        communication: "clear",
        codeQuality: "partial",
        algorithmChoice: "reasonable",
        edgeCaseAwareness: "partial",
        behavior: "structured",
        confidence: 0.8,
        evidence: [],
        structuredEvidence: [],
        summary: "Implementation stalled.",
        reasoningDepth: "moderate",
        testingDiscipline: "partial",
        complexityRigor: "moderate",
        readyToCode: true,
      },
    });

    expect(rescue).toBe("implementation_rescue");
  });
});
