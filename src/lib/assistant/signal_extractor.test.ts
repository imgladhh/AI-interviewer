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
    expect(typeof snapshot.readyToCode).toBe("boolean");
    expect(["moderate", "deep"]).toContain(snapshot.reasoningDepth);
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

    expect(typeof snapshot.readyToCode).toBe("boolean");
    expect(snapshot.evidence.length).toBeGreaterThan(0);
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

    expect(typeof snapshot.readyToCode).toBe("boolean");
    expect(snapshot.evidence.length).toBeGreaterThan(0);
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

    expect(["partial", "strong"]).toContain(snapshot.complexityRigor);
    expect(snapshot.structuredEvidence.length).toBeGreaterThan(0);
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

    expect(["partial", "present"]).toContain(snapshot.edgeCaseAwareness);
    expect(snapshot.structuredEvidence.length).toBeGreaterThan(0);
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

    expect(["partial", "strong"]).toContain(snapshot.testingDiscipline);
    expect(snapshot.structuredEvidence.length).toBeGreaterThan(0);
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

    expect(snapshot.structuredEvidence.length).toBeGreaterThan(0);
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

  it("detects echo-like candidate turns when the user mostly repeats the interviewer question", () => {
    const snapshot = extractCandidateSignals({
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "AI",
          text: "What is your time and space complexity, and which tradeoff did you choose?",
        },
        {
          speaker: "USER",
          text: "What is your time and space complexity and which tradeoff did you choose?",
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.echoLikely).toBe(true);
    expect(snapshot.echoStrength).toMatch(/medium|high/);
    expect(snapshot.structuredEvidence.some((item) => /echoed the interviewer question/i.test(item.issue))).toBe(true);
  });

  it("extracts system design signals and evidence refs in system design mode", () => {
    const snapshot = extractCandidateSignals({
      mode: "SYSTEM_DESIGN",
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "The service must support post creation and timeline read APIs. Peak is around 20k qps with p99 under 250ms.",
        },
        {
          speaker: "USER",
          text: "Given 20k qps, we can shard by user id and add read replicas. Option A is fan-out on write, option B is fan-out on read; write is faster for reads but heavier on writes.",
        },
        {
          speaker: "USER",
          text: "A single region is a SPOF, so we should do multi-region failover. The main bottleneck is timeline fanout, we can use async queues and caching to optimize.",
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.designSignals?.signals.requirement_missing).toBe(false);
    expect(snapshot.designSignals?.signals.capacity_missing).toBe(false);
    expect(snapshot.designSignals?.signals.tradeoff_missed).toBe(false);
    expect(snapshot.designSignals?.signals.spof_missed).toBe(false);
    expect(snapshot.designSignals?.signals.bottleneck_unexamined).toBe(false);
    expect(snapshot.designSignals?.evidenceRefs.requirement_missing.length ?? 0).toBeGreaterThan(0);
  });

  it("flags handwave in deep dive when scaling claims are unquantified and component choices are not justified", () => {
    const snapshot = extractCandidateSignals({
      mode: "SYSTEM_DESIGN",
      systemDesignStage: "DEEP_DIVE",
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "We should use cache, queue, and sharding to handle massive scale globally.",
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.designSignals?.handwave?.detected).toBe(true);
    expect(snapshot.designSignals?.handwave?.categories).toContain("unquantified_scaling_claim");
    expect(snapshot.designSignals?.handwave?.categories).toContain("unjustified_component_choice");
  });

  it("does not over-penalize high-level stage when constraints and causal chain are present", () => {
    const snapshot = extractCandidateSignals({
      mode: "SYSTEM_DESIGN",
      systemDesignStage: "HIGH_LEVEL",
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text:
            "Latency and availability are the top constraints, and because read traffic dominates we place a cache in front of timeline reads to reduce DB pressure.",
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.designSignals?.handwave?.detected).toBe(false);
  });

  it("applies vague-language decay and increments low-detail streak for system design handwave v2", () => {
    const snapshot = extractCandidateSignals({
      mode: "SYSTEM_DESIGN",
      systemDesignStage: "DEEP_DIVE",
      currentStage: "APPROACH_DISCUSSION",
      recentTranscripts: [
        {
          speaker: "USER",
          text: "We probably should scale somehow with cache and queue, maybe it usually works.",
        },
      ],
      recentEvents: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            signals: {
              designSignals: {
                handwave: {
                  detected: true,
                },
              },
            },
          },
        },
      ],
      latestExecutionRun: null,
    });

    expect(snapshot.designSignals?.handwave?.vagueLanguageDecay).toBeGreaterThan(1);
    expect(snapshot.designSignals?.handwave?.lowDetailStreak).toBeGreaterThanOrEqual(2);
    expect(snapshot.designSignals?.handwave?.forceDeeperAction).toBe(true);
    expect(snapshot.designSignals?.gapState?.missing_tradeoff).toBe(true);
  });
});



