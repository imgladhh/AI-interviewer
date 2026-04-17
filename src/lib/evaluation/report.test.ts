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
        {
          eventType: "REWARD_RECORDED",
          payloadJson: {
            stage: "APPROACH_DISCUSSION",
            reward: {
              version: "v1",
              total: 0.41,
              components: {
                evidenceGain: 0.4,
                redundancy: 0.1,
                badInterruption: 0,
                flowPreservation: 0.1,
                cleanClosure: 0,
              },
              penalties: [],
            },
          },
        },
        {
          eventType: "SHADOW_POLICY_EVALUATED",
          payloadJson: {
            shadowPolicy: {
              archetype: "bar_raiser",
              action: "probe_tradeoff",
              target: "tradeoff",
              diff: ["action", "target"],
              scoreDiff: [{ action: "Probe", delta: 0.44 }],
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
    expect((reportJson.rewardSummary as Record<string, unknown>).averageTotal).toBeTruthy();
    expect(Array.isArray((reportJson.rewardSummary as Record<string, unknown>).trend)).toBe(true);
    expect(
      Array.isArray((reportJson.rewardSummary as Record<string, unknown>).designEvidenceTypeCounts),
    ).toBe(true);
    expect(Array.isArray((reportJson.rewardSummary as Record<string, unknown>).attributions)).toBe(true);
    expect(
      ((
        (reportJson.rewardSummary as Record<string, unknown>).nudgeConversion as Record<string, unknown>
      ).conversionRate as number | null) ?? null,
    ).toBe(0);
    expect(Array.isArray(reportJson.shadowPolicySnapshots as unknown[])).toBe(true);
    expect((reportJson.shadowPolicySnapshots as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
  });

  it("computes nudge conversion rate from hints, pivots, and noise-tagged reward turns", () => {
    const report = generateSessionReport({
      sessionId: "session-nudge-conversion-1",
      mode: "SYSTEM_DESIGN",
      questionTitle: "Design Event Bus",
      transcripts: [{ speaker: "USER", text: "I will compare async queue vs stream and call out SPOF." }],
      events: [
        { eventType: "HINT_SERVED", payloadJson: { hintLevel: "LIGHT", hintStyle: "APPROACH_NUDGE" } },
        { eventType: "HINT_SERVED", payloadJson: { hintLevel: "LIGHT", hintStyle: "APPROACH_NUDGE" } },
        {
          eventType: "REWARD_RECORDED",
          payloadJson: {
            reward: {
              total: 0.42,
              components: {
                evidenceGain: 0.4,
                redundancy: 0.1,
                badInterruption: 0,
                flowPreservation: 0.05,
                cleanClosure: 0,
                riskIdentified: 0.2,
                tradeoffDepth: 0.18,
                handwavePenalty: 0,
                pivotImpact: 0.44,
              },
              penalties: [],
            },
          },
        },
        {
          eventType: "REWARD_RECORDED",
          payloadJson: {
            reward: {
              total: -0.1,
              noiseTags: ["INTERRUPTED_TURN"],
              components: {
                evidenceGain: 0,
                redundancy: 0,
                badInterruption: -0.1,
                flowPreservation: 0,
                cleanClosure: 0,
                riskIdentified: 0,
                tradeoffDepth: 0,
                handwavePenalty: 0,
                pivotImpact: 0,
              },
              penalties: ["interrupted_when_should_wait"],
            },
          },
        },
      ],
      executionRuns: [],
      candidateStateSnapshots: [],
    });

    const reportJson = report.reportJson as Record<string, unknown>;
    const rewardSummary = (reportJson.rewardSummary as Record<string, unknown>) ?? {};
    const nudgeConversion = (rewardSummary.nudgeConversion as Record<string, unknown>) ?? {};

    expect(nudgeConversion.guideCount).toBe(2);
    expect(nudgeConversion.pivotCount).toBe(1);
    expect(nudgeConversion.conversionRate).toBe(0.5);
    expect(nudgeConversion.noiseTaggedTurns).toBe(1);
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

it("emits system design DNA with evidence pinning when mode is SYSTEM_DESIGN", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-1",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design Dropbox",
    transcripts: [
      { speaker: "USER", text: "We should support upload/download and list files with metadata." },
      { speaker: "USER", text: "Assume 50k qps reads and 5k qps writes with object store + metadata DB sharding." },
      { speaker: "USER", text: "Option A is stronger consistency, option B is eventual consistency with better latency." },
    ],
    events: [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          stage: "DEEP_DIVE",
          signals: {
            summary: "Design signals updated.",
            designSignals: {
              signals: {
                requirement_missing: false,
                capacity_missing: false,
                tradeoff_missed: false,
                spof_missed: true,
                bottleneck_unexamined: false,
              },
              evidenceRefs: {
                requirement_missing: ["USER#1: upload/download + list files"],
                capacity_missing: ["USER#2: 50k qps reads and 5k qps writes"],
                tradeoff_missed: ["USER#3: option A vs option B"],
                spof_missed: ["No direct candidate evidence in recent turns."],
                bottleneck_unexamined: ["USER#2: metadata DB sharding and scaling"],
              },
            },
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: {
            total: 0.42,
            designEvidenceTypes: ["requirement", "capacity", "tradeoff", "bottleneck"],
          },
          trace: {
            transcriptSegmentId: "seg-sd-42",
          },
        },
      },
    ],
    executionRuns: [],
    candidateStateSnapshots: [
      {
        id: "snap-sd-1",
        stage: "DEEP_DIVE",
        snapshotJson: {
          summary: "System design state snapshot",
          designSignals: {
            signals: {
              requirement_missing: false,
              capacity_missing: false,
              tradeoff_missed: false,
              spof_missed: true,
              bottleneck_unexamined: false,
            },
            evidenceRefs: {
              requirement_missing: ["USER#1: upload/download + list files"],
              capacity_missing: ["USER#2: 50k qps reads and 5k qps writes"],
              tradeoff_missed: ["USER#3: option A vs option B"],
              spof_missed: ["No direct candidate evidence in recent turns."],
              bottleneck_unexamined: ["USER#2: metadata DB sharding and scaling"],
            },
          },
        },
      },
    ],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const systemDesignDna = (reportJson.systemDesignDna as Record<string, unknown>) ?? {};
  const evidencePins = (systemDesignDna.evidencePins as Array<Record<string, unknown>>) ?? [];
  const strongestSignals = (systemDesignDna.strongest_signals as Array<Record<string, unknown>>) ?? [];
  const blockingDimensions = (systemDesignDna.blocking_dimensions as Array<Record<string, unknown>>) ?? [];
  const pivotEffects = (systemDesignDna.pivot_effects as Array<Record<string, unknown>>) ?? [];

  expect(reportJson.mode).toBe("SYSTEM_DESIGN");
  expect(typeof systemDesignDna.requirement_clarity).toBe("number");
  expect(typeof systemDesignDna.capacity_instinct).toBe("number");
  expect(typeof systemDesignDna.tradeoff_depth).toBe("number");
  expect(typeof systemDesignDna.reliability_awareness).toBe("number");
  expect(typeof systemDesignDna.bottleneck_sensitivity).toBe("number");
  expect((systemDesignDna.levelRecommendation as string)).toMatch(/Mid-level|Senior|Staff/);
  expect(Array.isArray(systemDesignDna.strengths)).toBe(true);
  expect(Array.isArray(systemDesignDna.weaknesses)).toBe(true);
  expect(Array.isArray(strongestSignals)).toBe(true);
  expect(Array.isArray(blockingDimensions)).toBe(true);
  expect(Array.isArray(pivotEffects)).toBe(true);
  expect(Array.isArray(evidencePins)).toBe(true);
  expect(evidencePins.length).toBe(5);
  expect(strongestSignals.length).toBeGreaterThan(0);
  expect(blockingDimensions.length).toBeGreaterThan(0);
  expect(pivotEffects.length).toBeGreaterThan(0);
  expect(typeof strongestSignals[0]?.rationale).toBe("string");
  expect(typeof blockingDimensions[0]?.reason).toBe("string");
  expect(typeof pivotEffects[0]?.title).toBe("string");
  expect(evidencePins.some((item) => item.snapshotId === "snap-sd-1")).toBe(true);
  expect(
    evidencePins.some(
      (item) =>
        item.dimension === "tradeoff_depth" &&
        Array.isArray(item.turnIds) &&
        (item.turnIds as string[]).includes("seg-sd-42"),
    ),
  ).toBe(true);
  expect(
    evidencePins.some((item) => {
      if (item.dimension !== "requirement_clarity" || !Array.isArray(item.textPointers)) {
        return false;
      }
      const first = (item.textPointers as Array<Record<string, unknown>>)[0] ?? {};
      return (
        (first.turnId as string) === "USER#1" &&
        typeof first.start === "number" &&
        typeof first.length === "number" &&
        typeof first.excerpt === "string"
      );
    }),
  ).toBe(true);
});

it("builds usable text pointers from transcript segment ids when evidence refs are sparse", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-pointer-fallback",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design Timeline Feed",
    transcripts: [
      {
        id: "seg-pointer-1",
        speaker: "USER",
        text: "We can keep a write fanout queue and shard by author id to control feed amplification under spikes.",
      },
    ],
    events: [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          stage: "HIGH_LEVEL",
          signals: {
            designSignals: {
              signals: {
                requirement_missing: false,
                capacity_missing: false,
                tradeoff_missed: true,
                spof_missed: true,
                bottleneck_unexamined: true,
              },
              evidenceRefs: {
                requirement_missing: ["No direct candidate evidence in recent turns."],
                capacity_missing: ["No direct candidate evidence in recent turns."],
                tradeoff_missed: ["No direct candidate evidence in recent turns."],
                spof_missed: ["No direct candidate evidence in recent turns."],
                bottleneck_unexamined: ["No direct candidate evidence in recent turns."],
              },
            },
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: {
            total: 0.22,
            designEvidenceTypes: ["requirement"],
          },
          trace: {
            transcriptSegmentId: "seg-pointer-1",
          },
        },
      },
    ],
    executionRuns: [],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const systemDesignDna = (reportJson.systemDesignDna as Record<string, unknown>) ?? {};
  const evidencePins = (systemDesignDna.evidencePins as Array<Record<string, unknown>>) ?? [];
  const requirementPin = evidencePins.find((item) => item.dimension === "requirement_clarity") ?? {};
  const textPointers = Array.isArray(requirementPin.textPointers)
    ? (requirementPin.textPointers as Array<Record<string, unknown>>)
    : [];
  const first = textPointers[0] ?? {};

  expect(textPointers.length).toBeGreaterThan(0);
  expect(first.turnId).toBe("seg-pointer-1");
  expect(typeof first.start).toBe("number");
  expect(typeof first.length).toBe("number");
  expect((first.length as number)).toBeGreaterThan(0);
  expect(typeof first.excerpt).toBe("string");
});

it("applies non-linear cap to system design level recommendation when tradeoff depth is missing", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-cap-1",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design Notifications",
    transcripts: [
      { speaker: "USER", text: "Requirements and reliability are clear." },
    ],
    events: [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          stage: "DEEP_DIVE",
          signals: {
            designSignals: {
              signals: {
                requirement_missing: false,
                capacity_missing: false,
                tradeoff_missed: true,
                spof_missed: false,
                bottleneck_unexamined: false,
              },
              evidenceRefs: {
                requirement_missing: ["USER#1: requirements"],
                capacity_missing: ["USER#1: 20k qps reads"],
                tradeoff_missed: ["No direct candidate evidence in recent turns."],
                spof_missed: ["USER#1: multi-az failover"],
                bottleneck_unexamined: ["USER#1: queue bottleneck mitigation"],
              },
            },
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: {
            total: 0.4,
            designEvidenceTypes: ["requirement", "capacity", "spof", "bottleneck"],
          },
          trace: { transcriptSegmentId: "seg-sd-cap-1" },
        },
      },
    ],
    executionRuns: [],
    candidateStateSnapshots: [
      {
        id: "snap-sd-cap-1",
        stage: "DEEP_DIVE",
        snapshotJson: {
          designSignals: {
            signals: {
              requirement_missing: false,
              capacity_missing: false,
              tradeoff_missed: true,
              spof_missed: false,
              bottleneck_unexamined: false,
            },
            evidenceRefs: {
              requirement_missing: ["USER#1: requirements"],
              capacity_missing: ["USER#1: 20k qps reads"],
              tradeoff_missed: ["No direct candidate evidence in recent turns."],
              spof_missed: ["USER#1: multi-az failover"],
              bottleneck_unexamined: ["USER#1: queue bottleneck mitigation"],
            },
          },
        },
      },
    ],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const systemDesignDna = (reportJson.systemDesignDna as Record<string, unknown>) ?? {};
  const levelRecommendation = systemDesignDna.levelRecommendation as string;
  const calibrationNotes = (systemDesignDna.calibrationNotes as string[]) ?? [];

  expect(levelRecommendation).not.toBe("Staff");
  expect(calibrationNotes.some((note) => /cap applied|tradeoff depth/i.test(note))).toBe(true);
});

it("applies cross-stage consistency cap when scale claims are strong but deep-dive reliability remains shallow", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-cross-stage-cap-1",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design Search Index",
    transcripts: [{ speaker: "USER", text: "Scale is high but we should still cover reliability details." }],
    events: [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          stage: "DEEP_DIVE",
          signals: {
            designSignals: {
              signals: {
                requirement_missing: false,
                capacity_missing: false,
                tradeoff_missed: false,
                spof_missed: true,
                bottleneck_unexamined: true,
              },
              evidenceRefs: {
                requirement_missing: ["USER#1: requirements"],
                capacity_missing: ["USER#1: 80k qps"],
                tradeoff_missed: ["USER#1: cache vs index tradeoff"],
                spof_missed: ["No direct candidate evidence in recent turns."],
                bottleneck_unexamined: ["No direct candidate evidence in recent turns."],
              },
            },
          },
        },
      },
    ],
    executionRuns: [],
    candidateStateSnapshots: [
      {
        id: "snap-sd-cross-stage-cap-1",
        stage: "DEEP_DIVE",
        snapshotJson: {
          designSignals: {
            signals: {
              requirement_missing: false,
              capacity_missing: false,
              tradeoff_missed: false,
              spof_missed: true,
              bottleneck_unexamined: true,
            },
            evidenceRefs: {
              requirement_missing: ["USER#1: requirements"],
              capacity_missing: ["USER#1: 80k qps"],
              tradeoff_missed: ["USER#1: cache vs index tradeoff"],
              spof_missed: ["No direct candidate evidence in recent turns."],
              bottleneck_unexamined: ["No direct candidate evidence in recent turns."],
            },
          },
        },
      },
    ],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const systemDesignDna = (reportJson.systemDesignDna as Record<string, unknown>) ?? {};
  const levelRecommendation = systemDesignDna.levelRecommendation as string;
  const calibrationNotes = (systemDesignDna.calibrationNotes as string[]) ?? [];

  expect(levelRecommendation).toBe("Mid-level");
  expect(calibrationNotes.some((note) => /cross-stage consistency/i.test(note))).toBe(true);
});

it("applies pivot boost within guardrails when hint-to-insight conversion is sustained", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-pivot-boost-1",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design Notification Fanout",
    transcripts: [{ speaker: "USER", text: "Let's compare fanout models with concrete costs." }],
    events: [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          stage: "DEEP_DIVE",
          signals: {
            designSignals: {
              signals: {
                requirement_missing: true,
                capacity_missing: false,
                tradeoff_missed: false,
                spof_missed: true,
                bottleneck_unexamined: true,
              },
              evidenceRefs: {
                requirement_missing: ["No direct candidate evidence in recent turns."],
                capacity_missing: ["USER#1: 50k qps"],
                tradeoff_missed: ["USER#1: push vs pull tradeoff"],
                spof_missed: ["No direct candidate evidence in recent turns."],
                bottleneck_unexamined: ["No direct candidate evidence in recent turns."],
              },
            },
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: {
            total: 0.35,
            components: {
              evidenceGain: 0.3,
              redundancy: 0,
              badInterruption: 0,
              flowPreservation: 0,
              cleanClosure: 0,
              riskIdentified: 0.2,
              tradeoffDepth: 0.2,
              handwavePenalty: 0,
              pivotImpact: 0.46,
            },
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: {
            total: 0.31,
            components: {
              evidenceGain: 0.25,
              redundancy: 0,
              badInterruption: 0,
              flowPreservation: 0,
              cleanClosure: 0,
              riskIdentified: 0.18,
              tradeoffDepth: 0.22,
              handwavePenalty: 0,
              pivotImpact: 0.39,
            },
          },
        },
      },
    ],
    executionRuns: [],
    candidateStateSnapshots: [
      {
        id: "snap-sd-pivot-boost-1",
        stage: "DEEP_DIVE",
        snapshotJson: {
          designSignals: {
            signals: {
              requirement_missing: true,
              capacity_missing: false,
              tradeoff_missed: false,
              spof_missed: true,
              bottleneck_unexamined: true,
            },
            evidenceRefs: {
              requirement_missing: ["No direct candidate evidence in recent turns."],
              capacity_missing: ["USER#1: 50k qps"],
              tradeoff_missed: ["USER#1: push vs pull tradeoff"],
              spof_missed: ["No direct candidate evidence in recent turns."],
              bottleneck_unexamined: ["No direct candidate evidence in recent turns."],
            },
          },
        },
      },
    ],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const systemDesignDna = (reportJson.systemDesignDna as Record<string, unknown>) ?? {};
  const levelRecommendation = systemDesignDna.levelRecommendation as string;
  const calibrationNotes = (systemDesignDna.calibrationNotes as string[]) ?? [];

  expect(levelRecommendation).toBe("Senior");
  expect(calibrationNotes.some((note) => /pivot boost applied/i.test(note))).toBe(true);
});

it("upgrades Senior to Staff when pivot conversion is exceptional and core dimensions remain strong", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-pivot-staff-1",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design Multi-Region Storage",
    transcripts: [{ speaker: "USER", text: "I can compare quorum and async replication while handling failover." }],
    events: [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          stage: "DEEP_DIVE",
          signals: {
            designSignals: {
              signals: {
                requirement_missing: true,
                capacity_missing: false,
                tradeoff_missed: false,
                spof_missed: false,
                bottleneck_unexamined: false,
              },
              evidenceRefs: {
                requirement_missing: ["No direct candidate evidence in recent turns."],
                capacity_missing: ["USER#1: 100k qps"],
                tradeoff_missed: ["USER#1: quorum vs async tradeoff"],
                spof_missed: ["USER#1: multi-region failover"],
                bottleneck_unexamined: ["USER#1: metadata shard hotspot mitigation"],
              },
            },
          },
        },
      },
      ...[0.62, 0.55, 0.52].map((pivotImpact, index) => ({
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: {
            total: 0.4,
            components: {
              evidenceGain: 0.25,
              redundancy: 0,
              badInterruption: 0,
              flowPreservation: 0,
              cleanClosure: 0,
              riskIdentified: 0.2,
              tradeoffDepth: 0.2,
              handwavePenalty: 0,
              pivotImpact,
            },
          },
          trace: { transcriptSegmentId: `seg-pivot-staff-${index + 1}` },
        },
      })),
    ],
    executionRuns: [],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const systemDesignDna = (reportJson.systemDesignDna as Record<string, unknown>) ?? {};
  const levelRecommendation = systemDesignDna.levelRecommendation as string;
  const calibrationNotes = (systemDesignDna.calibrationNotes as string[]) ?? [];

  expect(levelRecommendation).toBe("Staff");
  expect(calibrationNotes.some((note) => /exceptional sustained insight conversion/i.test(note))).toBe(true);
});

it("keeps Staff pivot boost blocked when core dimensions are still weak", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-pivot-guardrail-1",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design Messaging Bus",
    transcripts: [{ speaker: "USER", text: "Let's reason through throughput and replication strategy." }],
    events: [
      {
        eventType: "SIGNAL_SNAPSHOT_RECORDED",
        payloadJson: {
          stage: "DEEP_DIVE",
          signals: {
            designSignals: {
              signals: {
                requirement_missing: true,
                capacity_missing: false,
                tradeoff_missed: false,
                spof_missed: true,
                bottleneck_unexamined: false,
              },
              evidenceRefs: {
                requirement_missing: ["No direct candidate evidence in recent turns."],
                capacity_missing: ["USER#1: 60k qps"],
                tradeoff_missed: ["USER#1: log compaction tradeoff"],
                spof_missed: ["No direct candidate evidence in recent turns."],
                bottleneck_unexamined: ["USER#1: broker hotspot mitigation"],
              },
            },
          },
        },
      },
      ...[0.6, 0.53, 0.5].map((pivotImpact, index) => ({
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: {
            total: 0.36,
            components: {
              evidenceGain: 0.24,
              redundancy: 0,
              badInterruption: 0,
              flowPreservation: 0,
              cleanClosure: 0,
              riskIdentified: 0.18,
              tradeoffDepth: 0.18,
              handwavePenalty: 0,
              pivotImpact,
            },
          },
          trace: { transcriptSegmentId: `seg-pivot-guardrail-${index + 1}` },
        },
      })),
    ],
    executionRuns: [],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const systemDesignDna = (reportJson.systemDesignDna as Record<string, unknown>) ?? {};
  const levelRecommendation = systemDesignDna.levelRecommendation as string;
  const calibrationNotes = (systemDesignDna.calibrationNotes as string[]) ?? [];

  expect(levelRecommendation).not.toBe("Staff");
  expect(calibrationNotes.some((note) => /pivot boost withheld by guardrails/i.test(note))).toBe(true);
});

it("keeps system design DNA scores low when no candidate evidence is available", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-empty-1",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design URL Shortener",
    transcripts: [
      { speaker: "AI", text: "Let's start with requirements." },
    ],
    events: [],
    executionRuns: [],
    candidateStateSnapshots: [],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const systemDesignDna = (reportJson.systemDesignDna as Record<string, unknown>) ?? {};
  const requirementClarity = systemDesignDna.requirement_clarity as number;
  const capacityInstinct = systemDesignDna.capacity_instinct as number;
  const tradeoffDepth = systemDesignDna.tradeoff_depth as number;
  const reliabilityAwareness = systemDesignDna.reliability_awareness as number;
  const bottleneckSensitivity = systemDesignDna.bottleneck_sensitivity as number;
  const levelRecommendation = systemDesignDna.levelRecommendation as string;
  const strengths = (systemDesignDna.strengths as string[]) ?? [];
  const weaknesses = (systemDesignDna.weaknesses as string[]) ?? [];

  expect(requirementClarity).toBeLessThanOrEqual(1);
  expect(capacityInstinct).toBeLessThanOrEqual(1);
  expect(tradeoffDepth).toBeLessThanOrEqual(1);
  expect(reliabilityAwareness).toBeLessThanOrEqual(1);
  expect(bottleneckSensitivity).toBeLessThanOrEqual(1);
  expect(levelRecommendation).toBe("Mid-level");
  expect(strengths.length).toBe(0);
  expect(weaknesses.length).toBeGreaterThan(0);
});

it("emits whiteboard weak-signal observability metrics as analysis-only data", () => {
  const report = generateSessionReport({
    sessionId: "session-sd-whiteboard-1",
    mode: "SYSTEM_DESIGN",
    questionTitle: "Design Collaborative Docs",
    transcripts: [{ speaker: "USER", text: "I will sketch requirements and deep dive." }],
    events: [
      {
        eventType: "WHITEBOARD_SIGNAL_RECORDED",
        payloadJson: {
          stage: "REQUIREMENTS",
          auxiliaryOnly: true,
          excludedFromDecision: true,
          whiteboardSignal: {
            component_count: 4,
            connection_count: 2,
            element_count: 6,
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: { total: 0.1 },
          trace: { transcriptSegmentId: "seg-sd-wb-1" },
        },
      },
      {
        eventType: "WHITEBOARD_SIGNAL_RECORDED",
        payloadJson: {
          stage: "DEEP_DIVE",
          auxiliaryOnly: true,
          excludedFromDecision: true,
          whiteboardSignal: {
            component_count: 8,
            connection_count: 6,
            element_count: 14,
          },
        },
      },
      {
        eventType: "REWARD_RECORDED",
        payloadJson: {
          reward: { total: 0.4 },
          trace: { transcriptSegmentId: "seg-sd-wb-2" },
        },
      },
    ],
    executionRuns: [],
    candidateStateSnapshots: [],
  });

  const reportJson = report.reportJson as Record<string, unknown>;
  const whiteboard = (reportJson.whiteboardObservability as Record<string, unknown>) ?? {};
  const stageTrend = (whiteboard.stageTrend as Array<Record<string, unknown>>) ?? [];
  const correlation = (whiteboard.qualityCorrelation as Record<string, unknown>) ?? {};

  expect(whiteboard.auxiliaryOnly).toBe(true);
  expect(whiteboard.excludedFromDecision).toBe(true);
  expect(whiteboard.totalSignals).toBe(2);
  expect(stageTrend.length).toBe(2);
  expect(stageTrend.some((row) => row.stage === "REQUIREMENTS")).toBe(true);
  expect(stageTrend.some((row) => row.stage === "DEEP_DIVE")).toBe(true);
  expect(correlation.samplePairs).toBe(2);
  expect(typeof correlation.note).toBe("string");
});



