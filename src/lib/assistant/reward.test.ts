import { describe, expect, it } from "vitest";
import { evaluateTurnReward } from "@/lib/assistant/reward";

describe("evaluateTurnReward", () => {
  it("rewards evidence gain when the decision targets implementation detail", () => {
    const reward = evaluateTurnReward({
      stage: "IMPLEMENTATION",
      decision: {
        action: "ask_followup",
        target: "implementation_detail",
        urgency: "high",
        interruptionCost: "low",
      },
      recentEvents: [],
    });

    expect(reward.version).toBe("v1");
    expect(reward.evidenceGainByAxis.implementation).toBe(1);
    expect(reward.components.evidenceGain).toBeGreaterThan(0);
    expect(reward.total).toBeGreaterThan(0);
  });

  it("penalizes repeated decision targets and interruption mistakes", () => {
    const reward = evaluateTurnReward({
      stage: "IMPLEMENTATION",
      decision: {
        action: "ask_followup",
        target: "testing",
        urgency: "low",
        interruptionCost: "high",
      },
      criticVerdict: {
        shouldWaitBeforeIntervening: true,
        wouldLikelySelfCorrect: true,
      },
      recentEvents: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              target: "testing",
            },
          },
        },
      ],
    });

    expect(reward.components.redundancy).toBeLessThan(0);
    expect(reward.components.badInterruption).toBeLessThan(0);
    expect(reward.penalties).toContain("repeated_target");
    expect(reward.penalties).toContain("interrupted_when_should_wait");
    expect(reward.total).toBeLessThan(0.1);
  });

  it("rewards clean closure in wrap-up", () => {
    const reward = evaluateTurnReward({
      stage: "WRAP_UP",
      decision: {
        action: "close_topic",
        target: "summary",
      },
      recentEvents: [],
    });

    expect(reward.components.cleanClosure).toBeGreaterThan(0);
    expect(reward.penalties).not.toContain("reopened_wrap_up");
  });

  it("penalizes ignoring echo events when no recovery mode is used", () => {
    const reward = evaluateTurnReward({
      stage: "APPROACH_DISCUSSION",
      decision: {
        action: "ask_followup",
        target: "reasoning",
      },
      recentEvents: [{ eventType: "CANDIDATE_ECHO_DETECTED" }],
    });

    expect(reward.penalties).toContain("echo_ignored");
    expect(reward.components.flowPreservation).toBeLessThanOrEqual(0);
  });

  it("adds system design reward components and attribution metadata", () => {
    const reward = evaluateTurnReward({
      stage: "DEEP_DIVE",
      decision: {
        action: "probe_tradeoff",
        target: "tradeoff",
        systemDesignActionType: "PROBE_TRADEOFF",
        urgency: "high",
      },
      recentEvents: [],
      originTurnId: "seg-sd-1",
    });

    expect(reward.components.tradeoffDepth).toBeGreaterThan(0);
    expect(Array.isArray(reward.designEvidenceTypes)).toBe(true);
    expect(reward.designEvidenceTypes).toContain("tradeoff");
    expect(reward.attribution.originTurnId).toBe("seg-sd-1");
    expect(typeof reward.attribution.breakdown.tradeoffDepth).toBe("number");
  });

  it("distinguishes deep system design follow-up from generic handwave follow-up", () => {
    const recentEvents = [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          signals: {
            designSignals: {
              signals: {
                requirement_missing: false,
                capacity_missing: false,
                tradeoff_missed: true,
                spof_missed: false,
                bottleneck_unexamined: false,
              },
            },
          },
        },
      },
    ];

    const deepFollowup = evaluateTurnReward({
      stage: "DEEP_DIVE",
      decision: {
        action: "probe_tradeoff",
        target: "tradeoff",
        systemDesignActionType: "PROBE_TRADEOFF",
        urgency: "high",
      },
      recentEvents,
      originTurnId: "seg-sd-2",
    });

    const genericFollowup = evaluateTurnReward({
      stage: "DEEP_DIVE",
      decision: {
        action: "encourage_and_continue",
        target: "approach",
        systemDesignActionType: "ZOOM_IN",
        urgency: "high",
      },
      recentEvents,
      originTurnId: "seg-sd-3",
    });

    expect(deepFollowup.total).toBeGreaterThan(genericFollowup.total);
    expect(deepFollowup.components.tradeoffDepth).toBeGreaterThan(0);
    expect(genericFollowup.components.handwavePenalty).toBeLessThan(0);
    expect(genericFollowup.penalties).toContain("handwave_detected");
  });

  it("applies handwave penalty when design snapshot explicitly marks stage-depth handwave", () => {
    const reward = evaluateTurnReward({
      stage: "DEEP_DIVE",
      decision: {
        action: "ask_followup",
        target: "approach",
        systemDesignActionType: "ZOOM_IN",
        urgency: "high",
      },
      recentEvents: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              designSignals: {
                signals: {
                  requirement_missing: false,
                  capacity_missing: false,
                  tradeoff_missed: true,
                  spof_missed: false,
                  bottleneck_unexamined: true,
                },
                handwave: {
                  detected: true,
                  depth: 0.3,
                  expectedDepth: 0.9,
                  categories: ["tradeoff_evasion"],
                },
              },
            },
          },
        },
      ],
    });

    expect(reward.components.handwavePenalty).toBeLessThan(0);
    expect(reward.penalties).toContain("handwave_detected");
  });

  it("adds pivot impact when hint-led design progress unlocks a new dimension", () => {
    const reward = evaluateTurnReward({
      stage: "DEEP_DIVE",
      decision: {
        action: "probe_tradeoff",
        target: "tradeoff",
        systemDesignActionType: "PROBE_TRADEOFF",
      },
      recentEvents: [
        {
          eventType: "HINT_SERVED",
          payloadJson: { hintLevel: "L1_AREA" },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: { decision: { target: "requirement", systemDesignActionType: "ASK_REQUIREMENT" } },
        },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              designSignals: {
                signals: {
                  requirement_missing: true,
                  capacity_missing: true,
                  tradeoff_missed: true,
                  spof_missed: true,
                  bottleneck_unexamined: true,
                },
              },
            },
          },
        },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              designSignals: {
                signals: {
                  requirement_missing: false,
                  capacity_missing: true,
                  tradeoff_missed: true,
                  spof_missed: true,
                  bottleneck_unexamined: true,
                },
              },
            },
          },
        },
      ],
    });

    expect(reward.components.pivotImpact).toBeGreaterThan(0);
  });

  it("excludes handwave and pivot signals from reward shaping when turn is noise-tagged", () => {
    const reward = evaluateTurnReward({
      stage: "DEEP_DIVE",
      decision: {
        action: "encourage_and_continue",
        target: "approach",
        systemDesignActionType: "ZOOM_IN",
      },
      recentEvents: [
        {
          eventType: "AI_INTERRUPTED_BY_CANDIDATE",
          payloadJson: {},
        },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              designSignals: {
                signals: {
                  requirement_missing: false,
                  capacity_missing: false,
                  tradeoff_missed: true,
                  spof_missed: false,
                  bottleneck_unexamined: true,
                },
                handwave: {
                  detected: true,
                  categories: ["tradeoff_evasion", "unquantified_scaling_claim"],
                  lowDetailStreak: 3,
                },
              },
            },
          },
        },
        {
          eventType: "HINT_SERVED",
          payloadJson: { hintLevel: "L1_AREA" },
        },
      ],
    });

    expect(reward.noiseTags).toContain("INTERRUPTED_TURN");
    expect(reward.components.handwavePenalty).toBe(0);
    expect(reward.components.pivotImpact).toBe(0);
  });
});
