import { describe, expect, it } from "vitest";
import { buildSessionSnapshotState } from "@/lib/session/state";

describe("buildSessionSnapshotState", () => {
  it("prefers persisted snapshots over event replay for latest state", () => {
    const state = buildSessionSnapshotState({
      currentStage: "IMPLEMENTATION",
      events: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              progress: "stuck",
              structuredEvidence: [],
              summary: "event state",
            },
          },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            decision: {
              action: "ask_for_clarification",
              target: "reasoning",
            },
          },
        },
      ],
      candidateStateSnapshots: [
        {
          id: "snap-1",
          stage: "WRAP_UP",
          source: "gemini",
          snapshotJson: {
            progress: "done",
            understanding: "clear",
            communication: "clear",
            structuredEvidence: [],
            summary: "snapshot state",
          },
          createdAt: new Date("2026-04-02T20:00:00.000Z"),
        },
      ],
      interviewerDecisionSnapshots: [
        {
          id: "dec-1",
          stage: "WRAP_UP",
          source: "gemini",
          decisionJson: {
            action: "move_to_wrap_up",
            target: "summary",
          },
          createdAt: new Date("2026-04-02T20:00:01.000Z"),
        },
      ],
      executionRuns: [{ status: "PASSED", stdout: "ok", stderr: "" }],
    });

    expect(state.latestSignals?.summary).toBe("snapshot state");
    expect(state.latestDecision?.action).toBe("move_to_wrap_up");
    expect(state.signalSnapshots).toHaveLength(1);
    expect(state.decisionSnapshots).toHaveLength(1);
  });
});
