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
  revisedReply?: string;
  questionWorthAsking: boolean;
  worthReason: string;
  reason:
    | "reply_ok"
    | "generic_reply"
    | "not_specific_enough"
    | "not_tough_enough"
    | "repeated_answered_target"
    | "should_move_to_implementation";
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

  if (shouldMoveToImplementation) {
    return {
      approved: false,
      verdict: "move_to_implementation",
      revisedReply:
        "Your approach is concrete enough now. Go ahead and implement it, and we can come back to correctness, testing, and tradeoffs after the code is written.",
      questionWorthAsking: false,
      worthReason: pacing.worthReason,
      reason: "should_move_to_implementation",
      specificity: "medium",
      intensity: "balanced",
      explanation: "The candidate is already ready to code, so more pre-code probing would hurt pacing.",
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
      revisedReply: input.decision.question,
      questionWorthAsking: true,
      worthReason: "The target is still worth asking, but this wording is too generic.",
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
      revisedReply: input.decision.question,
      questionWorthAsking: true,
      worthReason: "The interviewer is pressing on the right issue, but the question needs to be more specific.",
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
      revisedReply: input.decision.question,
      questionWorthAsking: true,
      worthReason: "The issue is worth probing, but the question needs more interviewing pressure.",
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
      revisedReply:
        "That is enough pre-code discussion. Go ahead and implement it now, and then we can review correctness and tradeoffs against the actual code.",
      questionWorthAsking: false,
      worthReason: pacing.worthReason,
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
    questionWorthAsking: pacing.questionWorthAsking,
    worthReason: pacing.worthReason,
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
