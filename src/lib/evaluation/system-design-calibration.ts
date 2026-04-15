export type SystemDesignCalibrationLabel = {
  id: string;
  level: "Mid-level" | "Senior" | "Staff";
  hire: "NO_HIRE" | "BORDERLINE" | "HIRE" | "STRONG_HIRE";
  pivotMoments: number;
  dimensions: {
    requirement_clarity: number;
    capacity_instinct: number;
    tradeoff_depth: number;
    reliability_awareness: number;
    bottleneck_sensitivity: number;
  };
};

const CALIBRATION_SEEDS: Array<Omit<SystemDesignCalibrationLabel, "id">> = [
  {
    level: "Mid-level",
    hire: "NO_HIRE",
    pivotMoments: 0,
    dimensions: {
      requirement_clarity: 2.9,
      capacity_instinct: 2.4,
      tradeoff_depth: 2.2,
      reliability_awareness: 2.5,
      bottleneck_sensitivity: 2.3,
    },
  },
  {
    level: "Mid-level",
    hire: "BORDERLINE",
    pivotMoments: 0,
    dimensions: {
      requirement_clarity: 3.3,
      capacity_instinct: 2.9,
      tradeoff_depth: 2.8,
      reliability_awareness: 2.9,
      bottleneck_sensitivity: 2.8,
    },
  },
  {
    level: "Mid-level",
    hire: "HIRE",
    pivotMoments: 1,
    dimensions: {
      requirement_clarity: 3.7,
      capacity_instinct: 3.2,
      tradeoff_depth: 3.3,
      reliability_awareness: 3.2,
      bottleneck_sensitivity: 3.1,
    },
  },
  {
    level: "Mid-level",
    hire: "STRONG_HIRE",
    pivotMoments: 1,
    dimensions: {
      requirement_clarity: 4.0,
      capacity_instinct: 3.5,
      tradeoff_depth: 3.6,
      reliability_awareness: 3.5,
      bottleneck_sensitivity: 3.4,
    },
  },
  {
    level: "Senior",
    hire: "NO_HIRE",
    pivotMoments: 0,
    dimensions: {
      requirement_clarity: 3.4,
      capacity_instinct: 3.1,
      tradeoff_depth: 3.0,
      reliability_awareness: 3.1,
      bottleneck_sensitivity: 3.0,
    },
  },
  {
    level: "Senior",
    hire: "BORDERLINE",
    pivotMoments: 1,
    dimensions: {
      requirement_clarity: 3.8,
      capacity_instinct: 3.5,
      tradeoff_depth: 3.4,
      reliability_awareness: 3.5,
      bottleneck_sensitivity: 3.3,
    },
  },
  {
    level: "Senior",
    hire: "HIRE",
    pivotMoments: 1,
    dimensions: {
      requirement_clarity: 4.2,
      capacity_instinct: 3.9,
      tradeoff_depth: 3.8,
      reliability_awareness: 3.9,
      bottleneck_sensitivity: 3.7,
    },
  },
  {
    level: "Senior",
    hire: "STRONG_HIRE",
    pivotMoments: 2,
    dimensions: {
      requirement_clarity: 4.4,
      capacity_instinct: 4.1,
      tradeoff_depth: 4.1,
      reliability_awareness: 4.1,
      bottleneck_sensitivity: 3.9,
    },
  },
  {
    level: "Staff",
    hire: "NO_HIRE",
    pivotMoments: 1,
    dimensions: {
      requirement_clarity: 3.9,
      capacity_instinct: 3.7,
      tradeoff_depth: 3.3,
      reliability_awareness: 3.8,
      bottleneck_sensitivity: 3.6,
    },
  },
  {
    level: "Staff",
    hire: "BORDERLINE",
    pivotMoments: 1,
    dimensions: {
      requirement_clarity: 4.2,
      capacity_instinct: 4.0,
      tradeoff_depth: 3.9,
      reliability_awareness: 4.0,
      bottleneck_sensitivity: 3.9,
    },
  },
  {
    level: "Staff",
    hire: "HIRE",
    pivotMoments: 2,
    dimensions: {
      requirement_clarity: 4.5,
      capacity_instinct: 4.3,
      tradeoff_depth: 4.2,
      reliability_awareness: 4.4,
      bottleneck_sensitivity: 4.2,
    },
  },
  {
    level: "Staff",
    hire: "STRONG_HIRE",
    pivotMoments: 2,
    dimensions: {
      requirement_clarity: 4.7,
      capacity_instinct: 4.6,
      tradeoff_depth: 4.6,
      reliability_awareness: 4.6,
      bottleneck_sensitivity: 4.5,
    },
  },
];

const REPLICA_OFFSETS = [-0.15, -0.05, 0, 0.08, 0.15] as const;

export const SYSTEM_DESIGN_CALIBRATION_PACK: SystemDesignCalibrationLabel[] = buildCalibrationPack();

export function summarizeSystemDesignCalibrationPack(
  labels: SystemDesignCalibrationLabel[] = SYSTEM_DESIGN_CALIBRATION_PACK,
) {
  const byLevel: Record<SystemDesignCalibrationLabel["level"], number> = {
    "Mid-level": 0,
    Senior: 0,
    Staff: 0,
  };
  const byHire: Record<SystemDesignCalibrationLabel["hire"], number> = {
    NO_HIRE: 0,
    BORDERLINE: 0,
    HIRE: 0,
    STRONG_HIRE: 0,
  };
  for (const label of labels) {
    byLevel[label.level] += 1;
    byHire[label.hire] += 1;
  }
  return {
    total: labels.length,
    byLevel,
    byHire,
  };
}

export function evaluateSystemDesignCalibrationPack(
  labels: SystemDesignCalibrationLabel[] = SYSTEM_DESIGN_CALIBRATION_PACK,
) {
  const perSample = labels.map((label) => {
    const predicted = predictLevelFromDimensions(label.dimensions);
    return {
      id: label.id,
      expectedLevel: label.level,
      predictedLevel: predicted,
      match: predicted === label.level,
    };
  });

  const matches = perSample.filter((item) => item.match).length;
  const accuracy = labels.length > 0 ? Number((matches / labels.length).toFixed(2)) : 0;

  return {
    total: labels.length,
    matched: matches,
    accuracy,
    perSample,
  };
}

function predictLevelFromDimensions(dimensions: SystemDesignCalibrationLabel["dimensions"]) {
  const avg =
    (dimensions.requirement_clarity +
      dimensions.capacity_instinct +
      dimensions.tradeoff_depth +
      dimensions.reliability_awareness +
      dimensions.bottleneck_sensitivity) /
    5;

  let predicted: "Mid-level" | "Senior" | "Staff" = avg >= 4.2 ? "Staff" : avg >= 3.4 ? "Senior" : "Mid-level";
  if (predicted === "Staff" && dimensions.tradeoff_depth < 4) {
    predicted = "Senior";
  }
  if (predicted === "Staff" && dimensions.capacity_instinct < 4) {
    predicted = "Senior";
  }
  return predicted;
}

function buildCalibrationPack() {
  const labels: SystemDesignCalibrationLabel[] = [];
  let index = 1;

  for (const seed of CALIBRATION_SEEDS) {
    for (const offset of REPLICA_OFFSETS) {
      const variation = ((index % 3) - 1) * 0.03;
      labels.push({
        id: `sd-cal-${String(index).padStart(3, "0")}`,
        level: seed.level,
        hire: seed.hire,
        pivotMoments: Math.max(0, Math.min(3, seed.pivotMoments + (offset > 0.1 ? 1 : 0))),
        dimensions: {
          requirement_clarity: clampDimension(seed.dimensions.requirement_clarity + offset + variation),
          capacity_instinct: clampDimension(seed.dimensions.capacity_instinct + offset),
          tradeoff_depth: clampDimension(seed.dimensions.tradeoff_depth + offset - variation),
          reliability_awareness: clampDimension(seed.dimensions.reliability_awareness + offset),
          bottleneck_sensitivity: clampDimension(seed.dimensions.bottleneck_sensitivity + offset - variation),
        },
      });
      index += 1;
    }
  }

  return labels;
}

function clampDimension(value: number) {
  return Number(Math.min(5, Math.max(0, value)).toFixed(2));
}
