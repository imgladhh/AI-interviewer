import { describe, expect, it } from "vitest";
import { extractCandidateSignals } from "@/lib/assistant/signal_extractor";

describe("extractCandidateSignals", () => {
  it("marks a candidate as stuck and buggy after repeated failures", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "IMPLEMENTATION",
      recentTranscripts: [
        { speaker: "USER", text: "I am stuck. I think the map logic is wrong and I need help." },
      ],
      recentEvents: [
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "FAILED" } },
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "ERROR" } },
      ],
      latestExecutionRun: {
        status: "ERROR",
        stderr: "IndexError",
      },
    });

    expect(snapshot.progress).toBe("stuck");
    expect(snapshot.codeQuality).toBe("buggy");
    expect(snapshot.evidence.join(" ")).toMatch(/failed runs|help/i);
  });

  it("recognizes strong algorithm signals and structured communication", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "First I would build a hash map of counts, then use a min heap to keep only the top k entries, and finally read out the result.",
        },
        {
          speaker: "USER",
          text: "On an example like [1,1,1,2,2,3], the heap never grows past k, so the runtime stays better than sorting everything.",
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.algorithmChoice).toBe("strong");
    expect(snapshot.communication).toBe("clear");
    expect(snapshot.behavior).toBe("structured");
  });

  it("marks edge-case awareness as present when boundary conditions are named", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "I would test empty input, a single element array, and duplicates before wrapping up the complexity discussion.",
        },
      ],
      latestExecutionRun: {
        status: "PASSED",
      },
    });

    expect(snapshot.edgeCaseAwareness).toBe("present");
    expect(snapshot.progress).toBe("done");
  });
});
