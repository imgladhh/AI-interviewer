import { calculateUnifiedScore } from "@/lib/scoring/calculateUnifiedScore";
import type {
  ReportLevel,
  ScoreAdjudication,
  ScoringEvidence,
  UnifiedLevel,
} from "@/lib/scoring/types";

export function adjudicateScore(evidence: ScoringEvidence): ScoreAdjudication {
  const result = calculateUnifiedScore(evidence);

  return {
    schemaVersion: 1,
    scoringVersion: "unified-v1",
    decisionabilityMode: "shadow",
    // Phase A only establishes one level authority. Evidence-sufficiency
    // classification remains disabled until the Phase B calibration review.
    status: "FINAL",
    reportLevel: mapUnifiedLevelToReportLevel(result.cappedLevel),
    rawLevel: result.rawLevel,
    cappedLevel: result.cappedLevel,
    scoredVerdict: result.verdict,
    candidateFacingVerdict: result.verdict,
    confidence: result.confidence,
    appliedCaps: [...result.appliedCaps],
    blockingReasons: [],
    result,
  };
}

export function mapUnifiedLevelToReportLevel(level: UnifiedLevel): ReportLevel {
  if (level === "L6") {
    return "Staff";
  }
  if (level === "L5" || level === "L4") {
    return "Senior";
  }
  return "Mid-level";
}
