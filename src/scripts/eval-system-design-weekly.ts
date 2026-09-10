import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { access } from "node:fs/promises";
import {
  evaluateSystemDesignRegressionHealth,
  evaluateSystemDesignRegressionStability,
  runSystemDesignRegressionLab,
} from "@/lib/assistant/policy-regression";
import {
  evaluateSystemDesignCalibrationPack,
  summarizeSystemDesignCalibrationPack,
} from "@/lib/evaluation/system-design-calibration";
import {
  evaluateRealCalibrationLabels,
  loadRealCalibrationLabelsFromJsonl,
} from "@/lib/evaluation/system-design-real-calibration";
import {
  buildSystemDesignDriftReport,
  type SystemDesignWeeklySnapshot,
} from "@/lib/evaluation/system-design-drift";

const OUTPUT_DIR = path.join(process.cwd(), "docs", "metrics", "system-design-weekly");
const LATEST_PATH = path.join(OUTPUT_DIR, "latest.json");

async function tryReadPreviousSnapshot(): Promise<SystemDesignWeeklySnapshot | null> {
  try {
    const raw = await readFile(LATEST_PATH, "utf8");
    return JSON.parse(raw) as SystemDesignWeeklySnapshot;
  } catch {
    return null;
  }
}

async function buildCurrentSnapshotAsync(): Promise<SystemDesignWeeklySnapshot> {
  const calibration = evaluateSystemDesignCalibrationPack();
  const coverage = summarizeSystemDesignCalibrationPack();
  const realDatasetPath = path.join(process.cwd(), "data", "system-design-calibration", "real-transcripts.jsonl");
  const hasRealDataset = await hasFile(realDatasetPath);
  const realCalibration = hasRealDataset
    ? evaluateRealCalibrationLabels(await loadRealCalibrationLabelsFromJsonl(realDatasetPath))
    : null;
  const lab = runSystemDesignRegressionLab();
  const reports = lab.map((item) => ({
    scenarioId: item.scenarioId,
    expectationMet: item.expectationMet,
    scoreDiffFromBest: item.scoreDiffFromBest,
    rewardDiffFromBest: item.rewardDiffFromBest,
  }));
  const health = evaluateSystemDesignRegressionHealth(lab);
  const stability = evaluateSystemDesignRegressionStability();

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    calibration: {
      total: calibration.total,
      matched: calibration.matched,
      accuracy: calibration.accuracy,
    },
    calibrationCoverage: coverage,
    ...(realCalibration
      ? {
          realCalibration: {
            total: realCalibration.total,
            levelAccuracy: realCalibration.levelAccuracy,
            verdictAccuracy: realCalibration.verdictAccuracy,
          },
        }
      : {}),
    regression: {
      health,
      stability: {
        replayCount: stability.replayCount,
        scenarioCount: stability.scenarioCount,
        maxScoreVariance: stability.maxScoreVariance,
        maxRewardVariance: stability.maxRewardVariance,
        expectationFlipCount: stability.expectationFlipCount,
        summary: stability.summary,
      },
      reports,
    },
  };
}

async function main() {
  const previous = await tryReadPreviousSnapshot();
  const current = await buildCurrentSnapshotAsync();
  const drift = buildSystemDesignDriftReport({
    current,
    previous,
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  const dateKey = current.generatedAt.slice(0, 10);
  const datedPath = path.join(OUTPUT_DIR, `snapshot-${dateKey}.json`);
  await writeAtomically(
    datedPath,
    JSON.stringify(
      {
        snapshot: current,
        drift,
      },
      null,
      2,
    ),
  );
  await writeAtomically(LATEST_PATH, JSON.stringify(current, null, 2));

  console.log(
    JSON.stringify(
      {
        output: datedPath,
        latest: LATEST_PATH,
        drift,
      },
      null,
      2,
    ),
  );
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function hasFile(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeAtomically(
  filePath: string,
  contents: string,
  renameFile: typeof rename = rename,
) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporaryPath, "w");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await renameFile(temporaryPath, filePath);
}
