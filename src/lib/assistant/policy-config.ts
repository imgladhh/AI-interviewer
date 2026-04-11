export type PolicyArchetype = "bar_raiser" | "collaborative" | "speed_demon" | "educator";

export interface PolicyIntentBias extends Record<string, number> {
  validate: number;
  probe: number;
  guide: number;
  pressure: number;
  unblock: number;
  close: number;
}

export interface PolicyPressureSchedule extends Record<string, string> {
  initial: "soft" | "neutral";
  clarification: "soft" | "neutral" | "challenging";
  coding: "neutral" | "challenging";
  testing: "neutral" | "surgical";
  wrapUp: "soft" | "neutral";
}

export interface PolicyThresholds extends Record<string, number> {
  stuckTurnLimit: number;
  interruptionCostMin: number;
  evidenceSaturation: number;
}

export interface PolicyPacingConfig extends Record<string, number> {
  preferLetRun: number;
  closeTopicAggression: number;
  moveToImplementationBias: number;
}

export interface PolicyHintsConfig extends Record<string, number> {
  delayFactor: number;
  maxHintLevel: number;
  rescueModeBias: number;
}

export interface PolicyScoreWeights extends Record<string, unknown> {
  need: number;
  timing: number;
  value: number;
  closure: number;
  proposalBias: number;
  temporalProbeDecay: number;
  temporalIdleProbeBoost: number;
  temporalCodingInterruptionPenalty: number;
  actionBias: {
    Probe: number;
    Guide: number;
    Unblock: number;
    Advance: number;
    Close: number;
    Hold: number;
  };
}

export interface PolicyConfig extends Record<string, unknown> {
  archetype: PolicyArchetype;
  intentBias: PolicyIntentBias;
  pressureSchedule: PolicyPressureSchedule;
  thresholds: PolicyThresholds;
  pacing: PolicyPacingConfig;
  hints: PolicyHintsConfig;
  scoreWeights: PolicyScoreWeights;
}

export const POLICY_PRESETS: Record<PolicyArchetype, PolicyConfig> = {
  bar_raiser: {
    archetype: "bar_raiser",
    intentBias: { validate: 0.8, probe: 1, guide: 0.35, pressure: 0.9, unblock: 0.45, close: 0.55 },
    pressureSchedule: {
      initial: "neutral",
      clarification: "challenging",
      coding: "challenging",
      testing: "surgical",
      wrapUp: "neutral",
    },
    thresholds: {
      stuckTurnLimit: 2,
      interruptionCostMin: 2,
      evidenceSaturation: 3,
    },
    pacing: {
      preferLetRun: 0.35,
      closeTopicAggression: 0.75,
      moveToImplementationBias: 0.45,
    },
    hints: {
      delayFactor: 1.2,
      maxHintLevel: 1,
      rescueModeBias: 0.3,
    },
    scoreWeights: {
      need: 1.05,
      timing: 0.95,
      value: 1.1,
      closure: 1.0,
      proposalBias: 0.9,
      temporalProbeDecay: 1.2,
      temporalIdleProbeBoost: 1.1,
      temporalCodingInterruptionPenalty: 0.95,
      actionBias: {
        Probe: 0.16,
        Guide: -0.05,
        Unblock: -0.04,
        Advance: -0.03,
        Close: 0.02,
        Hold: -0.06,
      },
    },
  },
  collaborative: {
    archetype: "collaborative",
    intentBias: { validate: 0.55, probe: 0.6, guide: 0.9, pressure: 0.35, unblock: 0.85, close: 0.5 },
    pressureSchedule: {
      initial: "soft",
      clarification: "neutral",
      coding: "neutral",
      testing: "neutral",
      wrapUp: "soft",
    },
    thresholds: {
      stuckTurnLimit: 3,
      interruptionCostMin: 3,
      evidenceSaturation: 3,
    },
    pacing: {
      preferLetRun: 0.8,
      closeTopicAggression: 0.45,
      moveToImplementationBias: 0.85,
    },
    hints: {
      delayFactor: 0.8,
      maxHintLevel: 2,
      rescueModeBias: 0.75,
    },
    scoreWeights: {
      need: 0.95,
      timing: 1.15,
      value: 0.92,
      closure: 1.0,
      proposalBias: 1.05,
      temporalProbeDecay: 1.0,
      temporalIdleProbeBoost: 0.9,
      temporalCodingInterruptionPenalty: 1.15,
      actionBias: {
        Probe: -0.06,
        Guide: 0.12,
        Unblock: 0.06,
        Advance: 0.04,
        Close: -0.02,
        Hold: 0.08,
      },
    },
  },
  speed_demon: {
    archetype: "speed_demon",
    intentBias: { validate: 0.45, probe: 0.55, guide: 0.35, pressure: 0.7, unblock: 0.25, close: 1 },
    pressureSchedule: {
      initial: "neutral",
      clarification: "neutral",
      coding: "challenging",
      testing: "surgical",
      wrapUp: "neutral",
    },
    thresholds: {
      stuckTurnLimit: 2,
      interruptionCostMin: 2,
      evidenceSaturation: 2,
    },
    pacing: {
      preferLetRun: 0.55,
      closeTopicAggression: 0.95,
      moveToImplementationBias: 0.9,
    },
    hints: {
      delayFactor: 1.3,
      maxHintLevel: 1,
      rescueModeBias: 0.2,
    },
    scoreWeights: {
      need: 1.0,
      timing: 0.88,
      value: 1.08,
      closure: 1.2,
      proposalBias: 0.92,
      temporalProbeDecay: 1.1,
      temporalIdleProbeBoost: 1.0,
      temporalCodingInterruptionPenalty: 0.82,
      actionBias: {
        Probe: 0.03,
        Guide: -0.08,
        Unblock: -0.1,
        Advance: 0.12,
        Close: 0.15,
        Hold: -0.12,
      },
    },
  },
  educator: {
    archetype: "educator",
    intentBias: { validate: 0.55, probe: 0.4, guide: 1, pressure: 0.2, unblock: 0.95, close: 0.4 },
    pressureSchedule: {
      initial: "soft",
      clarification: "soft",
      coding: "neutral",
      testing: "neutral",
      wrapUp: "soft",
    },
    thresholds: {
      stuckTurnLimit: 3,
      interruptionCostMin: 3,
      evidenceSaturation: 4,
    },
    pacing: {
      preferLetRun: 0.7,
      closeTopicAggression: 0.35,
      moveToImplementationBias: 0.75,
    },
    hints: {
      delayFactor: 0.7,
      maxHintLevel: 3,
      rescueModeBias: 0.95,
    },
    scoreWeights: {
      need: 0.9,
      timing: 1.1,
      value: 0.9,
      closure: 0.92,
      proposalBias: 1.1,
      temporalProbeDecay: 0.9,
      temporalIdleProbeBoost: 0.85,
      temporalCodingInterruptionPenalty: 1.08,
      actionBias: {
        Probe: -0.08,
        Guide: 0.15,
        Unblock: 0.14,
        Advance: 0.03,
        Close: -0.06,
        Hold: 0.1,
      },
    },
  },
};

export function getPolicyPreset(archetype: PolicyArchetype): PolicyConfig {
  return POLICY_PRESETS[archetype];
}
