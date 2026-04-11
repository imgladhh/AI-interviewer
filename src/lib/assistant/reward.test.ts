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
});
