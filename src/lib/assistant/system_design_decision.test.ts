import { describe, expect, it } from "vitest";
import { makeSystemDesignDecision } from "@/lib/assistant/system_design_decision";
import type { CandidateSignalSnapshot, DesignSignals } from "@/lib/assistant/signal_extractor";

function createSnapshot(signals: DesignSignals): CandidateSignalSnapshot {
  return {
    understanding: "clear",
    progress: "progressing",
    communication: "clear",
    codeQuality: "partial",
    algorithmChoice: "reasonable",
    edgeCaseAwareness: "partial",
    behavior: "structured",
    readyToCode: false,
    reasoningDepth: "moderate",
    testingDiscipline: "partial",
    complexityRigor: "partial",
    confidence: 0.82,
    evidence: [],
    structuredEvidence: [],
    summary: "system design test snapshot",
    designSignals: {
      signals,
      evidenceRefs: {
        requirement_missing: [],
        capacity_missing: [],
        tradeoff_missed: [],
        spof_missed: [],
        bottleneck_unexamined: [],
      },
      summary: "design signal test",
    },
  };
}

describe("makeSystemDesignDecision level adaptation", () => {
  it("keeps expectations lighter for new grad level once core scope and capacity are present", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "REFINEMENT",
      targetLevel: "NEW_GRAD",
      signals: createSnapshot({
        requirement_missing: false,
        capacity_missing: false,
        tradeoff_missed: true,
        spof_missed: false,
        bottleneck_unexamined: true,
      }),
    });

    expect(["WRAP_UP", "CHALLENGE_SPOF", "ZOOM_IN", "PROBE_TRADEOFF"]).toContain(decision.systemDesignActionType);
    expect(decision.action).not.toBe("move_to_implementation");
  });

  it("keeps deep-dive pressure high for senior and staff when deep signals are still missing", () => {
    const signalSet = createSnapshot({
      requirement_missing: false,
      capacity_missing: false,
      tradeoff_missed: true,
      spof_missed: true,
      bottleneck_unexamined: true,
    });

    const senior = makeSystemDesignDecision({
      currentStage: "DEEP_DIVE",
      targetLevel: "SENIOR",
      signals: signalSet,
    });
    const staff = makeSystemDesignDecision({
      currentStage: "DEEP_DIVE",
      targetLevel: "STAFF",
      signals: signalSet,
    });

    expect(["PROBE_TRADEOFF", "CHALLENGE_SPOF", "ZOOM_IN"]).toContain(senior.systemDesignActionType);
    expect(["PROBE_TRADEOFF", "CHALLENGE_SPOF", "ZOOM_IN"]).toContain(staff.systemDesignActionType);
    expect(senior.systemDesignActionType).not.toBe("WRAP_UP");
    expect(staff.systemDesignActionType).not.toBe("WRAP_UP");
  });

  it("uses balanced behavior for SDE2 by still allowing targeted deep probes", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "REFINEMENT",
      targetLevel: "SDE2",
      signals: createSnapshot({
        requirement_missing: false,
        capacity_missing: false,
        tradeoff_missed: true,
        spof_missed: false,
        bottleneck_unexamined: false,
      }),
    });

    expect(["PROBE_TRADEOFF", "WRAP_UP"]).toContain(decision.systemDesignActionType);
  });

  it("boosts probing actions when stage-aware handwave is detected", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "DEEP_DIVE",
      targetLevel: "SDE2",
      signals: {
        ...createSnapshot({
          requirement_missing: false,
          capacity_missing: false,
          tradeoff_missed: true,
          spof_missed: false,
          bottleneck_unexamined: false,
        }),
        designSignals: {
          signals: {
            requirement_missing: false,
            capacity_missing: false,
            tradeoff_missed: true,
            spof_missed: false,
            bottleneck_unexamined: false,
          },
          evidenceRefs: {
            requirement_missing: [],
            capacity_missing: [],
            tradeoff_missed: [],
            spof_missed: [],
            bottleneck_unexamined: [],
          },
          summary: "handwavey deep dive",
          handwave: {
            detected: true,
            depth: 0.3,
            expectedDepth: 0.9,
            categories: ["tradeoff_evasion", "unquantified_scaling_claim"],
            evidenceRefs: ["depth gap"],
          },
        },
      },
    });

    expect(["PROBE_TRADEOFF", "ASK_CAPACITY"]).toContain(decision.systemDesignActionType);
  });

  it("applies inertia to keep previous action stable when scores are close", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "DEEP_DIVE",
      targetLevel: "SDE2",
      previousActionType: "PROBE_TRADEOFF",
      signals: createSnapshot({
        requirement_missing: false,
        capacity_missing: false,
        tradeoff_missed: true,
        spof_missed: true,
        bottleneck_unexamined: false,
      }),
    });

    expect(decision.systemDesignActionType).toBe("PROBE_TRADEOFF");
    expect((decision.scoreBreakdown ?? []).some((item) => item.key === "stability_inertia")).toBe(true);
  });

  it("applies hysteresis when a new action is not decisively better than previous action", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "DEEP_DIVE",
      targetLevel: "SDE2",
      previousActionType: "PROBE_TRADEOFF",
      signals: createSnapshot({
        requirement_missing: false,
        capacity_missing: false,
        tradeoff_missed: true,
        spof_missed: true,
        bottleneck_unexamined: false,
      }),
    });

    expect((decision.scoreBreakdown ?? []).some((item) => item.key === "stability_hysteresis" || item.key === "stability_inertia")).toBe(true);
  });

  it("forces ASK_CAPACITY in deep stages when capacity is missing and no explicit assumption is provided", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "DEEP_DIVE",
      targetLevel: "SENIOR",
      signals: createSnapshot({
        requirement_missing: false,
        capacity_missing: true,
        tradeoff_missed: true,
        spof_missed: false,
        bottleneck_unexamined: false,
      }),
      recentTranscripts: [{ speaker: "USER", text: "We can scale horizontally across regions." }],
    });

    expect(decision.systemDesignActionType).toBe("ASK_CAPACITY");
    expect((decision.scoreBreakdown ?? []).some((item) => item.key === "causal_capacity_override")).toBe(true);
  });

  it("allows progress when an explicit scoped assumption is stated", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "DEEP_DIVE",
      targetLevel: "SENIOR",
      signals: createSnapshot({
        requirement_missing: false,
        capacity_missing: true,
        tradeoff_missed: true,
        spof_missed: false,
        bottleneck_unexamined: false,
      }),
      recentTranscripts: [
        {
          speaker: "USER",
          text: "Assume 30k qps reads and 3k qps writes for now across two regions; with that, I would compare replication vs partitioning tradeoffs.",
        },
      ],
    });

    expect(["PROBE_TRADEOFF", "ZOOM_IN", "CHALLENGE_SPOF"]).toContain(decision.systemDesignActionType);
    expect((decision.scoreBreakdown ?? []).some((item) => item.key === "causal_capacity_override")).toBe(false);
  });

  it("routes by reliability gap to challenge SPOF when reliability remains missing", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "DEEP_DIVE",
      targetLevel: "SDE2",
      signals: createSnapshot({
        requirement_missing: false,
        capacity_missing: false,
        tradeoff_missed: false,
        spof_missed: true,
        bottleneck_unexamined: false,
      }),
    });

    expect(decision.systemDesignActionType).toBe("CHALLENGE_SPOF");
  });

  it("forces deeper follow-up after repeated low-detail streak instead of wrapping up", () => {
    const decision = makeSystemDesignDecision({
      currentStage: "WRAP_UP",
      targetLevel: "SDE2",
      signals: {
        ...createSnapshot({
          requirement_missing: false,
          capacity_missing: false,
          tradeoff_missed: true,
          spof_missed: false,
          bottleneck_unexamined: false,
        }),
        designSignals: {
          signals: {
            requirement_missing: false,
            capacity_missing: false,
            tradeoff_missed: true,
            spof_missed: false,
            bottleneck_unexamined: false,
          },
          evidenceRefs: {
            requirement_missing: [],
            capacity_missing: [],
            tradeoff_missed: [],
            spof_missed: [],
            bottleneck_unexamined: [],
          },
          summary: "low detail streak",
          handwave: {
            detected: true,
            depth: 0.28,
            rawDepth: 0.48,
            expectedDepth: 0.4,
            vagueLanguageDecay: 1.7,
            components: {
              numeric_density: 0,
              constraint_binding: 0.24,
              causal_chain: 0.24,
              specificity: 0,
            },
            lowDetailStreak: 2,
            forceDeeperAction: true,
            categories: ["tradeoff_evasion"],
            evidenceRefs: ["depth streak"],
          },
        },
      },
    });

    expect(decision.systemDesignActionType).toBe("PROBE_TRADEOFF");
    expect((decision.scoreBreakdown ?? []).some((item) => item.key === "depth_streak_force_deeper")).toBe(true);
  });
});
