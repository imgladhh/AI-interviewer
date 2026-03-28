import { describeCodingStage, type CodingInterviewStage } from "@/lib/assistant/stages";

type TranscriptLike = {
  speaker: "USER" | "AI" | "SYSTEM";
  text: string;
};

type SessionEventLike = {
  eventType: string;
  eventTime?: Date | string;
  payloadJson?: unknown;
};

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

export type CodingInterviewPolicyAction =
  | "CLARIFY"
  | "PROBE_APPROACH"
  | "LET_IMPLEMENT"
  | "DEBUG_RUNTIME"
  | "VALIDATE_AND_TEST"
  | "WRAP_UP"
  | "SERVE_HINT";

export type CodingInterviewHintStyle =
  | "CLARIFYING_NUDGE"
  | "APPROACH_NUDGE"
  | "IMPLEMENTATION_NUDGE"
  | "DEBUGGING_NUDGE"
  | "TESTING_NUDGE";

export type CodingInterviewHintLevel = "LIGHT" | "MEDIUM" | "STRONG";
export type CodingInterviewPromptStrategy = "OPEN_ENDED" | "GUIDED" | "CONSTRAINED";

export type CodingInterviewChecklistItem = {
  label: string;
  satisfied: boolean;
};

export type CodingInterviewPolicy = {
  currentStage: CodingInterviewStage;
  recommendedAction: CodingInterviewPolicyAction;
  stageExitSatisfied: boolean;
  exitCriteria: string[];
  checklist: CodingInterviewChecklistItem[];
  nextStage?: CodingInterviewStage;
  shouldServeHint: boolean;
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
  promptStrategy: CodingInterviewPromptStrategy;
  escalationReason?: string;
  reason: string;
};

export function resolveCodingInterviewPolicy(input: {
  currentStage: CodingInterviewStage;
  recentTranscripts: TranscriptLike[];
  recentEvents?: SessionEventLike[];
  latestExecutionRun?: ExecutionRunLike | null;
}): CodingInterviewPolicy {
  const currentStage = input.currentStage;
  const latestUserTurn = findLatestTurn(input.recentTranscripts, "USER");
  const latestUserText = latestUserTurn.toLowerCase();
  const latestRun = input.latestExecutionRun;
  const recentEvents = input.recentEvents ?? [];
  const exitCriteria = getStageExitCriteria(currentStage);

  const hintRequestedRecently = wasHintRequestedRecently(recentEvents);
  const recentHintCount = countRecentHintEvents(recentEvents);
  const currentStageTurnCount = countTurnsSinceLastStageAdvance(recentEvents);
  const recentFailedRunCount = countRecentFailedRuns(recentEvents);
  const candidateExplicitlyAskedForHelp = /\b(hint|help|nudge|stuck|not sure|don't know|clue)\b/.test(latestUserText);
  const candidateSoundsStalled =
    currentStageTurnCount >= 4 &&
    /\b(try|maybe|probably|i think|not sure|confused|stuck|guess)\b/.test(latestUserText);
  const shouldServeHint = hintRequestedRecently || candidateExplicitlyAskedForHelp || candidateSoundsStalled;
  const hintLevel = shouldServeHint
    ? resolveHintLevel({
        recentHintCount,
        currentStage,
        currentStageTurnCount,
        recentFailedRunCount,
      })
    : undefined;
  const escalationReason = shouldServeHint
    ? resolveEscalationReason({
        hintRequestedRecently,
        candidateExplicitlyAskedForHelp,
        candidateSoundsStalled,
        recentFailedRunCount,
      })
    : undefined;
  const promptStrategy = resolvePromptStrategy({
    shouldServeHint,
    hintLevel,
    currentStageTurnCount,
    recentFailedRunCount,
  });

  if (latestRun?.status === "ERROR" || latestRun?.status === "FAILED" || latestRun?.status === "TIMEOUT") {
    const checklist = markChecklist(exitCriteria, [
      Boolean(/\b(null|index|off by one|condition|branch|loop|pointer|state|bug|fix)\b/.test(latestUserText)),
      Boolean(/\b(change|fix|update|correct|retry|rerun|test again)\b/.test(latestUserText)),
    ]);
    return {
      currentStage,
      recommendedAction: shouldServeHint ? "SERVE_HINT" : "DEBUG_RUNTIME",
      stageExitSatisfied: false,
      exitCriteria,
      checklist,
      nextStage: currentStage === "DEBUGGING" ? undefined : "DEBUGGING",
      shouldServeHint,
      hintStyle: shouldServeHint ? "DEBUGGING_NUDGE" : undefined,
      hintLevel,
      promptStrategy,
      escalationReason,
      reason: "The latest code run failed, so the interviewer should focus on debugging the concrete runtime issue.",
    };
  }

  if (latestRun?.status === "PASSED" && (currentStage === "IMPLEMENTATION" || currentStage === "DEBUGGING")) {
    return {
      currentStage,
      recommendedAction: "VALIDATE_AND_TEST",
      stageExitSatisfied: true,
      exitCriteria,
      checklist: markChecklist(exitCriteria, [true]),
      nextStage: "TESTING_AND_COMPLEXITY",
      shouldServeHint: false,
      promptStrategy: "GUIDED",
      escalationReason: undefined,
      reason: "The latest code run passed, so the interview should move from implementation/debugging into testing and complexity discussion.",
    };
  }

  if (currentStage === "PROBLEM_UNDERSTANDING") {
    const checklist = markChecklist(exitCriteria, [
      /\b(restate|constraint|input|output|assume|clarify)\b/.test(latestUserText),
      /\b(output|challenge|edge case|empty|duplicate|null|hash map|sort|two pointers|dfs|bfs|binary search|approach)\b/.test(
        latestUserText,
      ),
      /\b(example|for instance|suppose|if we had)\b/.test(latestUserText),
    ]);
    const stageExitSatisfied = checklist.every((item) => item.satisfied);

    return {
      currentStage,
      recommendedAction: shouldServeHint ? "SERVE_HINT" : "CLARIFY",
      stageExitSatisfied,
      exitCriteria,
      checklist,
      nextStage: stageExitSatisfied ? "APPROACH_DISCUSSION" : undefined,
      shouldServeHint,
      hintStyle: shouldServeHint ? "CLARIFYING_NUDGE" : undefined,
      hintLevel,
      promptStrategy,
      escalationReason,
      reason: stageExitSatisfied
        ? "The candidate has shown enough understanding of the prompt and constraints to move into approach discussion."
        : "The candidate still needs to confirm the problem framing, constraints, or output expectations.",
    };
  }

  if (currentStage === "APPROACH_DISCUSSION") {
    const checklist = markChecklist(exitCriteria, [
      /\b(example|walk through|hash map|sort|two pointers|tradeoff|algorithm)\b/.test(latestUserText),
      /\b(correct|because|invariant|so that|lookup|store|track)\b/.test(latestUserText),
      /\b(i('| a)?ll code|let me code|implement|write the code|start coding|loop|pointer|index|function|array)\b/.test(
        latestUserText,
      ),
    ]);
    const stageExitSatisfied = checklist.every((item) => item.satisfied);

    return {
      currentStage,
      recommendedAction: shouldServeHint ? "SERVE_HINT" : stageExitSatisfied ? "LET_IMPLEMENT" : "PROBE_APPROACH",
      stageExitSatisfied,
      exitCriteria,
      checklist,
      nextStage: stageExitSatisfied ? "IMPLEMENTATION" : undefined,
      shouldServeHint,
      hintStyle: shouldServeHint ? "APPROACH_NUDGE" : undefined,
      hintLevel,
      promptStrategy,
      escalationReason,
      reason: stageExitSatisfied
        ? "The candidate has described a concrete enough algorithm to move into implementation."
        : "The interviewer should keep probing correctness, examples, and tradeoffs before letting the candidate code.",
    };
  }

  if (currentStage === "IMPLEMENTATION") {
    const checklist = markChecklist(exitCriteria, [
      /\b(loop|pointer|index|function|map|array|stack|queue|return)\b/.test(latestUserText),
      latestRun?.status === "PASSED" ||
        /\b(pass|passed|edge case|test|complexity|time complexity|space complexity)\b/.test(latestUserText),
    ]);
    const stageExitSatisfied = checklist.every((item) => item.satisfied);

    return {
      currentStage,
      recommendedAction: shouldServeHint ? "SERVE_HINT" : stageExitSatisfied ? "VALIDATE_AND_TEST" : "LET_IMPLEMENT",
      stageExitSatisfied,
      exitCriteria,
      checklist,
      nextStage: stageExitSatisfied ? "TESTING_AND_COMPLEXITY" : undefined,
      shouldServeHint,
      hintStyle: shouldServeHint ? "IMPLEMENTATION_NUDGE" : undefined,
      hintLevel,
      promptStrategy,
      escalationReason,
      reason: stageExitSatisfied
        ? "The candidate is already talking about validation and complexity, so the interview can move out of raw implementation."
        : "The interviewer should let the candidate keep coding unless a code run forces a stage change.",
    };
  }

  if (currentStage === "DEBUGGING") {
    return {
      currentStage,
      recommendedAction: shouldServeHint ? "SERVE_HINT" : "DEBUG_RUNTIME",
      stageExitSatisfied: false,
      exitCriteria,
      checklist: markChecklist(exitCriteria, [Boolean(latestRun?.status === "PASSED")]),
      shouldServeHint,
      hintStyle: shouldServeHint ? "DEBUGGING_NUDGE" : undefined,
      hintLevel,
      promptStrategy,
      escalationReason,
      reason: "The current runtime/debug state should stay active until a passing run changes the situation.",
    };
  }

  if (currentStage === "TESTING_AND_COMPLEXITY") {
    const coveredTesting = /\b(edge case|test|empty|duplicate|null)\b/.test(latestUserText);
    const coveredComplexity = /\b(time complexity|space complexity|o\(|linear|quadratic)\b/.test(latestUserText);
    const coveredCorrectness = /\b(correct|invariant|proof|why this works)\b/.test(latestUserText);
    const checklist = markChecklist(exitCriteria, [coveredTesting, coveredComplexity, coveredCorrectness]);
    const stageExitSatisfied = checklist.every((item) => item.satisfied);

    return {
      currentStage,
      recommendedAction: shouldServeHint ? "SERVE_HINT" : stageExitSatisfied ? "WRAP_UP" : "VALIDATE_AND_TEST",
      stageExitSatisfied,
      exitCriteria,
      checklist,
      nextStage: stageExitSatisfied ? "WRAP_UP" : undefined,
      shouldServeHint,
      hintStyle: shouldServeHint ? "TESTING_NUDGE" : undefined,
      hintLevel,
      promptStrategy,
      escalationReason,
      reason: stageExitSatisfied
        ? "The candidate has covered both validation and complexity, so the interviewer can close the loop."
        : "The interviewer should keep the candidate on testing, correctness, and complexity articulation.",
    };
  }

  return {
    currentStage,
    recommendedAction: "WRAP_UP",
    stageExitSatisfied: true,
    exitCriteria,
    checklist: markChecklist(exitCriteria, [true]),
    shouldServeHint: false,
    promptStrategy: "GUIDED",
    escalationReason: undefined,
    reason: "The interview is in wrap-up mode and should stay there.",
  };
}

export function formatCodingInterviewPolicy(policy: CodingInterviewPolicy) {
  return [
    `Current stage: ${describeCodingStage(policy.currentStage)} (${policy.currentStage})`,
    `Recommended interviewer action: ${policy.recommendedAction}`,
    `Stage exit satisfied: ${policy.stageExitSatisfied ? "yes" : "no"}`,
    `Stage exit criteria: ${policy.exitCriteria.join("; ")}`,
    `Checklist: ${policy.checklist.map((item) => `${item.satisfied ? "[x]" : "[ ]"} ${item.label}`).join(" | ")}`,
    `Hint allowed now: ${policy.shouldServeHint ? "yes" : "no"}`,
    policy.hintStyle ? `Hint style: ${policy.hintStyle}` : null,
    policy.hintLevel ? `Hint level: ${policy.hintLevel}` : null,
    `Prompt strategy: ${policy.promptStrategy}`,
    policy.escalationReason ? `Hint escalation reason: ${policy.escalationReason}` : null,
    policy.nextStage ? `Recommended next stage: ${describeCodingStage(policy.nextStage)} (${policy.nextStage})` : null,
    `Policy reason: ${policy.reason}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function getStageExitCriteria(stage: CodingInterviewStage) {
  switch (stage) {
    case "PROBLEM_UNDERSTANDING":
      return [
        "Candidate has restated the task or clarified constraints.",
        "Candidate has identified the output expectations and core challenge.",
        "Candidate has grounded the discussion in at least one concrete example or edge condition.",
      ];
    case "APPROACH_DISCUSSION":
      return [
        "Candidate can explain the main algorithm on a concrete example.",
        "Candidate can justify why the data structure or approach is appropriate.",
        "Candidate is ready to translate the idea into code without major ambiguity.",
      ];
    case "IMPLEMENTATION":
      return [
        "Candidate has described the concrete implementation structure or key invariant.",
        "Candidate has either produced a passing implementation or is explicitly shifting to validation and complexity.",
      ];
    case "DEBUGGING":
      return [
        "The root cause of the failure is clearly isolated.",
        "A concrete fix is proposed or applied.",
      ];
    case "TESTING_AND_COMPLEXITY":
      return [
        "Candidate has discussed edge cases or validation strategy.",
        "Candidate has articulated time and space complexity.",
        "Candidate has justified why the approach is correct.",
      ];
    case "WRAP_UP":
      return ["Candidate has summarized the final approach and tradeoffs."];
  }
}

function markChecklist(labels: string[], satisfied: boolean[]): CodingInterviewChecklistItem[] {
  return labels.map((label, index) => ({
    label,
    satisfied: satisfied[index] ?? false,
  }));
}

function resolveHintLevel(input: {
  recentHintCount: number;
  currentStage: CodingInterviewStage;
  currentStageTurnCount: number;
  recentFailedRunCount: number;
}): CodingInterviewHintLevel {
  if (input.recentHintCount >= 3 || input.recentFailedRunCount >= 2) {
    return "STRONG";
  }

  if (
    input.recentHintCount >= 1 ||
    input.currentStageTurnCount >= 5 ||
    input.currentStage === "DEBUGGING" ||
    input.currentStage === "TESTING_AND_COMPLEXITY"
  ) {
    return "MEDIUM";
  }

  return "LIGHT";
}

function resolvePromptStrategy(input: {
  shouldServeHint: boolean;
  hintLevel?: CodingInterviewHintLevel;
  currentStageTurnCount: number;
  recentFailedRunCount: number;
}): CodingInterviewPromptStrategy {
  if (input.hintLevel === "STRONG" || input.recentFailedRunCount >= 2) {
    return "CONSTRAINED";
  }

  if (input.shouldServeHint || input.currentStageTurnCount >= 4 || input.hintLevel === "MEDIUM") {
    return "GUIDED";
  }

  return "OPEN_ENDED";
}

function resolveEscalationReason(input: {
  hintRequestedRecently: boolean;
  candidateExplicitlyAskedForHelp: boolean;
  candidateSoundsStalled: boolean;
  recentFailedRunCount: number;
}) {
  if (input.recentFailedRunCount >= 2) {
    return "multiple_recent_failures";
  }
  if (input.hintRequestedRecently) {
    return "explicit_hint_request";
  }
  if (input.candidateExplicitlyAskedForHelp) {
    return "candidate_asked_for_help";
  }
  if (input.candidateSoundsStalled) {
    return "stage_stall_detected";
  }
  return undefined;
}

function countRecentHintEvents(events: SessionEventLike[]) {
  return events.filter((event) => event.eventType === "HINT_REQUESTED" || event.eventType === "HINT_SERVED").length;
}

function countTurnsSinceLastStageAdvance(events: SessionEventLike[]) {
  const lastStageAdvanceAt = [...events]
    .filter((event) => event.eventType === "STAGE_ADVANCED")
    .sort(compareEventTimes)
    .at(-1);

  const threshold = new Date(lastStageAdvanceAt?.eventTime ?? 0).getTime();
  return events.filter((event) => {
    const time = new Date(event.eventTime ?? 0).getTime();
    return time >= threshold && (event.eventType === "CANDIDATE_SPOKE" || event.eventType === "AI_SPOKE");
  }).length;
}

function countRecentFailedRuns(events: SessionEventLike[]) {
  return events.filter((event) => {
    if (event.eventType !== "CODE_RUN_COMPLETED") {
      return false;
    }

    const payload = typeof event.payloadJson === "object" && event.payloadJson !== null
      ? (event.payloadJson as Record<string, unknown>)
      : {};

    return payload.status === "FAILED" || payload.status === "ERROR" || payload.status === "TIMEOUT";
  }).length;
}

function wasHintRequestedRecently(events: SessionEventLike[]) {
  const latestHintRequest = [...events]
    .filter((event) => event.eventType === "HINT_REQUESTED")
    .sort(compareEventTimes)
    .at(-1);
  const latestAiReply = [...events]
    .filter((event) => event.eventType === "AI_SPOKE")
    .sort(compareEventTimes)
    .at(-1);

  if (!latestHintRequest) {
    return false;
  }

  if (!latestAiReply) {
    return true;
  }

  return new Date(latestHintRequest.eventTime ?? 0).getTime() > new Date(latestAiReply.eventTime ?? 0).getTime();
}

function compareEventTimes(left: SessionEventLike, right: SessionEventLike) {
  return new Date(left.eventTime ?? 0).getTime() - new Date(right.eventTime ?? 0).getTime();
}

function findLatestTurn(transcripts: TranscriptLike[], speaker: TranscriptLike["speaker"]) {
  return [...transcripts].reverse().find((item) => item.speaker === speaker)?.text ?? "";
}
