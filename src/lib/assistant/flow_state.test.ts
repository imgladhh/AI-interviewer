import { describe, expect, it } from "vitest";
import { assessFlowState } from "@/lib/assistant/flow_state";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

const baseSignals: CandidateSignalSnapshot = {
  understanding: "clear",
  progress: "progressing",
  communication: "clear",
  codeQuality: "partial",
  algorithmChoice: "reasonable",
  edgeCaseAwareness: "partial",
  behavior: "structured",
  readyToCode: true,
  reasoningDepth: "deep",
  testingDiscipline: "partial",
  complexityRigor: "moderate",
  confidence: 0.82,
  evidence: [],
  structuredEvidence: [],
  summary: "Candidate is in good flow.",
};

describe("assessFlowState", () => {
  it("detects coding bursts during implementation", () => {
    const result = assessFlowState({
      currentStage: "IMPLEMENTATION",
      signals: baseSignals,
      recentTranscripts: [{ speaker: "USER", text: "I'm updating the map, then checking the branch." }],
    });

    expect(result.codingBurst).toBe(true);
    expect(result.muteUntilPause).toBe(true);
    expect(result.contextReestablishmentCost).toBe("high");
  });

  it("detects thinking bursts during deep reasoning", () => {
    const result = assessFlowState({
      currentStage: "APPROACH_DISCUSSION",
      signals: baseSignals,
      recentTranscripts: [
        { speaker: "USER", text: "First I would keep the invariant that every seen number is mapped to its index." },
        { speaker: "USER", text: "Then once I reach the second number of a valid pair, I know the complement must already be stored." },
      ],
    });

    expect(result.thinkingBurst).toBe(true);
    expect(result.muteUntilPause).toBe(true);
  });
});
