import { readFile } from "node:fs/promises";
import path from "node:path";
import { calculateUnifiedScore } from "@/lib/scoring/calculateUnifiedScore";
import type { ScoringEvidence, UnifiedLevel, UnifiedVerdict } from "@/lib/scoring/types";

export type RealCalibrationTargetLevel = "Mid-level" | "Senior" | "Staff";

export type RealCalibrationLabel = {
  id: string;
  source: string;
  expected: {
    level: RealCalibrationTargetLevel;
    verdict: UnifiedVerdict;
  };
  scoringInput: ScoringEvidence;
  notes?: string;
};

export type RealCalibrationEvaluation = {
  total: number;
  matchedLevel: number;
  matchedVerdict: number;
  levelAccuracy: number;
  verdictAccuracy: number;
  confusionByLevel: Array<{
    expected: RealCalibrationTargetLevel;
    predicted: RealCalibrationTargetLevel;
    count: number;
  }>;
  confusionByVerdict: Array<{
    expected: UnifiedVerdict;
    predicted: UnifiedVerdict;
    count: number;
  }>;
  perSample: Array<{
    id: string;
    source: string;
    expectedLevel: RealCalibrationTargetLevel;
    predictedLevel: RealCalibrationTargetLevel;
    expectedVerdict: UnifiedVerdict;
    predictedVerdict: UnifiedVerdict;
    matchLevel: boolean;
    matchVerdict: boolean;
    confidence: number;
    cappedLevel: UnifiedLevel;
  }>;
};

export async function loadRealCalibrationLabelsFromJsonl(filePath: string): Promise<RealCalibrationLabel[]> {
  const absolutePath = path.resolve(filePath);
  const raw = await readFile(absolutePath, "utf8");
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const labels: RealCalibrationLabel[] = [];
  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid JSONL at line ${index + 1}: ${(error as Error).message}`);
    }
    labels.push(assertRealCalibrationLabel(parsed, index + 1));
  }
  return labels;
}

export function evaluateRealCalibrationLabels(labels: RealCalibrationLabel[]): RealCalibrationEvaluation {
  const perSample: RealCalibrationEvaluation["perSample"] = labels.map((label) => {
    const result = calculateUnifiedScore(label.scoringInput);
    const predictedLevel = mapUnifiedLevelToTargetLevel(result.cappedLevel);
    const predictedVerdict = result.verdict;
    return {
      id: label.id,
      source: label.source,
      expectedLevel: label.expected.level,
      predictedLevel,
      expectedVerdict: label.expected.verdict,
      predictedVerdict,
      matchLevel: predictedLevel === label.expected.level,
      matchVerdict: predictedVerdict === label.expected.verdict,
      confidence: result.confidence,
      cappedLevel: result.cappedLevel,
    };
  });

  const matchedLevel = perSample.filter((item) => item.matchLevel).length;
  const matchedVerdict = perSample.filter((item) => item.matchVerdict).length;
  const total = perSample.length;

  const levelConfusion = new Map<string, number>();
  const verdictConfusion = new Map<string, number>();
  for (const row of perSample) {
    const levelKey = `${row.expectedLevel}=>${row.predictedLevel}`;
    levelConfusion.set(levelKey, (levelConfusion.get(levelKey) ?? 0) + 1);

    const verdictKey = `${row.expectedVerdict}=>${row.predictedVerdict}`;
    verdictConfusion.set(verdictKey, (verdictConfusion.get(verdictKey) ?? 0) + 1);
  }

  return {
    total,
    matchedLevel,
    matchedVerdict,
    levelAccuracy: total > 0 ? round2(matchedLevel / total) : 0,
    verdictAccuracy: total > 0 ? round2(matchedVerdict / total) : 0,
    confusionByLevel: [...levelConfusion.entries()].map(([key, count]) => {
      const [expected, predicted] = key.split("=>") as [RealCalibrationTargetLevel, RealCalibrationTargetLevel];
      return { expected, predicted, count };
    }),
    confusionByVerdict: [...verdictConfusion.entries()].map(([key, count]) => {
      const [expected, predicted] = key.split("=>") as [UnifiedVerdict, UnifiedVerdict];
      return { expected, predicted, count };
    }),
    perSample,
  };
}

export function mapUnifiedLevelToTargetLevel(level: UnifiedLevel): RealCalibrationTargetLevel {
  if (level === "L6") {
    return "Staff";
  }
  if (level === "L5" || level === "L4") {
    return "Senior";
  }
  return "Mid-level";
}

function assertRealCalibrationLabel(value: unknown, lineNumber: number): RealCalibrationLabel {
  const record = asRecord(value);
  const id = stringOrThrow(record.id, `line ${lineNumber}: "id" is required`);
  const source = stringOrThrow(record.source, `line ${lineNumber}: "source" is required`);
  const expected = asRecord(record.expected);
  const expectedLevel = expected.level;
  const expectedVerdict = expected.verdict;
  if (expectedLevel !== "Mid-level" && expectedLevel !== "Senior" && expectedLevel !== "Staff") {
    throw new Error(`line ${lineNumber}: expected.level must be Mid-level|Senior|Staff`);
  }
  if (
    expectedVerdict !== "NO_HIRE" &&
    expectedVerdict !== "BORDERLINE" &&
    expectedVerdict !== "HIRE" &&
    expectedVerdict !== "STRONG_HIRE"
  ) {
    throw new Error(`line ${lineNumber}: expected.verdict must be a valid unified verdict`);
  }

  const scoringInput = record.scoringInput;
  if (!isScoringInput(scoringInput)) {
    throw new Error(`line ${lineNumber}: scoringInput is missing required fields`);
  }

  return {
    id,
    source,
    expected: {
      level: expectedLevel,
      verdict: expectedVerdict,
    },
    scoringInput,
    notes: typeof record.notes === "string" ? record.notes : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringOrThrow(value: unknown, message: string) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(message);
}

function isScoringInput(value: unknown): value is ScoringEvidence {
  const record = asRecord(value);
  return (
    Array.isArray(record.signals) &&
    typeof record.gapState === "object" &&
    record.gapState !== null &&
    Array.isArray(record.pivots) &&
    Array.isArray(record.noiseTags) &&
    typeof record.metadata === "object" &&
    record.metadata !== null &&
    Array.isArray(record.decisionTrace)
  );
}

function round2(value: number) {
  return Number(value.toFixed(2));
}
