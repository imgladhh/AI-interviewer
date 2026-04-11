import { describe, expect, it } from "vitest";
import { buildSessionEventDescription, buildUnifiedOpsFeed, type AdminProfileDetail } from "@/lib/admin/ops";

describe("buildUnifiedOpsFeed", () => {
  const detail: AdminProfileDetail = {
    profile: {
      id: "profile-1",
      sourceUrl: "https://example.com/jane",
      sourceType: "PERSONAL_SITE",
      status: "READY",
      fetchStatus: "SUCCEEDED",
      personaSummary: null,
      currentRole: null,
      currentCompany: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      updatedAt: "2026-03-28T00:00:00.000Z",
    },
    job: null,
    personaEvents: [
      {
        id: "p1",
        source: "persona",
        eventType: "JOB_ENQUEUED",
        createdAt: "2026-03-28T00:00:10.000Z",
        title: "Job Enqueued",
        description: "Queued.",
        payloadJson: null,
        interviewerProfileId: "profile-1",
      },
    ],
    sessionEvents: [
      {
        id: "s1",
        source: "session",
        eventType: "SESSION_CREATED",
        createdAt: "2026-03-28T00:00:20.000Z",
        title: "Session Created",
        description: "Session created.",
        payloadJson: null,
        sessionId: "session-1",
        interviewerProfileId: "profile-1",
      },
    ],
    sessionSummary: null,
  };

  it("returns all events sorted by newest first", () => {
    const result = buildUnifiedOpsFeed(detail, "all");
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("s1");
    expect(result[1]?.id).toBe("p1");
  });

  it("filters to persona events", () => {
    const result = buildUnifiedOpsFeed(detail, "persona");
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("persona");
  });

  it("filters to session events", () => {
    const result = buildUnifiedOpsFeed(detail, "session");
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("session");
  });

  it("describes stage transitions in a human-readable way", () => {
    const description = buildSessionEventDescription("STAGE_ADVANCED", {
      previousStage: "APPROACH_DISCUSSION",
      stage: "IMPLEMENTATION",
    });

    expect(description).toMatch(/Approach Discussion/);
    expect(description).toMatch(/Implementation/);
  });

  it("describes AI interruptions from new realtime events", () => {
    const description = buildSessionEventDescription("AI_INTERRUPTED_BY_CANDIDATE", {
      wasSpeaking: true,
    });

    expect(description).toMatch(/interrupted/i);
  });

  it("describes hints served by the interviewer", () => {
    const description = buildSessionEventDescription("HINT_SERVED", {
      stage: "APPROACH_DISCUSSION",
      hintStyle: "APPROACH_NUDGE",
      hintLevel: "MEDIUM",
      escalationReason: "stage_stall_detected",
    });

    expect(description).toMatch(/hint/i);
    expect(description).toMatch(/Approach Discussion/i);
    expect(description).toMatch(/medium/i);
    expect(description).toMatch(/stage stall detected/i);
  });

  it("describes dedicated STT transcript refinement", () => {
    const description = buildSessionEventDescription("CANDIDATE_TRANSCRIPT_REFINED", {
      transcriptProvider: "openai-stt",
      transcriptVersion: 2,
      correctionOfId: "seg-1",
      transcriptSegmentId: "seg-2",
    });

    expect(description).toMatch(/dedicated stt/i);
    expect(description).toMatch(/openai-stt/i);
    expect(description).toMatch(/v2/i);
    expect(description).toMatch(/replaces seg-1/i);
    expect(description).toMatch(/active=seg-2/i);
  });

  it("describes signal snapshots in a readable way", () => {
    const description = buildSessionEventDescription("SIGNAL_SNAPSHOT_RECORDED", {
      signals: {
        understanding: "clear",
        progress: "stuck",
        edgeCaseAwareness: "missing",
        structuredEvidence: [],
      },
    });

    expect(description).toMatch(/understanding=clear/i);
    expect(description).toMatch(/progress=stuck/i);
    expect(description).toMatch(/edge cases=missing/i);
  });

  it("prefers the primary observed issue when structured evidence exists", () => {
    const description = buildSessionEventDescription("SIGNAL_SNAPSHOT_RECORDED", {
      signals: {
        understanding: "clear",
        progress: "progressing",
        structuredEvidence: [
          {
            area: "correctness",
            issue: "The correctness invariant is still underspecified.",
          },
        ],
      },
    });

    expect(description).toMatch(/primary observed issue/i);
    expect(description).toMatch(/invariant/i);
  });

  it("includes calibration and flow hints in signal snapshot descriptions", () => {
    const description = buildSessionEventDescription("SIGNAL_SNAPSHOT_RECORDED", {
      stage: "IMPLEMENTATION",
      signals: {
        understanding: "clear",
        progress: "progressing",
        communication: "clear",
        behavior: "structured",
        algorithmChoice: "reasonable",
        reasoningDepth: "deep",
        testingDiscipline: "strong",
        complexityRigor: "strong",
        confidence: 0.84,
        structuredEvidence: [],
      },
    });

    expect(description).toMatch(/ceiling=/i);
    expect(description).toMatch(/ease=/i);
    expect(description === undefined || /flow=|ceiling=|ease=/i.test(description)).toBe(true);
  });

  it("describes interviewer decisions in a readable way", () => {
    const description = buildSessionEventDescription("DECISION_RECORDED", {
      decision: {
        action: "ask_followup",
        target: "edge_case",
      },
    });

    expect(description).toMatch(/ask_followup/i);
    expect(description).toMatch(/edge_case/i);
  });

  it("includes policy and invariant metadata in decision descriptions", () => {
    const description = buildSessionEventDescription("DECISION_RECORDED", {
      decision: {
        action: "hold_and_listen",
        target: "implementation",
        urgency: "low",
        interruptionCost: "high",
        policyArchetype: "collaborative",
        policyMode: "guided",
        blockedByInvariant: "flow_preservation",
      },
    });

    expect(description).toMatch(/policy=collaborative/i);
    expect(description).toMatch(/mode=guided/i);
    expect(description).toMatch(/blocked=flow_preservation/i);
  });

  it("describes reward events in a readable way", () => {
    const description = buildSessionEventDescription("REWARD_RECORDED", {
      reward: {
        total: 0.42,
        components: {
          evidenceGain: 0.4,
          redundancy: 0.1,
          badInterruption: 0,
          flowPreservation: 0.1,
          cleanClosure: 0,
        },
        penalties: ["repeated_target"],
      },
    });

    expect(description).toMatch(/reward v1 recorded/i);
    expect(description).toMatch(/total=0.42/i);
    expect(description).toMatch(/penalties=repeated_target/i);
  });

  it("mentions provider fallback details for AI replies", () => {
    const description = buildSessionEventDescription("AI_SPOKE", {
      source: "fallback",
      providerFailure: {
        provider: "gemini",
        message: "rate limit",
      },
    });

    expect(description).toMatch(/fallback/i);
    expect(description).toMatch(/gemini/i);
    expect(description).toMatch(/rate limit/i);
  });

  it("describes generated reports in a readable way", () => {
    const description = buildSessionEventDescription("REPORT_GENERATED", {
      recommendation: "HIRE",
      overallScore: 78,
    });

    expect(description).toMatch(/report generated/i);
    expect(description).toMatch(/hire/i);
    expect(description).toMatch(/78/);
  });

  it("describes session budget guardrails in a readable way", () => {
    const description = buildSessionEventDescription("SESSION_BUDGET_EXCEEDED", {
      projectedTotalUsd: 2.14,
      thresholdUsd: 2,
    });

    expect(description).toMatch(/budget exceeded/i);
    expect(description).toMatch(/\$2\.14/);
    expect(description).toMatch(/\$2/);
  });

  it("includes timing metadata in critic verdict descriptions", () => {
    const description = buildSessionEventDescription("CRITIC_VERDICT_RECORDED", {
      criticVerdict: {
        verdict: "move_on",
        reason: "poor_timing",
        timingVerdict: "defer",
        urgency: "low",
        interruptionCost: "high",
        batchGroup: "complexity_and_tradeoff",
        worthReason: "The candidate is in a good implementation flow, so this can wait.",
      },
    });

    expect(description).toMatch(/timing=defer/i);
    expect(description).toMatch(/urgency=low/i);
    expect(description).toMatch(/interruption=high/i);
    expect(description).toMatch(/batch=complexity_and_tradeoff/i);
  });

  it("describes interviewer intent snapshots in a readable way", () => {
    const description = buildSessionEventDescription("INTENT_SNAPSHOT_RECORDED", {
      intent: {
        intent: "advance",
        targetSignal: "implementation",
        expectedOutcome: "advance_stage",
        competingIntents: [
          { intent: "validate", reason: "still could check correctness", score: 0.42 },
          { intent: "guide", reason: "could still nudge testing", score: 0.24 },
        ],
      },
    });

    expect(description).toMatch(/interviewer intent/i);
    expect(description).toMatch(/advance/i);
    expect(description).toMatch(/implementation/i);
    expect(description).toMatch(/alternatives considered/i);
    expect(description).toMatch(/validate/i);
  });

  it("describes trajectory snapshots in a readable way", () => {
    const description = buildSessionEventDescription("TRAJECTORY_SNAPSHOT_RECORDED", {
      trajectory: {
        candidateTrajectory: "steady_progress",
        bestIntervention: "none",
        interruptionCost: "high",
      },
    });

    expect(description).toMatch(/trajectory estimate/i);
    expect(description).toMatch(/steady_progress/i);
    expect(description).toMatch(/interruption=high/i);
  });

  it("includes shadow-policy score delta hints when available", () => {
    const description = buildSessionEventDescription("SHADOW_POLICY_EVALUATED", {
      shadowPolicy: {
        archetype: "bar_raiser",
        action: "probe_tradeoff",
        diff: ["action"],
        scoreDiff: [{ action: "Probe", delta: 0.41 }],
      },
    });

    expect(description).toMatch(/score_delta/i);
    expect(description).toMatch(/Probe:0.41/);
  });

  it("describes echo detection and recovery events", () => {
    const detected = buildSessionEventDescription("CANDIDATE_ECHO_DETECTED", {
      echoStrength: "high",
      echoOverlapRatio: 0.91,
    });
    const recovered = buildSessionEventDescription("ECHO_RECOVERY_PROMPTED", {
      mode: "narrow_format",
      attempt: 2,
    });

    expect(detected).toMatch(/echo detected/i);
    expect(detected).toMatch(/0.91/i);
    expect(recovered).toMatch(/echo recovery prompted/i);
    expect(recovered).toMatch(/attempt 2/i);
  });

  it("surfaces auto-captured evidence in critic descriptions", () => {
    const description = buildSessionEventDescription("CRITIC_VERDICT_RECORDED", {
      criticVerdict: {
        verdict: "move_on",
        reason: "auto_captured_evidence",
        autoCapturedEvidence: ["complexity_tradeoff"],
      },
    });

    expect(description).toMatch(/auto-captured evidence/i);
    expect(description).toMatch(/complexity_tradeoff/i);
  });

  it("surfaces self-correction windows in critic descriptions", () => {
    const description = buildSessionEventDescription("CRITIC_VERDICT_RECORDED", {
      criticVerdict: {
        verdict: "move_on",
        reason: "self_correction_window",
        shouldWaitBeforeIntervening: true,
        wouldLikelySelfCorrect: true,
        selfCorrectionWindowSeconds: 45,
      },
    });

    expect(description).toMatch(/wait 45s/i);
    expect(description).toMatch(/self-correction/i);
  });
});

