import { describe, expect, it } from "vitest";
import { decideInterviewerIntent } from "@/lib/assistant/interviewer_intent";
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
  confidence: 0.75,
  evidence: ["Candidate explained the approach."],
  structuredEvidence: [],
  summary: "Candidate is progressing with a workable solution.",
  trendSummary: "Candidate state is broadly stable.",
};

describe("decideInterviewerIntent", () => {
  it("chooses advance when the candidate is ready to code", () => {
    const signals = { ...baseSignals, readyToCode: true };
    const ledger = buildMemoryLedger({
      currentStage: "APPROACH_DISCUSSION",
      recentEvents: [],
      signals,
      latestExecutionRun: null,
    });

    const intent = decideInterviewerIntent({
      currentStage: "APPROACH_DISCUSSION",
      signals,
      memory: ledger,
      latestExecutionRun: null,
    });

    expect(intent.intent).toBe("advance");
    expect(intent.expectedOutcome).toBe("advance_stage");
  });

  it("chooses close when the summary topic is saturated", () => {
    const ledger = buildMemoryLedger({
      currentStage: "WRAP_UP",
      recentEvents: [
        { eventType: "DECISION_RECORDED", payloadJson: { decision: { target: "summary", action: "move_to_wrap_up" } } },
      ],
      signals: { ...baseSignals, progress: "done" },
      latestExecutionRun: { status: "PASSED" },
    });

    const intent = decideInterviewerIntent({
      currentStage: "WRAP_UP",
      signals: { ...baseSignals, progress: "done" },
      memory: ledger,
      latestExecutionRun: { status: "PASSED" },
    });

    expect(intent.intent).toBe("close");
    expect(intent.expectedOutcome).toBe("close_topic");
  });
});
