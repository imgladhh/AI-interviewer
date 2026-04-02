import type { CandidateDecision } from "@/lib/assistant/decision_engine";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import { assessInterviewPacing } from "@/lib/assistant/pacing";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

type SessionEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

export type CriticVerdict = {
  approved: boolean;
  verdict: "accept" | "rewrite" | "move_on" | "move_to_implementation";
  timingVerdict: "ask_now" | "defer" | "skip" | "move_to_implementation";
  revisedReply?: string;
  questionWorthAsking: boolean;
  worthReason: string;
  urgency?: "low" | "medium" | "high";
  interruptionCost?: "low" | "medium" | "high";
  evidenceImportance?: "optional" | "important" | "critical";
  batchGroup?: string;
  interruptsGoodFlow: boolean;
  canDefer: boolean;
  wouldLikelySelfCorrect: boolean;
  autoCapturedEvidence: string[];
  shouldWaitBeforeIntervening: boolean;
  selfCorrectionWindowSeconds?: number;
  reason:
    | "reply_ok"
    | "generic_reply"
    | "not_specific_enough"
    | "not_tough_enough"
    | "false_positive_risk"
    | "repeated_answered_target"
    | "should_move_to_implementation"
    | "poor_timing"
    | "auto_captured_evidence"
    | "self_correction_window";
  specificity: "low" | "medium" | "high";
  intensity: "soft" | "balanced" | "sharp";
  explanation: string;
  focus?: string;
};

export function reviewInterviewerReply(input: {
  reply: string;
  decision: CandidateDecision;
  signals: CandidateSignalSnapshot;
  currentStage: CodingInterviewStage;
  recentEvents?: SessionEventLike[];
  latestExecutionRun?: ExecutionRunLike | null;
}) {
  const normalized = collapse(input.reply);
  if (!normalized) {
    return {
      approved: false,
      verdict: "rewrite",
      revisedReply: input.decision.question,
      questionWorthAsking: true,
      worthReason: "The interviewer move itself is still useful, but the generated reply was empty.",
      timingVerdict: "ask_now",
      urgency: "medium",
      interruptionCost: "medium",
      evidenceImportance: "important",
      interruptsGoodFlow: false,
      canDefer: false,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: "generic_reply",
      specificity: "low",
      intensity: "soft",
      explanation: "The reply was empty, so the interviewer should fall back to the concrete decision-engine question.",
      focus: input.decision.target,
    } satisfies CriticVerdict;
  }

  const ledger = buildMemoryLedger({
    currentStage: input.currentStage,
    recentEvents: input.recentEvents ?? [],
    signals: input.signals,
    latestExecutionRun: input.latestExecutionRun,
  });
  const pacing = assessInterviewPacing({
    currentStage: input.currentStage,
    signals: input.signals,
    ledger,
    latestExecutionRun: input.latestExecutionRun,
    decision: input.decision,
  });
  const lower = normalized.toLowerCase();
  const focus = input.decision.specificIssue ?? input.decision.target;
  const targetAlreadyAnswered = ledger.answeredTargets.includes(input.decision.target);
  const isGeneric = /\b(keep going|good start|solid start|general idea|walk me through your approach|what algorithmic strategy would you choose first|to be clear on the task)\b/i.test(
    normalized,
  );
  const specificity = classifySpecificity(normalized, input.decision);
  const intensity = classifyIntensity(normalized, input.decision);
  const shouldMoveToImplementation =
    input.signals.readyToCode &&
    !input.latestExecutionRun &&
    ["reasoning", "correctness", "testing", "edge_case", "complexity", "tradeoff"].includes(
      input.decision.target,
    );
  const autoCapturedEvidence = inferAutoCapturedEvidence(input.decision.target, ledger.collectedEvidence, input.signals);
  const selfCorrectionWindow = resolveSelfCorrectionWindow(input, pacing);
  const grounding = assessIssueGrounding(input);

  if (!grounding.issueGroundedInEvidence) {
    return {
      approved: false,
      verdict: "move_on",
      timingVerdict: pacing.canDefer ? "defer" : "skip",
      revisedReply:
        input.decision.target === "implementation"
          ? "Keep going for a moment and show me one more concrete state change or branch before I step in."
          : "Keep going for a moment. I want a little more concrete evidence before I press on that point.",
      questionWorthAsking: false,
      worthReason: grounding.reason,
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: pacing.interruptionCost === "high",
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: "false_positive_risk",
      specificity,
      intensity,
      explanation:
        "The current interviewer hypothesis is not grounded strongly enough in actual code-run, structured-evidence, or transcript evidence, so the turn should not press a potentially hallucinated issue.",
      focus,
    } satisfies CriticVerdict;
  }

  if (autoCapturedEvidence.length > 0 && input.decision.target !== "implementation") {
    return {
      approved: false,
      verdict: "move_on",
      timingVerdict: "skip",
      revisedReply: buildAutoCaptureReply(input.decision.target),
      questionWorthAsking: false,
      worthReason: "The candidate has already surfaced the relevant evidence without needing an extra prompt.",
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: pacing.interruptionCost === "high",
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence,
      shouldWaitBeforeIntervening: false,
      reason: "auto_captured_evidence",
      specificity,
      intensity,
      explanation: "The evidence the interviewer wanted has already been auto-captured from the candidate's own explanation, so asking now would be redundant.",
      focus,
    } satisfies CriticVerdict;
  }

  if (selfCorrectionWindow.shouldWait) {
    return {
      approved: false,
      verdict: "move_on",
      timingVerdict: "defer",
      revisedReply: selfCorrectionWindow.reply,
      questionWorthAsking: false,
      worthReason: selfCorrectionWindow.reason,
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: true,
      canDefer: true,
      wouldLikelySelfCorrect: true,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: true,
      selfCorrectionWindowSeconds: selfCorrectionWindow.windowSeconds,
      reason: "self_correction_window",
      specificity,
      intensity,
      explanation: "The candidate is still in a productive debugging or implementation flow, so the interviewer should wait for a short self-correction window before intervening.",
      focus,
    } satisfies CriticVerdict;
  }

  if (shouldMoveToImplementation) {
    return {
      approved: false,
      verdict: "move_to_implementation",
      timingVerdict: "move_to_implementation",
      revisedReply:
        "Your approach is concrete enough now. Go ahead and implement it, and we can come back to correctness, testing, and tradeoffs after the code is written.",
      questionWorthAsking: false,
      worthReason: pacing.worthReason,
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: pacing.interruptionCost === "high",
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: "should_move_to_implementation",
      specificity: "medium",
      intensity: "balanced",
      explanation: "The candidate is already ready to code, so more pre-code probing would hurt pacing.",
      focus,
    } satisfies CriticVerdict;
  }

  if (pacing.timingVerdict === "defer") {
    return {
      approved: false,
      verdict: "move_on",
      timingVerdict: "defer",
      revisedReply:
        input.currentStage === "IMPLEMENTATION"
          ? "Keep coding for a moment. I want to see one more concrete branch, update, or result before I interrupt you."
          : "Keep going for a moment. I want one more concrete step or example before I press on that point.",
      questionWorthAsking: false,
      worthReason: pacing.worthReason,
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: true,
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: "poor_timing",
      specificity,
      intensity,
      explanation:
        "The interviewer target may still matter, but asking it now would interrupt productive flow, so it should be deferred.",
      focus,
    } satisfies CriticVerdict;
  }

  if (
    !pacing.questionWorthAsking ||
    (targetAlreadyAnswered &&
      ["testing", "edge_case", "complexity", "tradeoff", "reasoning", "correctness"].includes(
        input.decision.target,
      ))
  ) {
    return {
      approved: false,
      verdict: input.decision.target === "implementation" ? "move_to_implementation" : "move_on",
      timingVerdict: pacing.timingVerdict,
      revisedReply:
        input.decision.target === "complexity" || input.decision.target === "tradeoff"
          ? "You have already covered the performance story clearly enough. Give me a concise final summary of the approach and one implementation detail you would still watch carefully."
          : input.decision.target === "testing" || input.decision.target === "edge_case"
            ? "You have already named the key validation cases. Summarize the final solution and tell me one boundary condition you would still keep in mind during review."
            : input.decision.target === "implementation"
              ? "The path is concrete enough now. Go ahead and implement it, and we can revisit any remaining gaps after the code is on the page."
              : "You have already addressed that point enough for now. Keep moving, and we can return to any remaining gaps after the implementation evidence is stronger.",
      questionWorthAsking: false,
      worthReason: pacing.worthReason,
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: pacing.interruptionCost === "high",
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: targetAlreadyAnswered ? "repeated_answered_target" : "should_move_to_implementation",
      specificity,
      intensity,
      explanation: "The candidate has already supplied the relevant evidence, so this question would not improve the interview signal enough to be worth asking again right now.",
      focus,
    } satisfies CriticVerdict;
  }

  if (isGeneric) {
    return {
      approved: false,
      verdict: "rewrite",
      timingVerdict: "ask_now",
      revisedReply: input.decision.question,
      questionWorthAsking: true,
      worthReason: "The target is still worth asking, but this wording is too generic.",
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: false,
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: "generic_reply",
      specificity: "low",
      intensity,
      explanation: "The reply is too generic and does not clearly execute the intended interviewer move.",
      focus,
    } satisfies CriticVerdict;
  }

  if (specificity === "low") {
    return {
      approved: false,
      verdict: "rewrite",
      timingVerdict: "ask_now",
      revisedReply: input.decision.question,
      questionWorthAsking: true,
      worthReason: "The interviewer is pressing on the right issue, but the question needs to be more specific.",
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: false,
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: "not_specific_enough",
      specificity,
      intensity,
      explanation: "The reply does not anchor strongly enough to the specific issue, target, or expected answer shape for this turn.",
      focus,
    } satisfies CriticVerdict;
  }

  if (requiresSharperPressure(input.decision) && intensity === "soft") {
    return {
      approved: false,
      verdict: "rewrite",
      timingVerdict: "ask_now",
      revisedReply: input.decision.question,
      questionWorthAsking: true,
      worthReason: "The issue is worth probing, but the question needs more interviewing pressure.",
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: false,
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: "not_tough_enough",
      specificity,
      intensity,
      explanation: "The interviewer move needs a sharper, more evaluative question instead of a soft or purely encouraging phrasing.",
      focus,
    } satisfies CriticVerdict;
  }

  if (
    input.signals.readyToCode &&
    !input.latestExecutionRun &&
    /(invariant|proof sketch|expected output|tradeoff|complexity)/i.test(lower) &&
    !/(implement|code)/i.test(lower)
  ) {
    return {
      approved: false,
      verdict: "move_to_implementation",
      timingVerdict: "move_to_implementation",
      revisedReply:
        "That is enough pre-code discussion. Go ahead and implement it now, and then we can review correctness and tradeoffs against the actual code.",
      questionWorthAsking: false,
      worthReason: pacing.worthReason,
      urgency: pacing.urgency,
      interruptionCost: pacing.interruptionCost,
      evidenceImportance: pacing.evidenceImportance,
      batchGroup: pacing.batchGroup,
      interruptsGoodFlow: pacing.interruptionCost === "high",
      canDefer: pacing.canDefer,
      wouldLikelySelfCorrect: false,
      autoCapturedEvidence: [],
      shouldWaitBeforeIntervening: false,
      reason: "should_move_to_implementation",
      specificity,
      intensity,
      explanation: "The candidate is already showing implementation readiness, so continuing with proof-style or validation-style probing is mistimed.",
      focus,
    } satisfies CriticVerdict;
  }

  return {
    approved: true,
    verdict: "accept",
    timingVerdict: pacing.timingVerdict,
    questionWorthAsking: pacing.questionWorthAsking,
    worthReason: pacing.worthReason,
    urgency: pacing.urgency,
    interruptionCost: pacing.interruptionCost,
    evidenceImportance: pacing.evidenceImportance,
    batchGroup: pacing.batchGroup,
    interruptsGoodFlow: pacing.interruptionCost === "high" && pacing.canDefer,
    canDefer: pacing.canDefer,
    wouldLikelySelfCorrect: false,
    autoCapturedEvidence: [],
    shouldWaitBeforeIntervening: false,
    reason: "reply_ok",
    specificity,
    intensity,
    explanation: "The reply is specific enough, pointed enough, and aligned with the current interviewer target.",
    focus,
  } satisfies CriticVerdict;
}

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function classifySpecificity(reply: string, decision: CandidateDecision) {
  const lower = reply.toLowerCase();
  const targetPhrase = decision.target.replaceAll("_", " ").toLowerCase();
  const issueTokens = (decision.specificIssue ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 4);
  const expectedTokens = (decision.expectedAnswer ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 4);
  const tokenHits = [...issueTokens, ...expectedTokens].filter((token) => lower.includes(token)).length;

  if (lower.includes(targetPhrase) || tokenHits >= 2) {
    return "high" as const;
  }
  if (tokenHits >= 1 || lower.includes("example") || lower.includes("expected output")) {
    return "medium" as const;
  }
  return "low" as const;
}

function classifyIntensity(reply: string, decision: CandidateDecision) {
  const lower = reply.toLowerCase();
  const sharpMarkers = /\b(exact|precise|justify|which exact|what exact|why is that acceptable|prove|convince me|highest-risk)\b/;
  const softMarkers = /\b(good start|sounds good|reasonable|keep going|nice|solid start)\b/;

  if (sharpMarkers.test(lower)) {
    return "sharp" as const;
  }
  if (softMarkers.test(lower) && requiresSharperPressure(decision)) {
    return "soft" as const;
  }
  return "balanced" as const;
}

function requiresSharperPressure(decision: CandidateDecision) {
  return ["probe_tradeoff", "probe_correctness", "ask_for_test_case", "ask_for_complexity", "ask_for_debug_plan"].includes(
    decision.action,
  );
}

function inferAutoCapturedEvidence(
  target: CandidateDecision["target"],
  collectedEvidence: string[],
  signals: CandidateSignalSnapshot,
) {
  const hits = new Set<string>();
  const has = (name: string) => collectedEvidence.includes(name);

  if ((target === "reasoning" || target === "correctness") && has("correctness_proof")) {
    hits.add("correctness_proof");
  }
  if ((target === "testing" || target === "edge_case") && (has("test_cases") || has("exact_test_outputs") || has("boundary_coverage"))) {
    if (has("test_cases")) hits.add("test_cases");
    if (has("exact_test_outputs")) hits.add("exact_test_outputs");
    if (has("boundary_coverage")) hits.add("boundary_coverage");
  }
  if ((target === "complexity" || target === "tradeoff") && has("complexity_tradeoff")) {
    hits.add("complexity_tradeoff");
  }
  if ((target === "implementation" || target === "approach") && (has("implementation_plan") || signals.readyToCode)) {
    hits.add("implementation_plan");
  }
  if (target === "summary" && (has("implementation_plan") || has("test_cases") || has("complexity_tradeoff"))) {
    hits.add("summary_ready");
  }

  return [...hits];
}

function resolveSelfCorrectionWindow(
  input: {
    reply: string;
    decision: CandidateDecision;
    signals: CandidateSignalSnapshot;
    currentStage: CodingInterviewStage;
    recentEvents?: SessionEventLike[];
    latestExecutionRun?: ExecutionRunLike | null;
  },
  pacing: {
    interruptionCost: "low" | "medium" | "high";
    canDefer: boolean;
  },
) {
  const failureLike =
    input.latestExecutionRun?.status === "FAILED" ||
    input.latestExecutionRun?.status === "ERROR" ||
    input.latestExecutionRun?.status === "TIMEOUT" ||
    input.signals.codeQuality === "buggy";
  const productiveFlow =
    input.signals.progress === "progressing" &&
    input.signals.communication === "clear" &&
    input.signals.behavior === "structured" &&
    input.signals.confidence >= 0.65;
  const stageAllowsWaiting = input.currentStage === "IMPLEMENTATION" || input.currentStage === "DEBUGGING";

  if (failureLike && productiveFlow && stageAllowsWaiting && pacing.canDefer && pacing.interruptionCost !== "low") {
    return {
      shouldWait: true,
      windowSeconds: 45,
      reason: "The candidate is still making progress on a likely fix, so it is better to give them a short self-correction window before intervening.",
      reply:
        "Keep going for another moment. I want to see whether you localize and fix this path yourself before I step in.",
    };
  }

  return {
    shouldWait: false,
    windowSeconds: undefined,
    reason: "",
    reply: "",
  };
}

function buildAutoCaptureReply(target: CandidateDecision["target"]) {
  switch (target) {
    case "complexity":
    case "tradeoff":
      return "You already surfaced the complexity and tradeoff clearly enough. Keep moving, and we can use that evidence in the final wrap-up.";
    case "testing":
    case "edge_case":
      return "You have already named the key validation cases well enough for now. Keep going, and we can revisit testing if a concrete gap appears in the code.";
    case "reasoning":
    case "correctness":
      return "You already gave enough correctness signal for this point. Keep moving, and we can sharpen the proof story after we see more code or validation evidence.";
    default:
      return "You have already supplied enough evidence on that point for now. Keep going.";
  }
}

function assessIssueGrounding(input: {
  decision: CandidateDecision;
  signals: CandidateSignalSnapshot;
  latestExecutionRun?: ExecutionRunLike | null;
}) {
  const latestRun = input.latestExecutionRun;
  const hasFailureSignal =
    latestRun?.status === "FAILED" ||
    latestRun?.status === "ERROR" ||
    latestRun?.status === "TIMEOUT" ||
    Boolean(latestRun?.stderr?.trim());
  const hasStructuredEvidence = input.signals.structuredEvidence.some((item) => {
    if (input.decision.specificIssue) {
      return item.issue === input.decision.specificIssue;
    }
    return item.area === input.decision.target || item.area === "debugging";
  });
  const hasReasoningEvidence = input.signals.reasoningDepth !== "thin" && input.signals.evidence.length > 0;

  if (input.decision.target === "debugging" && !hasFailureSignal && !hasStructuredEvidence) {
    return {
      issueGroundedInEvidence: false,
      reason: "There is no concrete failure signal yet, so pushing a bug hypothesis now risks a false positive.",
    };
  }

  if (
    ["correctness", "reasoning", "tradeoff", "complexity", "testing", "edge_case"].includes(input.decision.target) &&
    !hasStructuredEvidence &&
    !hasReasoningEvidence &&
    !input.decision.specificIssue
  ) {
    return {
      issueGroundedInEvidence: false,
      reason: "The interviewer does not yet have enough grounded evidence for this issue, so it should wait for a stronger signal.",
    };
  }

  return {
    issueGroundedInEvidence: true,
    reason: "The issue is grounded in evidence.",
  };
}
