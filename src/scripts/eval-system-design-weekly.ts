import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

function buildCurrentSnapshot(): SystemDesignWeeklySnapshot {
  const calibration = evaluateSystemDesignCalibrationPack();
  const coverage = summarizeSystemDesignCalibrationPack();
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
    generatedAt: new Date().toISOString(),
    calibration: {
      total: calibration.total,
      matched: calibration.matched,
      accuracy: calibration.accuracy,
    },
    calibrationCoverage: coverage,
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
  const current = buildCurrentSnapshot();
  const drift = buildSystemDesignDriftReport({
    current,
    previous,
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  const dateKey = current.generatedAt.slice(0, 10);
  const datedPath = path.join(OUTPUT_DIR, `snapshot-${dateKey}.json`);
  await writeFile(
    datedPath,
    JSON.stringify(
      {
        snapshot: current,
        drift,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(LATEST_PATH, JSON.stringify(current, null, 2), "utf8");

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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
