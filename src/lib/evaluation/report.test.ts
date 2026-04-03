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
    const evidenceTrace = reportJson.evidenceTrace as Array<Record<string, unknown>>;
    const candidateDna = reportJson.candidateDna as Record<string, unknown>;
    const momentsOfTruth = reportJson.momentsOfTruth as Array<Record<string, unknown>>;
    const rubricSummary = reportJson.rubricSummary as Array<Record<string, unknown>>;

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
    expect(Array.isArray((reportJson.candidateState as Record<string, unknown>).structuredEvidence)).toBe(true);
    expect(Array.isArray(evidenceTrace)).toBe(true);
    expect(evidenceTrace.length).toBeGreaterThan(0);
    expect(candidateDna.headline).toBeTruthy();
    expect(Array.isArray(candidateDna.traits)).toBe(true);
    expect(Array.isArray(candidateDna.strengths)).toBe(true);
    expect(Array.isArray(candidateDna.watchouts)).toBe(true);
    expect(Array.isArray(momentsOfTruth)).toBe(true);
    expect(momentsOfTruth.length).toBeGreaterThan(0);
    expect(Array.isArray(rubricSummary)).toBe(true);
    expect(rubricSummary.length).toBe(dimensions.length);
    expect(dimensions.some((dimension) => dimension.key === "independence")).toBe(true);
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
    const testingGroup = stageReplay.find((group) => /testing/i.test(String(group.stage ?? "")) || /ask_for_complexity|PASSED/i.test(JSON.stringify(group)));

    expect(testingGroup).toBeTruthy();
    expect(JSON.stringify(testingGroup)).toMatch(/Signal snapshot|Decision: ask_for_complexity|Code run result: PASSED/i);
  });

  it("rewards efficient low-rescue sessions and surfaces coachability in the report", () => {
    const report = generateSessionReport({
      sessionId: "session-4",
      questionTitle: "Two Sum",
      transcripts: [
        { speaker: "USER", text: "I can solve it in one pass with a hash map and I do not need a hint." },
      ],
      events: [
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            stage: "IMPLEMENTATION",
            signals: {
              understanding: "clear",
              progress: "done",
              communication: "clear",
              codeQuality: "correct",
              algorithmChoice: "strong",
              edgeCaseAwareness: "present",
              behavior: "structured",
              reasoningDepth: "deep",
              testingDiscipline: "strong",
              complexityRigor: "strong",
              confidence: 0.9,
              summary: "The candidate closed quickly with strong independent evidence.",
            },
          },
        },
        {
          eventType: "CRITIC_VERDICT_RECORDED",
          payloadJson: {
            criticVerdict: {
              autoCapturedEvidence: ["complexity_tradeoff"],
            },
          },
        },
      ],
      executionRuns: [{ status: "PASSED", stdout: "ok" }],
    });

    const hintSummary = (report.reportJson as Record<string, unknown>).hintSummary as Record<string, unknown>;
    expect(hintSummary.totalHintCost).toBe(0);
    expect((hintSummary.efficiencyScore as number)).toBeGreaterThanOrEqual(90);
    expect(((hintSummary.coachability as Record<string, unknown>).label as string)).toMatch(/high|moderate/);
    expect(report.strengths.length + report.improvementPlan.length).toBeGreaterThan(0);
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
          eventType: "CRITIC_VERDICT_RECORDED",
          payloadJson: {
            criticVerdict: {
              autoCapturedEvidence: ["complexity"],
              selfCorrectionWindowSeconds: 45,
              wouldLikelySelfCorrect: true,
              shouldWaitBeforeIntervening: true,
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
    const evidenceTrace = reportJson.evidenceTrace as Array<Record<string, unknown>>;
    const momentsOfTruth = reportJson.momentsOfTruth as Array<Record<string, unknown>>;

    expect(hintSummary.totalHintCost).toBe(4.05);
    expect(hintSummary.strongestHintLevel).toBe("STRONG");
    expect(hintSummary.penaltyApplied).toBeGreaterThan(0);
    expect((hintSummary.byInitiator as Record<string, number>).candidate_request).toBe(0);
    expect((hintSummary.byRequestTiming as Record<string, number>).mid).toBe(1);
    expect(Object.values(hintSummary.byMomentumAtHint as Record<string, number>).reduce((sum, value) => sum + Number(value), 0)).toBeGreaterThanOrEqual(1);
    expect(typeof hintSummary.efficiencyScore).toBe("number");
    expect((hintSummary.coachability as Record<string, unknown>).label).toBeTruthy();
    expect((hintSummary.byRescueMode as Record<string, number>).implementation_rescue).toBe(1);
    expect(report.overallScore).toBeLessThan(100);
    expect(report.weaknesses.length + report.improvementPlan.length).toBeGreaterThan(0);
    expect(report.improvementPlan.length).toBeGreaterThan(0);
    expect(evidenceTrace.some((item) => item.category === "Hinting")).toBe(true);
    expect(evidenceTrace.some((item) => item.category === "Counterfactual")).toBe(true);
    expect(momentsOfTruth.some((item) => item.title === "Earned a self-correction window")).toBe(true);
  });
});

