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

export const CODING_INTERVIEW_STAGES = [
  "PROBLEM_UNDERSTANDING",
  "APPROACH_DISCUSSION",
  "IMPLEMENTATION",
  "DEBUGGING",
  "TESTING_AND_COMPLEXITY",
  "WRAP_UP",
] as const;

export type CodingInterviewStage = (typeof CODING_INTERVIEW_STAGES)[number];

const STAGE_SET = new Set<string>(CODING_INTERVIEW_STAGES);

export function deriveCurrentCodingStage(input: {
  events?: SessionEventLike[];
  transcripts?: TranscriptLike[];
  latestExecutionRun?: ExecutionRunLike | null;
}): CodingInterviewStage {
  const latestStageEvent = [...(input.events ?? [])]
    .filter((event) => event.eventType === "STAGE_ADVANCED")
    .sort((left, right) => {
      const leftTime = new Date(left.eventTime ?? 0).getTime();
      const rightTime = new Date(right.eventTime ?? 0).getTime();
      return rightTime - leftTime;
    })
    .map((event) => asRecord(event.payloadJson).stage)
    .find(isCodingInterviewStage);

  if (latestStageEvent) {
    return latestStageEvent;
  }

  const latestRun = input.latestExecutionRun;
  if (latestRun?.status === "ERROR" || latestRun?.status === "FAILED" || latestRun?.status === "TIMEOUT") {
    return "DEBUGGING";
  }

  if (latestRun?.status === "PASSED") {
    return "TESTING_AND_COMPLEXITY";
  }

  const transcripts = input.transcripts ?? [];
  const latestUserTurn = [...transcripts].reverse().find((item) => item.speaker === "USER")?.text.toLowerCase() ?? "";
  const latestAiTurn = [...transcripts].reverse().find((item) => item.speaker === "AI")?.text.toLowerCase() ?? "";

  if (/\b(code|implement|write|function|loop)\b/.test(latestUserTurn)) {
    return "IMPLEMENTATION";
  }

  if (/\b(example|hash map|two pointers|sort|binary search|dfs|bfs|stack|queue)\b/.test(latestUserTurn)) {
    return "APPROACH_DISCUSSION";
  }

  if (latestAiTurn || latestUserTurn) {
    return "APPROACH_DISCUSSION";
  }

  return "PROBLEM_UNDERSTANDING";
}

export function describeCodingStage(stage: CodingInterviewStage) {
  switch (stage) {
    case "PROBLEM_UNDERSTANDING":
      return "Problem Understanding";
    case "APPROACH_DISCUSSION":
      return "Approach Discussion";
    case "IMPLEMENTATION":
      return "Implementation";
    case "DEBUGGING":
      return "Debugging";
    case "TESTING_AND_COMPLEXITY":
      return "Testing and Complexity";
    case "WRAP_UP":
      return "Wrap Up";
  }
}

export function stageGuidance(stage: CodingInterviewStage) {
  switch (stage) {
    case "PROBLEM_UNDERSTANDING":
      return "Confirm the candidate understands the prompt, constraints, and success criteria before moving into solution design.";
    case "APPROACH_DISCUSSION":
      return "Stay on approach quality: examples, invariants, tradeoffs, and why this direction is appropriate.";
    case "IMPLEMENTATION":
      return "Push toward concrete implementation details and ask focused questions that help the candidate translate the idea into code.";
    case "DEBUGGING":
      return "Use the latest runtime signal to drive debugging. Ask the candidate to localize the issue before suggesting fixes.";
    case "TESTING_AND_COMPLEXITY":
      return "Focus on edge cases, correctness validation, and time/space complexity articulation.";
    case "WRAP_UP":
      return "Close the loop with a concise recap, final tradeoffs, and any last improvement the candidate would make.";
  }
}

export function inferSuggestedCodingStage(input: {
  currentStage?: string | null;
  latestExecutionRun?: ExecutionRunLike | null;
  latestUserTurn?: string | null;
  reply?: string | null;
}): CodingInterviewStage {
  const currentStage = isCodingInterviewStage(input.currentStage) ? input.currentStage : "PROBLEM_UNDERSTANDING";
  const latestRun = input.latestExecutionRun;

  if (latestRun?.status === "ERROR" || latestRun?.status === "FAILED" || latestRun?.status === "TIMEOUT") {
    return "DEBUGGING";
  }

  if (latestRun?.status === "PASSED") {
    const latestUserText = (input.latestUserTurn ?? "").toLowerCase();
    if (/\b(complexity|o\(|time|space|edge case|test)\b/.test(latestUserText)) {
      return "WRAP_UP";
    }
    return "TESTING_AND_COMPLEXITY";
  }

  const combined = `${input.reply ?? ""} ${input.latestUserTurn ?? ""}`.toLowerCase();

  if (/\b(restate|clarify|constraint|input|output)\b/.test(combined)) {
    if (currentStage === "IMPLEMENTATION" || currentStage === "TESTING_AND_COMPLEXITY" || currentStage === "WRAP_UP") {
      return currentStage;
    }
    return "PROBLEM_UNDERSTANDING";
  }

  if (/\b(debug|bug|error|failing|fix)\b/.test(combined)) {
    return "DEBUGGING";
  }

  if (/\b(edge case|test|complexity|time complexity|space complexity|correctness)\b/.test(combined)) {
    return currentStage === "WRAP_UP" ? "WRAP_UP" : "TESTING_AND_COMPLEXITY";
  }

  if (/\b(code|implement|write|function|loop|pointer|index)\b/.test(combined)) {
    return currentStage === "TESTING_AND_COMPLEXITY" || currentStage === "WRAP_UP" ? currentStage : "IMPLEMENTATION";
  }

  if (/\b(approach|example|walk me through|tradeoff|data structure|algorithm)\b/.test(combined)) {
    if (currentStage === "IMPLEMENTATION" || currentStage === "TESTING_AND_COMPLEXITY" || currentStage === "WRAP_UP") {
      return currentStage;
    }
    return "APPROACH_DISCUSSION";
  }

  return currentStage;
}

export function isCodingInterviewStage(value: unknown): value is CodingInterviewStage {
  return typeof value === "string" && STAGE_SET.has(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
