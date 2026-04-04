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

  it("derives current stage and stage journey from persisted snapshots first", () => {
    const state = buildSessionSnapshotState({
      currentStage: "APPROACH_DISCUSSION",
      events: [
        {
          eventType: "STAGE_ADVANCED",
          payloadJson: {
            stage: "IMPLEMENTATION",
          },
        },
      ],
      candidateStateSnapshots: [
        {
          id: "snap-1",
          stage: "IMPLEMENTATION",
          source: "gemini",
          snapshotJson: {
            progress: "progressing",
            structuredEvidence: [],
          },
          createdAt: new Date("2026-04-02T20:00:00.000Z"),
        },
        {
          id: "snap-2",
          stage: "TESTING_AND_COMPLEXITY",
          source: "gemini",
          snapshotJson: {
            progress: "done",
            structuredEvidence: [],
          },
          createdAt: new Date("2026-04-02T20:00:05.000Z"),
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
          createdAt: new Date("2026-04-02T20:00:08.000Z"),
        },
      ],
      executionRuns: [{ status: "PASSED", stdout: "ok", stderr: "" }],
    });

    expect(state.currentStage).toBe("WRAP_UP");
    expect(state.currentStageLabel).toBe("Wrap Up");
    expect(state.stageJourney).toEqual([
      "Implementation",
      "Testing and Complexity",
      "Wrap Up",
    ]);
  });

  it("surfaces latest intent and trajectory snapshots alongside signals and decisions", () => {
    const state = buildSessionSnapshotState({
      currentStage: "IMPLEMENTATION",
      events: [],
      candidateStateSnapshots: [
        {
          id: "snap-1",
          stage: "IMPLEMENTATION",
          source: "gemini",
          snapshotJson: {
            progress: "progressing",
            understanding: "clear",
            structuredEvidence: [],
          },
          createdAt: new Date("2026-04-02T20:00:00.000Z"),
        },
      ],
      interviewerDecisionSnapshots: [
        {
          id: "dec-1",
          stage: "IMPLEMENTATION",
          source: "gemini",
          decisionJson: {
            action: "encourage_and_continue",
            target: "implementation",
          },
          createdAt: new Date("2026-04-02T20:00:01.000Z"),
        },
      ],
      intentSnapshots: [
        {
          id: "intent-1",
          stage: "IMPLEMENTATION",
          source: "gemini",
          intentJson: {
            intent: "advance",
            targetSignal: "implementation",
            expectedOutcome: "advance_stage",
          },
          createdAt: new Date("2026-04-02T20:00:02.000Z"),
        },
      ],
      trajectorySnapshots: [
        {
          id: "traj-1",
          stage: "IMPLEMENTATION",
          source: "gemini",
          trajectoryJson: {
            candidateTrajectory: "steady_progress",
            bestIntervention: "none",
            interruptionCost: "high",
          },
          createdAt: new Date("2026-04-02T20:00:03.000Z"),
        },
      ],
      executionRuns: [{ status: "PASSED", stdout: "ok", stderr: "" }],
    });

    expect(state.latestIntent?.intent).toBe("advance");
    expect(state.latestTrajectory?.candidateTrajectory).toBe("steady_progress");
    expect(state.intentSnapshots).toHaveLength(1);
    expect(state.trajectorySnapshots).toHaveLength(1);
  });
});
