import { describe, expect, it } from "vitest";
import { adjudicateScore, mapUnifiedLevelToReportLevel } from "@/lib/scoring/adjudicate-score";
import type { ScoringEvidence } from "@/lib/scoring/types";

function scoringEvidence(overrides: Partial<ScoringEvidence> = {}): ScoringEvidence {
  return {
    signals: [
      { key: "requirement_missing", missing: false },
      { key: "capacity_missing", missing: false },
      { key: "tradeoff_missed", missing: false },
      { key: "spof_missed", missing: false },
      { key: "bottleneck_unexamined", missing: false },
    ],
    gapState: {
      missing_capacity: false,
      missing_tradeoff: false,
      missing_reliability: false,
      missing_bottleneck: false,
    },
    pivots: [],
    noiseTags: [],
    metadata: { stage: "DEEP_DIVE", targetLevel: "SENIOR" },
    decisionTrace: [],
    ...overrides,
  };
}

describe("adjudicateScore", () => {
  it("uses the capped unified level as the single report-level authority", () => {
    const adjudication = adjudicateScore(
      scoringEvidence({
        signals: [
          { key: "requirement_missing", missing: false },
          { key: "capacity_missing", missing: true },
          { key: "tradeoff_missed", missing: false },
          { key: "spof_missed", missing: false },
          { key: "bottleneck_unexamined", missing: false },
        ],
        gapState: {
          missing_capacity: true,
          missing_tradeoff: false,
          missing_reliability: false,
          missing_bottleneck: false,
        },
        pivots: [{ turnId: "t-1", triggerAction: "NONE", impactScore: 1 }],
      }),
    );

    expect(adjudication.reportLevel).toBe(mapUnifiedLevelToReportLevel(adjudication.cappedLevel));
    expect(adjudication.candidateFacingVerdict).toBe(adjudication.scoredVerdict);
    expect(adjudication.appliedCaps).toContain("capacity_instinct");
  });

  it("keeps Phase A in shadow mode without activating evidence refusal", () => {
    const adjudication = adjudicateScore(
      scoringEvidence({
        signals: [],
        gapState: {
          missing_capacity: true,
          missing_tradeoff: true,
          missing_reliability: true,
          missing_bottleneck: true,
        },
      }),
    );

    expect(adjudication.decisionabilityMode).toBe("shadow");
    expect(adjudication.status).toBe("FINAL");
    expect(adjudication.candidateFacingVerdict).toBe(adjudication.scoredVerdict);
  });

  it("maps unified levels to the report vocabulary deterministically", () => {
    expect(mapUnifiedLevelToReportLevel("L3")).toBe("Mid-level");
    expect(mapUnifiedLevelToReportLevel("L4")).toBe("Senior");
    expect(mapUnifiedLevelToReportLevel("L5")).toBe("Senior");
    expect(mapUnifiedLevelToReportLevel("L6")).toBe("Staff");
  });
});
