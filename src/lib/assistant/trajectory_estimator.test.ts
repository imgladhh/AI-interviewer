import { describe, expect, it } from "vitest";
import { estimateCandidateTrajectory } from "@/lib/assistant/trajectory_estimator";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
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
  confidence: 0.78,
  evidence: ["Candidate explained the approach."],
  structuredEvidence: [],
  summary: "Candidate is progressing with a workable solution.",
  trendSummary: "Candidate state is broadly stable.",
};

describe("estimateCandidateTrajectory", () => {
  it("prefers no intervention when coding flow is healthy", () => {
    const ledger = buildMemoryLedger({
      currentStage: "IMPLEMENTATION",
      recentEvents: [],
      signals: { ...baseSignals, readyToCode: true },
      latestExecutionRun: null,
    });

    const trajectory = estimateCandidateTrajectory({
      currentStage: "IMPLEMENTATION",
      signals: { ...baseSignals, readyToCode: true },
      memory: ledger,
      latestExecutionRun: null,
      flowState: {
        codingBurst: true,
        thinkingBurst: false,
        muteUntilPause: true,
        contextReestablishmentCost: "high",
      },
      intent: {
        intent: "advance",
        targetSignal: "implementation",
        reason: "Enough evidence is already present.",
        expectedOutcome: "advance_stage",
        canDefer: false,
        urgency: "high",
      },
    });

    expect(trajectory.candidateTrajectory).toBe("steady_progress");
    expect(trajectory.bestIntervention).toBe("move_to_implementation");
    expect(trajectory.interruptionCost).toBe("high");
  });

  it("raises intervention value when repeated failures are accumulating", () => {
    const ledger = buildMemoryLedger({
      currentStage: "DEBUGGING",
      recentEvents: [
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "FAILED" } },
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "ERROR" } },
      ],
      signals: { ...baseSignals, progress: "stuck", codeQuality: "buggy" },
      latestExecutionRun: { status: "ERROR", stderr: "IndexError" },
    });

    const trajectory = estimateCandidateTrajectory({
      currentStage: "DEBUGGING",
      signals: { ...baseSignals, progress: "stuck", codeQuality: "buggy" },
      memory: ledger,
      latestExecutionRun: { status: "ERROR", stderr: "IndexError" },
      flowState: {
        codingBurst: false,
        thinkingBurst: false,
        muteUntilPause: false,
        contextReestablishmentCost: "low",
      },
      intent: {
        intent: "unblock",
        targetSignal: "debugging",
        reason: "Repeated failing runs are blocking progress.",
        expectedOutcome: "unlock_progress",
        canDefer: false,
        urgency: "high",
      },
    });

    expect(["stuck", "collapsing"]).toContain(trajectory.candidateTrajectory);
    expect(trajectory.interventionValue).toBe("high");
    expect(["ask_specific_followup", "give_rescue_hint"]).toContain(trajectory.bestIntervention);
  });

  it("treats editor rewrite churn as a weak struggling signal", () => {
    const ledger = buildMemoryLedger({
      currentStage: "IMPLEMENTATION",
      recentEvents: [],
      signals: { ...baseSignals, readyToCode: true },
      latestExecutionRun: null,
    });

    const trajectory = estimateCandidateTrajectory({
      currentStage: "IMPLEMENTATION",
      signals: { ...baseSignals, readyToCode: true },
      memory: ledger,
      latestExecutionRun: null,
      recentEvents: [
        {
          eventType: "EDITOR_ACTIVITY_RECORDED",
          payloadJson: {
            activeCoding: true,
            deletionRatio: 0.34,
            pauseMs: 2600,
            editCount: 7,
          },
        },
      ],
      flowState: {
        codingBurst: false,
        thinkingBurst: false,
        muteUntilPause: false,
        contextReestablishmentCost: "medium",
      },
      intent: {
        intent: "guide",
        targetSignal: "implementation",
        reason: "Telemetry hints at some hesitation.",
        expectedOutcome: "unlock_progress",
        canDefer: true,
        urgency: "medium",
      },
    });

    expect(["plateauing", "stuck"]).toContain(trajectory.candidateTrajectory);
    expect(trajectory.interruptionCost).toBe("high");
    expect(trajectory.weakSignalNotes?.length).toBeGreaterThan(0);
  });
});
