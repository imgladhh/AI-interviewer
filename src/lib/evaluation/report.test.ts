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
              policyArchetype: "collaborative",
              blockedByInvariant: "flow_preservation",
            },
          },
        },
        { eventType: "HINT_SERVED", payloadJson: { hintLevel: "LIGHT", hintStyle: "APPROACH_NUDGE" } },
        { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "PASSED" } },
      ],
      executionRuns: [{ id: "run-0", status: "PASSED", stdout: "[1,2]" }],
    });

    const reportJson = report.reportJson as Record<string, unknown>;
    const dimensions = report.dimensions;
    const stageReplay = reportJson.stageReplay as Array<Record<string, unknown>>;
    const evidenceTrace = reportJson.evidenceTrace as Array<Record<string, unknown>>;
    const candidateDna = reportJson.candidateDna as Record<string, unknown>;
    const momentsOfTruth = reportJson.momentsOfTruth as Array<Record<string, unknown>>;
    const rubricSummary = reportJson.rubricSummary as Array<Record<string, unknown>>;
    const stageSections = reportJson.stageSections as Array<Record<string, unknown>>;

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
    expect(rubricSummary.length).toBe(3);
    expect(rubricSummary.map((item) => item.key)).toEqual(["correctness", "complexity", "communication"]);
    expect(rubricSummary.every((item) => typeof item.score === "number")).toBe(true);
    expect(Array.isArray(stageSections)).toBe(true);
    expect(stageSections.some((item) => item.label === "Discussion")).toBe(true);
    expect(dimensions.some((dimension) => dimension.key === "independence")).toBe(true);
    expect((reportJson.latestDecision as Record<string, unknown>).policyArchetype).toBe("collaborative");
    expect((reportJson.latestDecision as Record<string, unknown>).blockedByInvariant).toBe("flow_preservation");
    expect(Array.isArray((rubricSummary[0] as Record<string, unknown>).evidenceRefs)).toBe(true);
    expect((reportJson.evaluatedLevel as string)).toBeTruthy();
    expect((reportJson.levelRationale as string)).toMatch(/signal|reasoning|execution|rescue/i);
    expect((reportJson.recommendationRationale as string)).toMatch(/independence|coachability|execution|final call/i);
    expect(((reportJson.recommendationBasis as Record<string, unknown>).band as string)).toBeTruthy();
    expect(((reportJson.recommendationBasis as Record<string, unknown>).independenceSignal as string)).toMatch(/strong|mixed|weak/);
    expect(((reportJson.recommendationBasis as Record<string, unknown>).reasoningSignal as string)).toMatch(/strong|mixed|weak/);
    expect(((reportJson.recommendationBasis as Record<string, unknown>).executionSignal as string)).toMatch(/closed|mixed|unclosed/);
    expect(Array.isArray((reportJson.recommendationBasis as Record<string, unknown>).evidenceTrace)).toBe(true);
    expect((reportJson.calibrationMatrix as Record<string, unknown>).finalCall).toBeTruthy();
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
      executionRuns: [{ id: "run-1", status: "PASSED", stdout: "ok" }],
    });

    const stageReplay = (report.reportJson as Record<string, unknown>).stageReplay as Array<Record<string, unknown>>;
    const stageSections = (report.reportJson as Record<string, unknown>).stageSections as Array<Record<string, unknown>>;
    const testingGroup = stageReplay.find((group) => /testing/i.test(String(group.stage ?? "")) || /ask_for_complexity|PASSED/i.test(JSON.stringify(group)));
    const testingSection = stageSections.find((group) => /testing/i.test(String(group.label ?? "")));

    expect(testingGroup).toBeTruthy();
    expect(JSON.stringify(testingGroup)).toMatch(/Signal snapshot|Decision: ask_for_complexity|Code run result: PASSED/i);
    expect(testingSection).toBeTruthy();
    expect(JSON.stringify(testingSection)).toMatch(/ask_for_complexity|PASSED/i);
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
      executionRuns: [{ id: "run-1", status: "PASSED", stdout: "ok" }],
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
  it("prefers persisted snapshots when building the latest state and stage replay", () => {
    const report = generateSessionReport({
      sessionId: "session-5",
      questionTitle: "Two Sum",
      transcripts: [
        { speaker: "USER", text: "I would use a hash map." },
      ],
      events: [
        { eventType: "STAGE_ADVANCED", payloadJson: { stage: "IMPLEMENTATION" } },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            stage: "IMPLEMENTATION",
            signals: {
              understanding: "partial",
              progress: "stuck",
              summary: "Old event-backed signal.",
            },
          },
        },
      ],
      executionRuns: [{ id: "run-1", status: "PASSED", stdout: "ok" }],
      candidateStateSnapshots: [
        {
          id: "snap-1",
          stage: "WRAP_UP",
          snapshotJson: {
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
            confidence: 0.93,
            summary: "Persisted snapshot should win.",
          },
          createdAt: new Date("2026-04-02T20:00:00.000Z"),
        },
      ],
      interviewerDecisionSnapshots: [
        {
          id: "dec-1",
          stage: "WRAP_UP",
          decisionJson: {
            action: "move_to_wrap_up",
            target: "summary",
            question: "Give me a concise final wrap-up.",
            confidence: 0.88,
          },
          createdAt: new Date("2026-04-02T20:00:01.000Z"),
        },
      ],
      intentSnapshots: [
        {
          id: "intent-1",
          stage: "WRAP_UP",
          intentJson: {
            intent: "close",
            targetSignal: "summary",
            expectedOutcome: "close_topic",
            urgency: "medium",
          },
          createdAt: new Date("2026-04-02T20:00:01.500Z"),
        },
      ],
      trajectorySnapshots: [
        {
          id: "traj-1",
          stage: "WRAP_UP",
          trajectoryJson: {
            candidateTrajectory: "steady_progress",
            expectedWithNoIntervention: "will_finish",
            interventionValue: "low",
            bestIntervention: "close_topic",
            interruptionCost: "low",
            evidenceGainIfAskNow: "low",
            confidence: 0.77,
          },
          createdAt: new Date("2026-04-02T20:00:01.700Z"),
        },
      ],
    });

    const reportJson = report.reportJson as Record<string, unknown>;
    expect((reportJson.candidateState as Record<string, unknown>).summary).toBe("Persisted snapshot should win.");
    expect((reportJson.latestDecision as Record<string, unknown>).action).toBe("move_to_wrap_up");
    expect((reportJson.latestIntent as Record<string, unknown>).intent).toBe("close");
    expect((reportJson.latestTrajectory as Record<string, unknown>).bestIntervention).toBe("close_topic");
    expect((reportJson.sessionCritic as Record<string, unknown>).closureQuality).toBeTruthy();
    expect(Array.isArray(reportJson.intentTimeline)).toBe(true);
    expect(Array.isArray(reportJson.trajectoryTimeline)).toBe(true);
    expect(JSON.stringify(reportJson.stageReplay)).toMatch(/Persisted snapshot should win|move_to_wrap_up/);
    expect(JSON.stringify(reportJson.stageSections)).toMatch(/Wrap Up|Persisted snapshot should win|move_to_wrap_up/);
  });

  it("produces explicit 1-5 rubric evidence for correctness, complexity, and communication", () => {
    const report = generateSessionReport({
      sessionId: "session-6",
      questionTitle: "Two Sum",
      transcripts: [
        { speaker: "USER", text: "I can explain the tradeoff and complexity clearly." },
        { speaker: "USER", text: "The hashmap gives O(n) time and O(n) space." },
      ],
      events: [
        { eventType: "STAGE_ADVANCED", payloadJson: { stage: "TESTING_AND_COMPLEXITY" } },
        {
          eventType: "SIGNAL_SNAPSHOT_RECORDED",
          payloadJson: {
            stage: "WRAP_UP",
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
              confidence: 0.95,
              summary: "The candidate closed with strong final evidence.",
            },
          },
        },
      ],
      executionRuns: [{ id: "run-1", status: "PASSED", stdout: "ok" }],
      candidateStateSnapshots: [
        {
          id: "sig-6",
          stage: "WRAP_UP",
          snapshotJson: {
            communication: "clear",
            codeQuality: "correct",
            complexityRigor: "strong",
          },
        },
      ],
      interviewerDecisionSnapshots: [
        {
          id: "dec-6",
          stage: "WRAP_UP",
          decisionJson: {
            action: "move_to_wrap_up",
            target: "summary",
          },
        },
      ],
    });

    const rubricSummary = (report.reportJson as Record<string, unknown>).rubricSummary as Array<Record<string, unknown>>;
    const correctness = rubricSummary.find((item) => item.key === "correctness");
    const complexity = rubricSummary.find((item) => item.key === "complexity");
    const communication = rubricSummary.find((item) => item.key === "communication");

    expect(correctness?.score).toBeGreaterThanOrEqual(4);
    expect(correctness?.maxScore).toBe(5);
    expect(Array.isArray(correctness?.evidence)).toBe(true);
    expect(Array.isArray(correctness?.evidenceRefs)).toBe(true);
    expect((correctness?.evidenceRefs as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
    expect(typeof ((correctness?.evidenceRefs as Array<Record<string, unknown>>)[0]?.note)).toBe("string");
    expect(typeof correctness?.basis).toBe("string");

    expect(complexity?.score).toBeGreaterThanOrEqual(4);
    expect(complexity?.maxScore).toBe(5);
    expect(Array.isArray(complexity?.evidence)).toBe(true);
    expect(Array.isArray(complexity?.evidenceRefs)).toBe(true);
    expect((complexity?.evidenceRefs as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
    expect(typeof complexity?.basis).toBe("string");

    expect(communication?.score).toBeGreaterThanOrEqual(4);
    expect(communication?.maxScore).toBe(5);
    expect(Array.isArray(communication?.evidence)).toBe(true);
    expect(Array.isArray(communication?.evidenceRefs)).toBe(true);
    expect((communication?.evidenceRefs as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
    expect(typeof communication?.basis).toBe("string");
  });
});










it("downgrades the recommendation band when independence is weak despite a middling base recommendation", () => {
  const report = generateSessionReport({
    sessionId: "session-weak-independence",
    questionTitle: "Two Sum",
    transcripts: [
      { speaker: "USER", text: "I think I need a lot of help finishing this." },
    ],
    events: [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          stage: "IMPLEMENTATION",
          signals: {
            understanding: "clear",
            progress: "partial",
            communication: "clear",
            codeQuality: "partial",
            algorithmChoice: "reasonable",
            edgeCaseAwareness: "partial",
            behavior: "structured",
            reasoningDepth: "moderate",
            testingDiscipline: "partial",
            complexityRigor: "moderate",
            confidence: 0.74,
            summary: "The candidate has the right direction but relies on interviewer support to keep moving.",
          },
        },
      },
      { eventType: "HINT_REQUESTED", payloadJson: { source: "candidate" } },
      { eventType: "HINT_SERVED", payloadJson: { hintLevel: "DIRECT", hintStyle: "IMPLEMENTATION_GUIDE", rescueMode: "implementation_rescue", hintTier: "L3_SOLUTION", hintCost: 4 } },
      { eventType: "HINT_REQUESTED", payloadJson: { source: "candidate" } },
      { eventType: "HINT_SERVED", payloadJson: { hintLevel: "DIRECT", hintStyle: "IMPLEMENTATION_GUIDE", rescueMode: "implementation_rescue", hintTier: "L3_SOLUTION", hintCost: 4 } },
      { eventType: "CODE_RUN_COMPLETED", payloadJson: { status: "FAILED" } },
    ],
    executionRuns: [{ id: "run-weak-1", status: "FAILED", stderr: "wrong answer" }],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  expect((reportJson.recommendation as string)).toMatch(/BORDERLINE|NO_HIRE/);
  expect(((reportJson.recommendationBasis as Record<string, unknown>).band as string)).toMatch(/Borderline|No Hire/);
  expect(((reportJson.recommendationBasis as Record<string, unknown>).independenceSignal as string)).toBe("weak");
});



