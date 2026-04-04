import { describe, expect, it } from "vitest";
import { summarizeSessionCritic } from "@/lib/assistant/session_critic";

describe("summarizeSessionCritic", () => {
  it("captures balanced timing and closure when the critic defers optional interruptions and closes cleanly", () => {
    const summary = summarizeSessionCritic({
      latestSignals: {
        reasoningDepth: "deep",
      },
      events: [
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              pressure: "neutral",
              target: "implementation",
            },
          },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              pressure: "challenging",
              target: "summary",
            },
          },
        },
        {
          eventType: "CRITIC_VERDICT_RECORDED",
          payloadJson: {
            criticVerdict: {
              timingVerdict: "defer",
              interruptionCost: "high",
              verdict: "move_on",
              reason: "poor_timing",
            },
          },
        },
        {
          eventType: "CRITIC_VERDICT_RECORDED",
          payloadJson: {
            criticVerdict: {
              timingVerdict: "skip",
              verdict: "close_topic",
              reason: "evidence_saturated",
            },
          },
        },
      ],
    });

    expect(summary.redundancyScore).toBeGreaterThan(0);
    expect(summary.interruptionScore).toBeGreaterThan(0);
    expect(summary.pressureBalance).toBe("good");
    expect(summary.closureQuality).toBe("good");
    expect(Array.isArray(summary.notes)).toBe(true);
  });

  it("flags harsh, poorly timed sessions with weak closure", () => {
    const summary = summarizeSessionCritic({
      events: [
        ...Array.from({ length: 5 }, (_, index) => ({
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              pressure: index < 4 ? "surgical" : "challenging",
              target: "correctness",
            },
          },
        })),
        ...Array.from({ length: 3 }, () => ({
          eventType: "CRITIC_VERDICT_RECORDED",
          payloadJson: {
            criticVerdict: {
              reason: "poor_timing",
              interruptionCost: "high",
              verdict: "rewrite",
            },
          },
        })),
      ],
    });

    expect(summary.pressureBalance).toBe("too_harsh");
    expect(summary.flowPreservation).toBe("poor");
    expect(summary.timingQuality).toBe("poor");
    expect(summary.closureQuality).toBe("poor");
    expect(summary.notes.length).toBeGreaterThan(0);
  });
});
