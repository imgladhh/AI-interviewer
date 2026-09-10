import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateRealCalibrationLabels,
  loadRealCalibrationLabelsFromJsonl,
  mapUnifiedLevelToTargetLevel,
} from "@/lib/evaluation/system-design-real-calibration";
import type { RealCalibrationLabel } from "@/lib/evaluation/system-design-real-calibration";

const SAMPLE_RECORDS: RealCalibrationLabel[] = [
  {
    id: "real-001",
    source: "internal_mock",
    expected: {
      level: "Senior",
      verdict: "HIRE",
    },
    scoringInput: {
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
      pivots: [{ turnId: "t1", triggerAction: "LIGHT", impactScore: 0.52 }],
      noiseTags: [],
      metadata: {
        stage: "DEEP_DIVE",
        targetLevel: "SENIOR",
      },
      decisionTrace: [{ turnId: "d1", action: "probe_tradeoff", rescueMode: "none" }],
    },
  },
  {
    id: "real-002",
    source: "internal_mock",
    expected: {
      level: "Mid-level",
      verdict: "NO_HIRE",
    },
    scoringInput: {
      signals: [
        { key: "requirement_missing", missing: true },
        { key: "capacity_missing", missing: true },
        { key: "tradeoff_missed", missing: true },
        { key: "spof_missed", missing: true },
        { key: "bottleneck_unexamined", missing: true },
      ],
      gapState: {
        missing_capacity: true,
        missing_tradeoff: true,
        missing_reliability: true,
        missing_bottleneck: true,
      },
      pivots: [],
      noiseTags: [],
      metadata: {
        stage: "CAPACITY",
        targetLevel: "SDE2",
      },
      decisionTrace: [{ turnId: "d2", action: "ask_capacity", rescueMode: "heavy_rescue" }],
    },
  },
];

describe("system design real calibration dataset", () => {
  it("loads JSONL labels with required fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sd-real-cal-"));
    const filePath = path.join(dir, "dataset.jsonl");
    const lines = SAMPLE_RECORDS.map((item) => JSON.stringify(item)).join("\n");
    await writeFile(filePath, lines, "utf8");

    const labels = await loadRealCalibrationLabelsFromJsonl(filePath);
    expect(labels.length).toBe(2);
    expect(labels[0]?.id).toBe("real-001");
    expect(labels[1]?.expected.level).toBe("Mid-level");
  });

  it("evaluates level/verdict agreement and confusion matrix", () => {
    const evaluated = evaluateRealCalibrationLabels(SAMPLE_RECORDS);
    expect(evaluated.total).toBe(2);
    expect(evaluated.matchedLevel).toBeGreaterThanOrEqual(0);
    expect(evaluated.matchedVerdict).toBeGreaterThanOrEqual(0);
    expect(evaluated.levelAccuracy).toBeGreaterThanOrEqual(0);
    expect(evaluated.verdictAccuracy).toBeGreaterThanOrEqual(0);
    expect(evaluated.perSample.length).toBe(2);
    expect(evaluated.confusionByLevel.length).toBeGreaterThan(0);
    expect(evaluated.confusionByVerdict.length).toBeGreaterThan(0);
  });

  it("maps unified levels into target level buckets", () => {
    expect(mapUnifiedLevelToTargetLevel("L3")).toBe("Mid-level");
    expect(mapUnifiedLevelToTargetLevel("L4")).toBe("Senior");
    expect(mapUnifiedLevelToTargetLevel("L5")).toBe("Senior");
    expect(mapUnifiedLevelToTargetLevel("L6")).toBe("Staff");
  });
});
