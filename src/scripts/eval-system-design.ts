import { writeFile } from "node:fs/promises";
import { evaluateSystemDesignRegressionHealth, runSystemDesignRegressionLab } from "@/lib/assistant/policy-regression";
import {
  evaluateSystemDesignCalibrationPack,
  summarizeSystemDesignCalibrationPack,
} from "@/lib/evaluation/system-design-calibration";

type EvalPayload = {
  generatedAt: string;
  calibration: ReturnType<typeof evaluateSystemDesignCalibrationPack>;
  calibrationCoverage: ReturnType<typeof summarizeSystemDesignCalibrationPack>;
  regression: {
    reports: ReturnType<typeof runSystemDesignRegressionLab>;
    health: ReturnType<typeof evaluateSystemDesignRegressionHealth>;
  };
};

function parseArgs(argv: string[]) {
  const outIndex = argv.findIndex((item) => item === "--out");
  const outPath =
    outIndex >= 0 && outIndex + 1 < argv.length ? argv[outIndex + 1] : null;
  return { outPath };
}

async function main() {
  const { outPath } = parseArgs(process.argv.slice(2));
  const calibration = evaluateSystemDesignCalibrationPack();
  const calibrationCoverage = summarizeSystemDesignCalibrationPack();
  const reports = runSystemDesignRegressionLab();
  const health = evaluateSystemDesignRegressionHealth(reports);

  const payload: EvalPayload = {
    generatedAt: new Date().toISOString(),
    calibration,
    calibrationCoverage,
    regression: {
      reports,
      health,
    },
  };

  const json = JSON.stringify(payload, null, 2);
  if (outPath) {
    await writeFile(outPath, json, "utf8");
    console.log(`wrote system-design evaluation to ${outPath}`);
    return;
  }
  console.log(json);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
