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
    expect(snapshot.readyToCode).toBe(true);
    expect(snapshot.reasoningDepth).toBe("deep");
  });

  it("marks readyToCode when the candidate already described the implementation loop and return condition", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "We can use a hash table while iterating the array. For each number x, we check whether target - x already exists, and if so we return both indices; otherwise we store the current index.",
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.readyToCode).toBe(true);
    expect(snapshot.evidence.join(" ")).toMatch(/ready to start coding|implementation steps/i);
  });

  it("marks readyToCode when the candidate explicitly says they are ready to implement", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "The hash map approach is clear and I am ready to implement it now. We can revisit correctness after coding.",
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.readyToCode).toBe(true);
    expect(snapshot.evidence.join(" ")).toMatch(/explicitly said they are ready to implement/i);
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
    expect(snapshot.testingDiscipline).toBe("strong");
  });

  it("marks thin reasoning and missing complexity rigor when the candidate only names a vague idea", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [{ speaker: "USER", text: "Maybe sort it and then return the answer." }],
      latestExecutionRun: null,
    });

    expect(snapshot.reasoningDepth).toBe("thin");
    expect(snapshot.complexityRigor).toBe("missing");
    expect(snapshot.structuredEvidence.some((item) => item.area === "reasoning")).toBe(true);
  });

  it("records invariant evidence when the candidate explains the plan without a correctness invariant", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "First I build a hash map and then I iterate again to collect the answer, because that is faster than brute force.",
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.reasoningDepth).toBe("moderate");
    expect(
      snapshot.structuredEvidence.some(
        (item) =>
          item.area === "correctness" &&
          /invariant/i.test(item.issue),
      ),
    ).toBe(true);
  });

  it("records shallow tradeoff evidence when complexity is named without comparison", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "The time complexity is O(n log k) and the space complexity is O(k).",
        },
      ],
      latestExecutionRun: {
        status: "PASSED",
      },
    });

    expect(snapshot.complexityRigor).toBe("partial");
    expect(
      snapshot.structuredEvidence.some(
        (item) =>
          item.area === "complexity" &&
          /tradeoff/i.test(item.issue),
      ),
    ).toBe(true);
  });

  it("records narrow boundary coverage when testing is mentioned without enough breadth", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "I would also test one edge case before finishing.",
        },
      ],
      latestExecutionRun: {
        status: "PASSED",
      },
    });

    expect(snapshot.edgeCaseAwareness).toBe("partial");
    expect(
      snapshot.structuredEvidence.some(
        (item) =>
          item.area === "edge_case" &&
          /boundary coverage/i.test(item.issue),
      ),
    ).toBe(true);
  });

  it("records proof-sketch evidence when the candidate gives intuition without a full correctness argument", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "The invariant is that the left side stays sorted, and that should make the idea work, because we keep moving the pointer forward.",
        },
      ],
      latestExecutionRun: null,
    });

    expect(
      snapshot.structuredEvidence.some(
        (item) =>
          item.area === "correctness" &&
          /proof sketch|intuition/i.test(item.issue),
      ),
    ).toBe(true);
  });

  it("records imprecise expected-output evidence when tests are named without exact outcomes", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "I would test empty input and duplicates before wrapping up.",
        },
      ],
      latestExecutionRun: {
        status: "PASSED",
      },
    });

    expect(snapshot.testingDiscipline).toBe("partial");
    expect(
      snapshot.structuredEvidence.some(
        (item) =>
          item.area === "testing" &&
          /expected outputs stayed imprecise/i.test(item.issue),
      ),
    ).toBe(true);
  });

  it("records constraint-justification evidence when the tradeoff is named but not justified", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "This uses more memory, but the runtime is O(n log k), which is the tradeoff here.",
        },
      ],
      latestExecutionRun: {
        status: "PASSED",
      },
    });

    expect(
      snapshot.structuredEvidence.some(
        (item) =>
          item.area === "complexity" &&
          /constraints/i.test(item.issue),
      ),
    ).toBe(true);
  });

  it("adds a trend summary when recent signal snapshots show state change", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "TESTING_AND_COMPLEXITY",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "I would test empty input and duplicates, and the final time complexity is O(n log k) with O(k) extra space.",
        },
      ],
      recentEvents: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              progress: "progressing",
              codeQuality: "partial",
              edgeCaseAwareness: "missing",
              reasoningDepth: "moderate",
              testingDiscipline: "missing",
              complexityRigor: "missing",
            },
          },
        },
      ],
      latestExecutionRun: {
        status: "PASSED",
      },
    });

    expect(snapshot.trendSummary).toMatch(/progress moved|testing discipline moved|complexity rigor changed/i);
  });

  it("lowers confidence when recent signal history strongly disagrees with the current snapshot", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "IMPLEMENTATION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "I think I am stuck again and I am not sure the logic is right.",
        },
      ],
      recentEvents: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              understanding: "clear",
              progress: "done",
              reasoningDepth: "deep",
              testingDiscipline: "strong",
              complexityRigor: "strong",
            },
          },
        },
      ],
      latestExecutionRun: {
        status: "ERROR",
        stderr: "TypeError",
      },
    });

    expect(snapshot.confidence).toBeLessThan(0.5);
  });
});

