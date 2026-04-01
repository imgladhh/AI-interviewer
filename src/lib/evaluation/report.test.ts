import { describe, expect, it } from "vitest";
import { generateSessionReport } from "@/lib/evaluation/report";

describe("generateSessionReport", () => {
  it("includes candidate state, interviewer decision, and stage replay evidence", () => {
    const report = generateSessionReport({
      sessionId: "session-1",
      questionTitle: "Top K Frequent Elements",
      targetLevel: "SDE2",
      selectedLanguage: "python",
      transcripts: [
        { speaker: "USER", text: "First I would count frequencies with a hash map." },
        { speaker: "AI", text: "Walk me through the tradeoff." },
        { speaker: "USER", text: "Then I would use a min heap of size k and test empty input too." },
      ],
      events: [
        { eventType: "STAGE_ADVANCED", payloadJson: { stage: "APPROACH_DISCUSSION" } },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            stage: "APPROACH_DISCUSSION",
            signals: {
              understanding: "clear",
              progress: "progressing",
              communication: "clear",
              codeQuality: "partial",
              algorithmChoice: "strong",
              edgeCaseAwareness: "present",
              behavior: "structured",
              reasoningDepth: "deep",
              testingDiscipline: "strong",
              complexityRigor: "strong",
              confidence: 0.82,
              evidence: ["Candidate named a hash map and a heap."],
              structuredEvidence: [
                {
                  area: "complexity",
                  issue: "Complexity analysis is still incomplete.",
                  behavior: "The candidate named an approach without finishing the tradeoff story.",
                  evidence: "The explanation named the data structures but not the final cost tradeoff.",
                  impact: "This leaves the final performance story incomplete.",
                  fix: "Close with explicit time and space complexity plus one tradeoff.",
                },
              ],
              summary: "Understanding is clear and the candidate is progressing with a strong algorithm choice.",
              trendSummary: "Recent state trend: progress moved from partial to progressing.",
            },
          },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            stage: "APPROACH_DISCUSSION",
            decision: {
              action: "encourage_and_continue",
              target: "implementation",
              question: "Go ahead and implement it.",
              reason: "The direction is strong enough to code.",
              confidence: 0.84,
            },
          },
        },
        { eventType: "HINT_SERVED", payloadJson: { hintLevel: "LIGHT", hintStyle: "APPROACH_NUDGE" } },
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "PASSED" } },
      ],
      executionRuns: [{ status: "PASSED", stdout: "[1,2]" }],
    });

    const reportJson = report.reportJson as Record<string, unknown>;
    const dimensions = report.dimensions;
    const stageReplay = reportJson.stageReplay as Array<Record<string, unknown>>;

    expect(reportJson.candidateState).toBeTruthy();
    expect(reportJson.latestDecision).toBeTruthy();
    expect(Array.isArray(stageReplay)).toBe(true);
    expect(stageReplay.length).toBeGreaterThan(0);
    expect(stageReplay[0]?.evidence).toBeTruthy();
    expect(stageReplay[0]?.decisions).toBeTruthy();
    expect(dimensions.some((dimension) => Boolean(dimension.issue))).toBe(true);
    expect(dimensions.some((dimension) => Boolean(dimension.impact))).toBe(true);
    expect(dimensions.some((dimension) => Array.isArray(dimension.improvement) && dimension.improvement.length > 0)).toBe(true);
    expect((reportJson.candidateState as Record<string, unknown>).reasoningDepth).toBe("deep");
    expect(
      Array.isArray((reportJson.candidateState as Record<string, unknown>).structuredEvidence),
    ).toBe(true);
  });

  it("groups replay evidence around stage, signals, decisions, and code runs", () => {
    const report = generateSessionReport({
      sessionId: "session-2",
      questionTitle: "Merge Intervals",
      transcripts: [
        { speaker: "USER", text: "I would sort first and then merge overlaps." },
        { speaker: "AI", text: "What edge cases would you test?" },
      ],
      events: [
        { eventType: "STAGE_ADVANCED", payloadJson: { previousStage: "PROBLEM_UNDERSTANDING", stage: "APPROACH_DISCUSSION", reason: "clarified constraints" } },
        { eventType: "STAGE_ADVANCED", payloadJson: { previousStage: "APPROACH_DISCUSSION", stage: "TESTING_AND_COMPLEXITY", reason: "passing run" } },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            stage: "TESTING_AND_COMPLEXITY",
            signals: {
              understanding: "clear",
              progress: "done",
              communication: "clear",
              codeQuality: "correct",
              algorithmChoice: "reasonable",
              edgeCaseAwareness: "partial",
              behavior: "structured",
              reasoningDepth: "moderate",
              testingDiscipline: "partial",
              complexityRigor: "missing",
              confidence: 0.88,
              evidence: ["Candidate reached a passing run."],
              summary: "The candidate reached testing with a working implementation.",
            },
          },
        },
        {
          eventType: "DECISION_RECORDED",
          payloadJson: {
            stage: "TESTING_AND_COMPLEXITY",
            decision: {
              action: "ask_for_complexity",
              target: "complexity",
              question: "Give me the final time and space complexity.",
              reason: "The solution looks complete.",
              confidence: 0.9,
            },
          },
        },
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "PASSED" } },
      ],
      executionRuns: [{ status: "PASSED", stdout: "ok" }],
    });

    const stageReplay = (report.reportJson as Record<string, unknown>).stageReplay as Array<Record<string, unknown>>;
    const testingGroup = stageReplay.find((group) => group.stage === "Testing And Complexity");

    expect(testingGroup).toBeTruthy();
    expect(JSON.stringify(testingGroup)).toMatch(/Signal snapshot|Decision: ask_for_complexity|Code run result: PASSED/i);
  });

  it("includes hint cost and rescue metadata in the report summary", () => {
    const report = generateSessionReport({
      sessionId: "session-3",
      questionTitle: "Two Sum",
      transcripts: [
        { speaker: "USER", text: "I got stuck implementing the hashmap update." },
        { speaker: "AI", text: "Try focusing on the lookup before insert order." },
      ],
      events: [
        { eventType: "HINT_REQUESTED", payloadJson: { source: "candidate" } },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            stage: "IMPLEMENTATION",
            signals: {
              understanding: "clear",
              progress: "stuck",
              communication: "clear",
              codeQuality: "buggy",
              algorithmChoice: "reasonable",
              edgeCaseAwareness: "partial",
              behavior: "structured",
              reasoningDepth: "thin",
              testingDiscipline: "partial",
              complexityRigor: "moderate",
              confidence: 0.78,
              summary: "The candidate understands the approach but stalled in implementation.",
            },
          },
        },
        {
          eventType: "HINT_SERVED",
          payloadJson: {
            stage: "IMPLEMENTATION",
            hintLevel: "STRONG",
            hintStyle: "IMPLEMENTATION_NUDGE",
            rescueMode: "implementation_rescue",
            hintGranularity: "near_solution",
            hintCost: 4.05,
          },
        },
      ],
      executionRuns: [],
    });

    const reportJson = report.reportJson as Record<string, unknown>;
    const hintSummary = reportJson.hintSummary as Record<string, unknown>;

    expect(hintSummary.totalHintCost).toBe(4.05);
    expect(hintSummary.strongestHintLevel).toBe("STRONG");
    expect(hintSummary.penaltyApplied).toBeGreaterThan(0);
    expect((hintSummary.byRescueMode as Record<string, number>).implementation_rescue).toBe(1);
    expect(report.overallScore).toBeLessThan(100);
    expect(report.weaknesses.some((item) => item.includes("Hint reliance"))).toBe(true);
    expect(report.improvementPlan.some((item) => item.includes("code-level rescue"))).toBe(true);
  });
});
