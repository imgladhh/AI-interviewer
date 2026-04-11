import type { CodingInterviewStage } from "@/lib/assistant/stages";

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

export type CandidateUnderstandingState = "confused" | "partial" | "clear";
export type CandidateProgressState = "stuck" | "progressing" | "done";
export type CandidateCommunicationState = "unclear" | "mixed" | "clear";
export type CandidateCodeQualityState = "unknown" | "buggy" | "partial" | "correct";
export type CandidateAlgorithmChoiceState = "unknown" | "suboptimal" | "reasonable" | "strong";
export type CandidateEdgeCaseAwarenessState = "missing" | "partial" | "present";
export type CandidateBehaviorState = "structured" | "overthinking" | "rushing" | "balanced";
export type CandidateReasoningDepthState = "thin" | "moderate" | "deep";
export type CandidateTestingDisciplineState = "missing" | "partial" | "strong";
export type CandidateComplexityRigorState = "missing" | "partial" | "strong";
export type CandidateEvidenceItem = {
  area: "reasoning" | "testing" | "complexity" | "correctness" | "edge_case" | "debugging";
  issue: string;
  behavior: string;
  evidence: string;
  impact: string;
  fix: string;
};

export type CandidateSignalSnapshot = {
  understanding: CandidateUnderstandingState;
  progress: CandidateProgressState;
  communication: CandidateCommunicationState;
  codeQuality: CandidateCodeQualityState;
  algorithmChoice: CandidateAlgorithmChoiceState;
  edgeCaseAwareness: CandidateEdgeCaseAwarenessState;
  behavior: CandidateBehaviorState;
  readyToCode: boolean;
  reasoningDepth: CandidateReasoningDepthState;
  testingDiscipline: CandidateTestingDisciplineState;
  complexityRigor: CandidateComplexityRigorState;
  echoLikely?: boolean;
  echoStrength?: "low" | "medium" | "high";
  echoOverlapRatio?: number;
  echoReferenceQuestion?: string;
  confidence: number;
  evidence: string[];
  structuredEvidence: CandidateEvidenceItem[];
  summary: string;
  trendSummary?: string;
  source?: "heuristic" | "gemini-observer" | "openai-observer";
};

export function extractCandidateSignals(input: {
  currentStage: CodingInterviewStage;
  recentTranscripts: TranscriptLike[];
  recentEvents?: SessionEventLike[];
  latestExecutionRun?: ExecutionRunLike | null;
}): CandidateSignalSnapshot {
  const userTurns = input.recentTranscripts.filter((segment) => segment.speaker === "USER");
  const recentUserTurns = userTurns.slice(-3);
  const recentUserText = recentUserTurns.map((segment) => segment.text).join(" ").trim();
  const normalizedUserText = recentUserText.toLowerCase();
  const latestRun = input.latestExecutionRun;
  const recentEvents = input.recentEvents ?? [];
  const evidence: string[] = [];
  const priorSignals = collectPriorSignalSnapshots(recentEvents);
  const echoDetection = detectEchoResponse(input.recentTranscripts);

  const understanding = resolveUnderstandingState(normalizedUserText, input.currentStage, evidence);
  const progress = resolveProgressState(normalizedUserText, latestRun, recentEvents, evidence);
  const communication = resolveCommunicationState(recentUserTurns, evidence);
  const codeQuality = resolveCodeQualityState(normalizedUserText, latestRun, evidence);
  const algorithmChoice = resolveAlgorithmChoiceState(normalizedUserText, input.currentStage, evidence);
  const edgeCaseAwareness = resolveEdgeCaseAwarenessState(normalizedUserText, latestRun, evidence);
  const behavior = resolveBehaviorState(normalizedUserText, recentUserTurns, evidence);
  const readyToCode = resolveReadyToCode({
    normalizedUserText,
    currentStage: input.currentStage,
    understanding,
    progress,
    communication,
    algorithmChoice,
    behavior,
    evidence,
  });
  const reasoningDepth = resolveReasoningDepthState(normalizedUserText, recentUserTurns, evidence);
  const testingDiscipline = resolveTestingDisciplineState(normalizedUserText, latestRun, evidence);
  const complexityRigor = resolveComplexityRigorState(normalizedUserText, input.currentStage, evidence);
  const confidence = resolveConfidence({
    recentUserTurns,
    recentEvents,
    latestRun,
    understanding,
    progress,
    communication,
    reasoningDepth,
    testingDiscipline,
    complexityRigor,
  });
  const trendSummary = buildTrendSummary(priorSignals, {
    understanding,
    progress,
    codeQuality,
    edgeCaseAwareness,
    reasoningDepth,
    testingDiscipline,
    complexityRigor,
  });

  if (trendSummary) {
    evidence.push(trendSummary);
  }

  const structuredEvidence = buildStructuredEvidence({
    normalizedUserText,
    latestRun,
    understanding,
    progress,
    codeQuality,
    edgeCaseAwareness,
    reasoningDepth,
    testingDiscipline,
    complexityRigor,
    echoLikely: echoDetection.echoLikely,
    echoStrength: echoDetection.echoStrength,
  });

  if (echoDetection.echoLikely) {
    evidence.push(
      `Candidate likely echoed the interviewer prompt (${echoDetection.echoStrength} confidence, overlap=${echoDetection.echoOverlapRatio.toFixed(2)}).`,
    );
  }

  return {
    understanding,
    progress,
    communication,
    codeQuality,
    algorithmChoice,
    edgeCaseAwareness,
    behavior,
    readyToCode,
    reasoningDepth,
    testingDiscipline,
    complexityRigor,
    echoLikely: echoDetection.echoLikely,
    echoStrength: echoDetection.echoStrength,
    echoOverlapRatio: echoDetection.echoOverlapRatio,
    echoReferenceQuestion: echoDetection.referenceQuestion ?? undefined,
    confidence,
    evidence: dedupeEvidence(evidence).slice(0, 6),
    structuredEvidence,
    summary: buildSignalSummary({
      understanding,
      progress,
      communication,
      codeQuality,
      algorithmChoice,
      edgeCaseAwareness,
      behavior,
      readyToCode,
      reasoningDepth,
      testingDiscipline,
      complexityRigor,
    }),
    trendSummary: trendSummary ?? undefined,
    source: "heuristic",
  };
}

export async function extractCandidateSignalsSmart(input: {
  currentStage: CodingInterviewStage;
  recentTranscripts: TranscriptLike[];
  recentEvents?: SessionEventLike[];
  latestExecutionRun?: ExecutionRunLike | null;
}) {
  const heuristic = extractCandidateSignals(input);
  const providerSequence = resolveObserverProviderSequence();

  for (const provider of providerSequence) {
    try {
      const observed =
        provider === "gemini"
          ? await observeWithGemini(input, heuristic)
          : await observeWithOpenAI(input, heuristic);
      if (observed) {
        return observed;
      }
    } catch {
      // Fall through to the next provider or heuristics.
    }
  }

  return heuristic;
}

function resolveUnderstandingState(
  normalizedUserText: string,
  currentStage: CodingInterviewStage,
  evidence: string[],
): CandidateUnderstandingState {
  const hasClarificationSignals = /\b(constraint|input|output|assume|clarify|example|edge case)\b/.test(normalizedUserText);
  const soundsConfused = /\b(confused|not sure|don't understand|unclear|what is expected)\b/.test(normalizedUserText);

  if (soundsConfused) {
    evidence.push("Candidate explicitly sounded unsure about the prompt or constraints.");
    return "confused";
  }

  if (currentStage !== "PROBLEM_UNDERSTANDING" || hasClarificationSignals) {
    evidence.push("Candidate referenced constraints, examples, or output expectations.");
    return "clear";
  }

  evidence.push("Candidate has started reasoning, but prompt framing still looks incomplete.");
  return "partial";
}

function resolveProgressState(
  normalizedUserText: string,
  latestRun: ExecutionRunLike | null | undefined,
  recentEvents: SessionEventLike[],
  evidence: string[],
): CandidateProgressState {
  const explicitlyStuck = /\b(stuck|not sure|don't know|need help|lost)\b/.test(normalizedUserText);
  const passedRun = latestRun?.status === "PASSED";
  const recentFailedRuns = recentEvents.filter((event) => {
    if (event.eventType !== "CODE_RUN_COMPLETED") {
      return false;
    }

    const payload =
      typeof event.payloadJson === "object" && event.payloadJson !== null
        ? (event.payloadJson as Record<string, unknown>)
        : {};
    return payload.status === "FAILED" || payload.status === "ERROR" || payload.status === "TIMEOUT";
  }).length;

  if (passedRun) {
    evidence.push("Latest code run passed, which suggests the candidate has reached a working solution.");
    return "done";
  }

  if (explicitlyStuck || recentFailedRuns >= 2) {
    evidence.push("Candidate either asked for help or accumulated multiple recent failed runs.");
    return "stuck";
  }

  evidence.push("Candidate is still moving forward without a final success signal yet.");
  return "progressing";
}

function resolveCommunicationState(recentUserTurns: TranscriptLike[], evidence: string[]) {
  const averageWords =
    recentUserTurns.length === 0
      ? 0
      : recentUserTurns.reduce((total, turn) => total + turn.text.split(/\s+/).filter(Boolean).length, 0) /
        recentUserTurns.length;

  if (recentUserTurns.length >= 2 && averageWords >= 12) {
    evidence.push("Recent user turns were substantive enough to communicate reasoning clearly.");
    return "clear";
  }

  if (recentUserTurns.length >= 1 && averageWords >= 6) {
    evidence.push("Candidate communication was present but still somewhat compressed.");
    return "mixed";
  }

  evidence.push("Recent user turns were short, which limits visible reasoning.");
  return "unclear";
}

function resolveCodeQualityState(
  normalizedUserText: string,
  latestRun: ExecutionRunLike | null | undefined,
  evidence: string[],
): CandidateCodeQualityState {
  if (!latestRun) {
    return "unknown";
  }

  if (latestRun.status === "PASSED") {
    evidence.push("Latest implementation passed execution.");
    return "correct";
  }

  if (latestRun.status === "FAILED" || latestRun.status === "ERROR" || latestRun.status === "TIMEOUT") {
    evidence.push("Latest execution run failed, so current implementation quality is not yet reliable.");
    return "buggy";
  }

  if (/\b(test|edge case|fix|debug)\b/.test(normalizedUserText)) {
    evidence.push("Candidate is iterating on implementation but does not yet have a passing signal.");
    return "partial";
  }

  return "partial";
}

function resolveAlgorithmChoiceState(
  normalizedUserText: string,
  currentStage: CodingInterviewStage,
  evidence: string[],
): CandidateAlgorithmChoiceState {
  const strongSignals = /\b(hash map|sliding window|two pointers|binary search|heap|dfs|bfs|dynamic programming|prefix sum)\b/.test(
    normalizedUserText,
  );
  const weakSignals = /\b(brute force|nested loop|try everything)\b/.test(normalizedUserText);

  if (strongSignals) {
    evidence.push("Candidate named a recognizable data structure or algorithmic pattern.");
    return currentStage === "APPROACH_DISCUSSION" || currentStage === "IMPLEMENTATION" ? "strong" : "reasonable";
  }

  if (weakSignals) {
    evidence.push("Candidate still sounds close to a brute-force or weakly optimized direction.");
    return "suboptimal";
  }

  if (currentStage === "IMPLEMENTATION" || currentStage === "TESTING_AND_COMPLEXITY") {
    evidence.push("Candidate moved beyond pure framing, which suggests at least a workable algorithm choice.");
    return "reasonable";
  }

  return "unknown";
}

function resolveEdgeCaseAwarenessState(
  normalizedUserText: string,
  latestRun: ExecutionRunLike | null | undefined,
  evidence: string[],
): CandidateEdgeCaseAwarenessState {
  const mentionsEdgeCases = /\b(edge case|empty|single element|duplicate|null|boundary|corner case)\b/.test(normalizedUserText);

  if (mentionsEdgeCases) {
    evidence.push("Candidate explicitly mentioned boundary conditions or edge cases.");
    return "present";
  }

  if (latestRun?.status === "FAILED" || latestRun?.status === "ERROR") {
    evidence.push("Candidate has failing execution evidence without explicit edge-case discussion yet.");
    return "missing";
  }

  return "partial";
}

function resolveBehaviorState(normalizedUserText: string, recentUserTurns: TranscriptLike[], evidence: string[]) {
  const overthinkingSignals = /\b(maybe|probably|i think|i guess|not sure)\b/g;
  const overthinkingCount = (normalizedUserText.match(overthinkingSignals) ?? []).length;
  const rushingSignals = /\b(just|quickly|probably works|ship it|good enough)\b/.test(normalizedUserText);
  const structuredSignals = /\b(first|then|next|finally|step|example)\b/.test(normalizedUserText);
  const averageWords =
    recentUserTurns.length === 0
      ? 0
      : recentUserTurns.reduce((total, turn) => total + turn.text.split(/\s+/).filter(Boolean).length, 0) /
        recentUserTurns.length;

  if (overthinkingCount >= 3) {
    evidence.push("Candidate used many hedging phrases, which suggests overthinking or low confidence.");
    return "overthinking";
  }

  if (rushingSignals && averageWords < 14) {
    evidence.push("Candidate sounds eager to move on without much explanation.");
    return "rushing";
  }

  if (structuredSignals) {
    evidence.push("Candidate explanation used ordered structure and concrete sequencing.");
    return "structured";
  }

  return "balanced";
}

function resolveReadyToCode(input: {
  normalizedUserText: string;
  currentStage: CodingInterviewStage;
  understanding: CandidateUnderstandingState;
  progress: CandidateProgressState;
  communication: CandidateCommunicationState;
  algorithmChoice: CandidateAlgorithmChoiceState;
  behavior: CandidateBehaviorState;
  evidence: string[];
}) {
  const explicitlyReadyToImplement =
    /\b(ready to implement|ready to code|i can implement|i can code|let me code|let me implement|start coding|start implementing|write the code first|code it now|implement it now)\b/.test(
      input.normalizedUserText,
    );
  const mentionsConcreteDataStructure =
    /\b(hash map|hash table|dictionary|map|set|array|heap|stack|queue|pointer|two pointers|sliding window|binary search)\b/.test(
      input.normalizedUserText,
    );
  const mentionsConcreteImplementationStep =
    /\b(iterat|loop|scan|store|save|insert|update|look up|lookup|search|check|return|append)\b/.test(
      input.normalizedUserText,
    );
  const mentionsControlFlow =
    /\b(if|else|when|while iterating|as we iterate|for each number|for every number)\b/.test(input.normalizedUserText);
  const mentionsSolutionShape =
    /\b(target\s*-\s*\w+|indices?|index|return empty|return \[\]|one pass|single pass)\b/.test(
      input.normalizedUserText,
    );

  const hasImplementationEvidence =
    mentionsConcreteDataStructure &&
    mentionsConcreteImplementationStep &&
    (mentionsControlFlow || mentionsSolutionShape);

  if (
    explicitlyReadyToImplement &&
    input.understanding === "clear" &&
    (input.algorithmChoice === "reasonable" || input.algorithmChoice === "strong")
  ) {
    input.evidence.push("Candidate explicitly said they are ready to implement, so coding should start unless there is a strong contradiction.");
    return true;
  }

  if (
    hasImplementationEvidence &&
    input.understanding === "clear" &&
    input.progress === "progressing" &&
    (input.algorithmChoice === "reasonable" || input.algorithmChoice === "strong") &&
    input.communication !== "unclear" &&
    input.behavior !== "overthinking"
  ) {
    input.evidence.push("Candidate already described concrete implementation steps, so they look ready to start coding.");
    return true;
  }

  if (input.currentStage === "IMPLEMENTATION" && hasImplementationEvidence) {
    input.evidence.push("Candidate is already reasoning in concrete implementation terms.");
    return true;
  }

  return false;
}

function resolveReasoningDepthState(
  normalizedUserText: string,
  recentUserTurns: TranscriptLike[],
  evidence: string[],
): CandidateReasoningDepthState {
  const explainsWhy = /\b(because|therefore|which means|so that|reason|invariant|tradeoff)\b/.test(normalizedUserText);
  const usesConcreteWalkthrough = /\b(example|step by step|walk through|for instance)\b/.test(normalizedUserText);
  const totalWords = recentUserTurns.reduce(
    (sum, turn) => sum + turn.text.split(/\s+/).filter(Boolean).length,
    0,
  );

  if (explainsWhy && usesConcreteWalkthrough && totalWords >= 28) {
    evidence.push("Candidate tied the approach to reasons and walked through a concrete example.");
    return "deep";
  }

  if (explainsWhy || totalWords >= 16) {
    evidence.push("Candidate exposed some reasoning, but the chain of logic is still only partially explicit.");
    return "moderate";
  }

  evidence.push("Candidate mostly named an answer without unpacking the reasoning behind it.");
  return "thin";
}

function resolveTestingDisciplineState(
  normalizedUserText: string,
  latestRun: ExecutionRunLike | null | undefined,
  evidence: string[],
): CandidateTestingDisciplineState {
  const mentionedTesting = /\b(test|test case|edge case|boundary|corner case|empty|single element|duplicate)\b/.test(
    normalizedUserText,
  );
  const multipleTestIdeas =
    /(empty|single element|duplicate|boundary|corner case).*(empty|single element|duplicate|boundary|corner case)/.test(
      normalizedUserText,
    );

  if (mentionedTesting && multipleTestIdeas) {
    evidence.push("Candidate named multiple concrete tests or high-risk boundary cases.");
    return "strong";
  }

  if (mentionedTesting || latestRun?.status === "PASSED") {
    evidence.push("Candidate showed some validation instinct, but the test plan is still incomplete.");
    return "partial";
  }

  evidence.push("Candidate has not yet shown a concrete testing habit.");
  return "missing";
}

function resolveComplexityRigorState(
  normalizedUserText: string,
  currentStage: CodingInterviewStage,
  evidence: string[],
): CandidateComplexityRigorState {
  const mentionsComplexity = /\b(time complexity|space complexity|big-?o|o\([^)]+\)|linear|quadratic|logarithmic)\b/.test(
    normalizedUserText,
  );
  const mentionsTradeoff = /\b(tradeoff|memory|runtime|space|optimi[sz])\b/.test(normalizedUserText);

  if (mentionsComplexity && mentionsTradeoff) {
    evidence.push("Candidate discussed complexity with at least one tradeoff dimension.");
    return "strong";
  }

  if (mentionsComplexity || currentStage === "TESTING_AND_COMPLEXITY") {
    evidence.push("Candidate touched complexity, but not yet with full rigor.");
    return "partial";
  }

  evidence.push("Candidate has not yet articulated a confident complexity story.");
  return "missing";
}

function resolveConfidence(input: {
  recentUserTurns: TranscriptLike[];
  recentEvents?: SessionEventLike[];
  latestRun?: ExecutionRunLike | null;
  understanding: CandidateUnderstandingState;
  progress: CandidateProgressState;
  communication?: CandidateCommunicationState;
  reasoningDepth?: CandidateReasoningDepthState;
  testingDiscipline?: CandidateTestingDisciplineState;
  complexityRigor?: CandidateComplexityRigorState;
}) {
  let confidence = 0.45;

  if (input.recentUserTurns.length >= 2) {
    confidence += 0.15;
  }

  if (input.understanding === "clear") {
    confidence += 0.12;
  }

  if (input.progress === "done") {
    confidence += 0.18;
  } else if (input.progress === "stuck") {
    confidence -= 0.08;
  }

  if (input.latestRun?.status === "PASSED") {
    confidence += 0.1;
  }

  if (input.communication === "unclear") {
    confidence -= 0.08;
  } else if (input.communication === "clear") {
    confidence += 0.04;
  }

  if (input.reasoningDepth === "deep") {
    confidence += 0.04;
  } else if (input.reasoningDepth === "thin") {
    confidence -= 0.05;
  }

  if (input.testingDiscipline === "strong") {
    confidence += 0.03;
  } else if (input.testingDiscipline === "missing") {
    confidence -= 0.03;
  }

  if (input.complexityRigor === "strong") {
    confidence += 0.03;
  } else if (input.complexityRigor === "missing") {
    confidence -= 0.03;
  }

  const recentSignalSnapshots = collectPriorSignalSnapshots(input.recentEvents ?? []);
  const previous = recentSignalSnapshots.at(-1);
  if (previous) {
    const stateDisagreementScore = [
      previous.understanding && previous.understanding !== input.understanding,
      previous.progress && previous.progress !== input.progress,
      previous.reasoningDepth && previous.reasoningDepth !== input.reasoningDepth,
      previous.testingDiscipline && previous.testingDiscipline !== input.testingDiscipline,
      previous.complexityRigor && previous.complexityRigor !== input.complexityRigor,
    ].filter(Boolean).length;

    if (stateDisagreementScore >= 3) {
      confidence -= 0.08;
    } else if (stateDisagreementScore === 0) {
      confidence += 0.03;
    }
  }

  return Math.max(0.2, Math.min(0.95, Number(confidence.toFixed(2))));
}

function buildSignalSummary(input: {
  understanding: CandidateUnderstandingState;
  progress: CandidateProgressState;
  communication: CandidateCommunicationState;
  codeQuality: CandidateCodeQualityState;
  algorithmChoice: CandidateAlgorithmChoiceState;
  edgeCaseAwareness: CandidateEdgeCaseAwarenessState;
  behavior: CandidateBehaviorState;
  readyToCode: boolean;
  reasoningDepth: CandidateReasoningDepthState;
  testingDiscipline: CandidateTestingDisciplineState;
  complexityRigor: CandidateComplexityRigorState;
}) {
  return [
    `Understanding is ${input.understanding}`,
    `progress is ${input.progress}`,
    `communication is ${input.communication}`,
    `code quality is ${input.codeQuality}`,
    `algorithm choice is ${input.algorithmChoice}`,
    `edge-case awareness is ${input.edgeCaseAwareness}`,
    `behavior is ${input.behavior}`,
    `ready to code is ${input.readyToCode ? "yes" : "no"}`,
    `reasoning depth is ${input.reasoningDepth}`,
    `testing discipline is ${input.testingDiscipline}`,
    `complexity rigor is ${input.complexityRigor}`,
  ].join(", ");
}

function dedupeEvidence(evidence: string[]) {
  return evidence.filter((item, index) => evidence.indexOf(item) === index);
}

function collectPriorSignalSnapshots(events: SessionEventLike[]) {
  return events
    .filter((event) => event.eventType === "SIGNAL_SNAPSHOT_RECORDED")
    .slice(-3)
    .map((event) => {
      const payload =
        typeof event.payloadJson === "object" && event.payloadJson !== null
          ? (event.payloadJson as Record<string, unknown>)
          : {};
      const signals =
        typeof payload.signals === "object" && payload.signals !== null
          ? (payload.signals as Partial<CandidateSignalSnapshot>)
          : {};
      return signals;
    });
}

function buildTrendSummary(
  previousSignals: Array<Partial<CandidateSignalSnapshot>>,
  current: {
    understanding: CandidateUnderstandingState;
    progress: CandidateProgressState;
    codeQuality: CandidateCodeQualityState;
    edgeCaseAwareness: CandidateEdgeCaseAwarenessState;
    reasoningDepth: CandidateReasoningDepthState;
    testingDiscipline: CandidateTestingDisciplineState;
    complexityRigor: CandidateComplexityRigorState;
  },
) {
  const previous = previousSignals.at(-1);
  if (!previous) {
    return null;
  }

  const changes: string[] = [];

  if (previous.progress && previous.progress !== current.progress) {
    changes.push(`progress moved from ${previous.progress} to ${current.progress}`);
  }
  if (previous.codeQuality && previous.codeQuality !== current.codeQuality) {
    changes.push(`code quality changed from ${previous.codeQuality} to ${current.codeQuality}`);
  }
  if (previous.edgeCaseAwareness && previous.edgeCaseAwareness !== current.edgeCaseAwareness) {
    changes.push(`edge-case awareness shifted from ${previous.edgeCaseAwareness} to ${current.edgeCaseAwareness}`);
  }
  if (previous.reasoningDepth && previous.reasoningDepth !== current.reasoningDepth) {
    changes.push(`reasoning depth moved from ${previous.reasoningDepth} to ${current.reasoningDepth}`);
  }
  if (previous.testingDiscipline && previous.testingDiscipline !== current.testingDiscipline) {
    changes.push(`testing discipline moved from ${previous.testingDiscipline} to ${current.testingDiscipline}`);
  }
  if (previous.complexityRigor && previous.complexityRigor !== current.complexityRigor) {
    changes.push(`complexity rigor changed from ${previous.complexityRigor} to ${current.complexityRigor}`);
  }
  if (previous.understanding && previous.understanding !== current.understanding) {
    changes.push(`understanding changed from ${previous.understanding} to ${current.understanding}`);
  }

  if (changes.length === 0) {
    return "Candidate state is broadly stable relative to the previous snapshot.";
  }

  return `Recent state trend: ${changes.slice(0, 3).join("; ")}.`;
}

function resolveObserverProviderSequence() {
  const preferred = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const sequence: Array<"gemini" | "openai"> = [];

  if (preferred === "gemini" && process.env.GEMINI_API_KEY) {
    sequence.push("gemini");
  }
  if (preferred === "openai" && process.env.OPENAI_API_KEY) {
    sequence.push("openai");
  }

  if (!sequence.includes("gemini") && process.env.GEMINI_API_KEY) {
    sequence.push("gemini");
  }
  if (!sequence.includes("openai") && process.env.OPENAI_API_KEY) {
    sequence.push("openai");
  }

  return sequence;
}

async function observeWithGemini(
  input: {
    currentStage: CodingInterviewStage;
    recentTranscripts: TranscriptLike[];
    recentEvents?: SessionEventLike[];
    latestExecutionRun?: ExecutionRunLike | null;
  },
  heuristic: CandidateSignalSnapshot,
) {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 260,
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildSignalObserverPrompt(input, heuristic) }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`gemini observer failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  return parseObservedSignals(text, heuristic, "gemini-observer");
}

async function observeWithOpenAI(
  input: {
    currentStage: CodingInterviewStage;
    recentTranscripts: TranscriptLike[];
    recentEvents?: SessionEventLike[];
    latestExecutionRun?: ExecutionRunLike | null;
  },
  heuristic: CandidateSignalSnapshot,
) {
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 260,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are an interview observer. Return only compact JSON that follows the requested schema.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: buildSignalObserverPrompt(input, heuristic) }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`openai observer failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { output_text?: string };
  return parseObservedSignals(payload.output_text?.trim(), heuristic, "openai-observer");
}

function buildSignalObserverPrompt(
  input: {
    currentStage: CodingInterviewStage;
    recentTranscripts: TranscriptLike[];
    recentEvents?: SessionEventLike[];
    latestExecutionRun?: ExecutionRunLike | null;
  },
  heuristic: CandidateSignalSnapshot,
) {
  const recentTurns = input.recentTranscripts
    .slice(-4)
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join("\n");
  const latestRun = input.latestExecutionRun
    ? `status=${input.latestExecutionRun.status}; stdout=${input.latestExecutionRun.stdout ?? ""}; stderr=${input.latestExecutionRun.stderr ?? ""}`
    : "none";
  const recentEvents = (input.recentEvents ?? [])
    .slice(-8)
    .map((event) => event.eventType)
    .join(", ");
  const priorSignalHistory = collectPriorSignalSnapshots(input.recentEvents ?? [])
    .map((signals, index) => `Snapshot ${index + 1}: ${JSON.stringify(signals)}`)
    .join("\n");

  return [
    "You are an interview observer. Infer the candidate state from the recent coding interview evidence.",
    "Your job is not to coach or answer. Your job is to classify the candidate's current interview state as an evaluator.",
    "Use the heuristic baseline only as a fallback reference, not as ground truth.",
    "Prefer the most recent user turns, latest code run result, and latest interviewer decision signals over older context.",
    "If the evidence is mixed, choose the more conservative state rather than the more flattering one.",
    `Current stage: ${input.currentStage}`,
    `Recent conversation:\n${recentTurns || "No turns."}`,
    `Recent execution run: ${latestRun}`,
    `Recent events: ${recentEvents || "none"}`,
    `Recent candidate-state history:\n${priorSignalHistory || "none"}`,
    `Heuristic baseline: ${JSON.stringify(heuristic)}`,
    "Return JSON only with keys:",
    "understanding, progress, communication, codeQuality, algorithmChoice, edgeCaseAwareness, behavior, readyToCode, reasoningDepth, testingDiscipline, complexityRigor, echoLikely, echoStrength, echoOverlapRatio, confidence, evidence, structuredEvidence, summary, trendSummary",
    "Allowed values:",
    'understanding: "confused" | "partial" | "clear"',
    'progress: "stuck" | "progressing" | "done"',
    'communication: "unclear" | "mixed" | "clear"',
    'codeQuality: "unknown" | "buggy" | "partial" | "correct"',
    'algorithmChoice: "unknown" | "suboptimal" | "reasonable" | "strong"',
    'edgeCaseAwareness: "missing" | "partial" | "present"',
    'behavior: "structured" | "overthinking" | "rushing" | "balanced"',
    "readyToCode: boolean",
    'reasoningDepth: "thin" | "moderate" | "deep"',
    'testingDiscipline: "missing" | "partial" | "strong"',
    'complexityRigor: "missing" | "partial" | "strong"',
    "echoLikely: boolean",
    'echoStrength: "low" | "medium" | "high"',
    "echoOverlapRatio: number between 0 and 1",
    "evidence must be a short array of strings, max 4 items.",
    "structuredEvidence must be an array of up to 4 objects with keys: area, issue, behavior, evidence, impact, fix.",
    "summary must be one concise sentence.",
    "trendSummary should be one short sentence describing how the current state compares with the recent candidate-state history.",
    "Do not repeat the full heuristic baseline in summary or evidence unless the current evidence truly supports it.",
  ].join("\n\n");
}

function parseObservedSignals(
  text: string | undefined,
  heuristic: CandidateSignalSnapshot,
  source: "gemini-observer" | "openai-observer",
): CandidateSignalSnapshot | null {
  if (!text) {
    return null;
  }

  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<CandidateSignalSnapshot>;
    return {
      understanding: coerceEnum(parsed.understanding, ["confused", "partial", "clear"], heuristic.understanding),
      progress: coerceEnum(parsed.progress, ["stuck", "progressing", "done"], heuristic.progress),
      communication: coerceEnum(parsed.communication, ["unclear", "mixed", "clear"], heuristic.communication),
      codeQuality: coerceEnum(parsed.codeQuality, ["unknown", "buggy", "partial", "correct"], heuristic.codeQuality),
      algorithmChoice: coerceEnum(parsed.algorithmChoice, ["unknown", "suboptimal", "reasonable", "strong"], heuristic.algorithmChoice),
      edgeCaseAwareness: coerceEnum(parsed.edgeCaseAwareness, ["missing", "partial", "present"], heuristic.edgeCaseAwareness),
      behavior: coerceEnum(parsed.behavior, ["structured", "overthinking", "rushing", "balanced"], heuristic.behavior),
      readyToCode: typeof parsed.readyToCode === "boolean" ? parsed.readyToCode : heuristic.readyToCode,
      reasoningDepth: coerceEnum(parsed.reasoningDepth, ["thin", "moderate", "deep"], heuristic.reasoningDepth),
      testingDiscipline: coerceEnum(parsed.testingDiscipline, ["missing", "partial", "strong"], heuristic.testingDiscipline),
      complexityRigor: coerceEnum(parsed.complexityRigor, ["missing", "partial", "strong"], heuristic.complexityRigor),
      echoLikely: typeof parsed.echoLikely === "boolean" ? parsed.echoLikely : heuristic.echoLikely,
      echoStrength: coerceOptionalEnum(parsed.echoStrength, ["low", "medium", "high"], heuristic.echoStrength),
      echoOverlapRatio:
        typeof parsed.echoOverlapRatio === "number"
          ? Math.max(0, Math.min(1, Number(parsed.echoOverlapRatio.toFixed(2))))
          : heuristic.echoOverlapRatio,
      echoReferenceQuestion: heuristic.echoReferenceQuestion,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0.2, Math.min(0.95, Number(parsed.confidence.toFixed(2))))
          : heuristic.confidence,
      evidence:
        Array.isArray(parsed.evidence) && parsed.evidence.length > 0
          ? parsed.evidence.filter((item): item is string => typeof item === "string").slice(0, 6)
          : heuristic.evidence,
      structuredEvidence:
        Array.isArray(parsed.structuredEvidence) && parsed.structuredEvidence.length > 0
          ? parsed.structuredEvidence
              .map((item) => normalizeStructuredEvidenceItem(item))
              .filter((item): item is CandidateEvidenceItem => item !== null)
              .slice(0, 4)
          : heuristic.structuredEvidence,
      summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : heuristic.summary,
      trendSummary:
        typeof parsed.trendSummary === "string" && parsed.trendSummary.trim()
          ? parsed.trendSummary.trim()
          : heuristic.trendSummary,
      source,
    };
  } catch {
    return null;
  }
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    return fenced.trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1).trim();
  }

  return null;
}

function coerceEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function coerceOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T | undefined,
) {
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }
  return fallback;
}

function buildStructuredEvidence(input: {
  normalizedUserText: string;
  latestRun: ExecutionRunLike | null | undefined;
  understanding: CandidateUnderstandingState;
  progress: CandidateProgressState;
  codeQuality: CandidateCodeQualityState;
  edgeCaseAwareness: CandidateEdgeCaseAwarenessState;
  reasoningDepth: CandidateReasoningDepthState;
  testingDiscipline: CandidateTestingDisciplineState;
  complexityRigor: CandidateComplexityRigorState;
  echoLikely: boolean;
  echoStrength: "low" | "medium" | "high";
}) {
  const items: CandidateEvidenceItem[] = [];
  const mentionsInvariant = /\b(invariant|maintain|preserve|always true|after each step|before moving on)\b/.test(
    input.normalizedUserText,
  );
  const mentionsExampleWalkthrough = /\b(example|walk through|step by step|for instance)\b/.test(input.normalizedUserText);
  const mentionsComplexity = /\b(time complexity|space complexity|big-?o|o\([^)]+\)|linear|quadratic|logarithmic)\b/.test(
    input.normalizedUserText,
  );
  const mentionsTradeoff = /\b(tradeoff|memory|runtime|space|extra space|optimi[sz]|compared to|instead of)\b/.test(
    input.normalizedUserText,
  );
  const mentionsProofSketch = /\b(proof|prove|guarantee|why this works|must be true|correct because)\b/.test(
    input.normalizedUserText,
  );
  const mentionsExpectedOutputPrecision = /\b(expect|expected|should return|should produce|output should be|result should be)\b/.test(
    input.normalizedUserText,
  );
  const mentionsConstraintJustification = /\b(under these constraints|given the constraints|acceptable because|worth it because|since n|for this input size|because memory)\b/.test(
    input.normalizedUserText,
  );
  const mentionsBoundaryBreadth =
    /(empty|single element|duplicate|boundary|corner case|null|negative|zero).*(empty|single element|duplicate|boundary|corner case|null|negative|zero)/.test(
      input.normalizedUserText,
    );

  if (input.edgeCaseAwareness === "missing") {
    items.push({
      area: "edge_case",
      issue: "Edge-case handling is still underspecified.",
      behavior: "The candidate focused on the main path without naming boundary conditions.",
      evidence:
        input.latestRun?.status === "FAILED" || input.latestRun?.status === "ERROR"
          ? "There is a failing code run, but the candidate still did not name the edge case that could reproduce it."
          : "The recent explanation did not mention empty input, single-element input, duplicates, or other boundary cases.",
      impact: "Unseen boundary cases can break otherwise reasonable implementations in production.",
      fix: "Before closing the loop, name two or three high-risk edge cases and say what the code should do on each.",
    });
  } else if (input.edgeCaseAwareness === "partial" && !mentionsBoundaryBreadth) {
    items.push({
      area: "edge_case",
      issue: "Boundary coverage is still too narrow.",
      behavior: "The candidate mentioned validation, but only at a surface level.",
      evidence:
        "Recent turns referenced testing or edge cases, but they did not cover a broad enough set of boundary conditions like empty input, single-element input, or duplicate-heavy input.",
      impact: "Thin boundary coverage leaves obvious correctness gaps even when the happy path sounds plausible.",
      fix: "Name at least one empty or minimal input case and one high-risk boundary case, then say the exact expected output for each.",
    });
  }

  if (input.reasoningDepth === "thin") {
    items.push({
      area: "reasoning",
      issue: "Correctness reasoning is too implicit.",
      behavior: "The candidate named an approach but did not fully explain why it stays correct.",
      evidence: "Recent turns contain a proposed direction, but not a concrete invariant, example walkthrough, or explicit why-this-works argument.",
      impact: "Without visible reasoning, the interviewer cannot distinguish memorized patterns from true understanding.",
      fix: "After naming the approach, immediately explain one concrete example or invariant that makes the logic correct.",
    });
  } else if (input.reasoningDepth === "moderate" && !mentionsInvariant && !mentionsExampleWalkthrough) {
    items.push({
      area: "correctness",
      issue: "The correctness invariant is still underspecified.",
      behavior: "The candidate described the plan, but did not anchor it to an invariant or a concrete state transition.",
      evidence:
        "Recent turns explain the approach at a mid level, but they never state what remains true after each step or why each update preserves correctness.",
      impact: "When the invariant stays implicit, the interviewer still has weak evidence that the candidate truly understands why the algorithm works.",
      fix: "State one invariant explicitly, or walk through one concrete example and name what remains true after each step.",
    });
  } else if (input.reasoningDepth !== "deep" && !mentionsProofSketch && (mentionsInvariant || mentionsExampleWalkthrough)) {
    items.push({
      area: "correctness",
      issue: "The candidate is giving intuition, but not a real proof sketch.",
      behavior: "The explanation gestures at why the approach works, but stops before making the correctness argument explicit.",
      evidence:
        "Recent turns mention an invariant or example, but they do not finish the argument by explaining why that invariant or walkthrough is enough to guarantee correctness.",
      impact: "A good intuition without a proof sketch still leaves uncertainty about whether the candidate can defend the solution under pressure.",
      fix: "After the intuition, add one sentence that explicitly says why the invariant or example is sufficient to prove the logic is correct.",
    });
  }

  if (input.testingDiscipline === "missing") {
    items.push({
      area: "testing",
      issue: "Testing discipline is weak.",
      behavior: "The candidate is not proactively validating with explicit test cases.",
      evidence: "The discussion did not include a concrete test plan or named boundary cases before wrap-up.",
      impact: "Weak validation discipline makes it easier to ship code that only passes happy-path reasoning.",
      fix: "Always finish by naming at least one happy path, one boundary case, and one failure-prone case.",
    });
  } else if (input.testingDiscipline === "partial" && !mentionsExpectedOutputPrecision) {
    items.push({
      area: "testing",
      issue: "Test cases were mentioned, but the expected outputs stayed imprecise.",
      behavior: "The candidate named validation scenarios without stating what the code should actually return on them.",
      evidence:
        "Recent turns reference tests or edge cases, but they do not pin down the exact expected output or state for those cases.",
      impact: "When expected outputs are vague, testing sounds procedural rather than genuinely correctness-driven.",
      fix: "For each named test case, state the exact output or state the code should produce before moving on.",
    });
  }

  if (input.complexityRigor === "missing") {
    items.push({
      area: "complexity",
      issue: "Complexity analysis is still incomplete.",
      behavior: "The candidate has not yet articulated final time and space complexity with tradeoffs.",
      evidence: "Recent turns did not clearly state Big-O or explain what performance tradeoff the approach accepts.",
      impact: "A missing complexity story weakens the final hiring signal, especially for mid-level and above roles.",
      fix: "Close each solution with explicit time complexity, space complexity, and one tradeoff compared with alternatives.",
    });
  } else if (input.complexityRigor === "partial" && mentionsComplexity && !mentionsTradeoff) {
    items.push({
      area: "complexity",
      issue: "Complexity was named, but the tradeoff analysis stayed shallow.",
      behavior: "The candidate stated Big-O, but did not compare the approach against a meaningful alternative.",
      evidence:
        "Recent turns mention time or space complexity, but they do not explain why this complexity is acceptable or what memory/runtime tradeoff the solution is making.",
      impact: "A shallow complexity story makes it harder to tell whether the candidate can evaluate design choices beyond memorized final answers.",
      fix: "After giving Big-O, add one sentence that compares the chosen approach with a simpler or more memory-intensive alternative.",
    });
  } else if (input.complexityRigor === "partial" && mentionsTradeoff && !mentionsConstraintJustification) {
    items.push({
      area: "complexity",
      issue: "A tradeoff was named, but not justified against the actual constraints.",
      behavior: "The candidate acknowledged a tradeoff, but did not explain why it is acceptable for this problem setting.",
      evidence:
        "Recent turns mention runtime or memory tradeoffs, but they stop short of explaining why that tradeoff makes sense for the given constraints or expected input size.",
      impact: "Tradeoff analysis feels formulaic when it is not tied back to the problem's real constraints.",
      fix: "After naming the tradeoff, add one sentence explaining why that runtime or memory cost is acceptable under the actual constraints.",
    });
  }

  if (input.codeQuality === "buggy" && (input.latestRun?.status === "FAILED" || input.latestRun?.status === "ERROR")) {
    items.push({
      area: "debugging",
      issue: "The implementation is failing without a localized debugging hypothesis.",
      behavior: "The candidate has execution evidence of failure, but the next debugging move is still broad.",
      evidence:
        input.latestRun.stderr?.trim()
          ? `The latest execution failed with: ${input.latestRun.stderr.trim().slice(0, 140)}`
          : "The latest code run did not pass, but no narrow failing branch or state transition was named yet.",
      impact: "Broad debugging slows the interview down and makes recovery less likely under time pressure.",
      fix: "Choose one failing input, identify the first wrong state, and name the branch or line you would inspect first.",
    });
  }

  if (input.echoLikely) {
    items.push({
      area: "reasoning",
      issue: "The candidate echoed the interviewer question instead of giving a concrete answer.",
      behavior:
        input.echoStrength === "high"
          ? "The latest candidate turn strongly mirrors the interviewer wording."
          : "The latest candidate turn partially mirrors the interviewer wording.",
      evidence:
        input.echoStrength === "high"
          ? "The response overlap with the interviewer question is high and introduces little new technical content."
          : "The response repeats significant interviewer phrasing and adds limited answer-specific detail.",
      impact: "Echo turns consume interview time without adding evaluable evidence.",
      fix: "Answer in a forced format: pseudocode step, one test case, and final complexity in concise bullets.",
    });
  }

  return items.slice(0, 4);
}

function detectEchoResponse(transcripts: TranscriptLike[]): {
  echoLikely: boolean;
  echoStrength: "low" | "medium" | "high";
  echoOverlapRatio: number;
  referenceQuestion: string | null;
} {
  const lastUserIndex = findLastIndex(transcripts, (segment) => segment.speaker === "USER");
  if (lastUserIndex < 0) {
    return {
      echoLikely: false,
      echoStrength: "low",
      echoOverlapRatio: 0,
      referenceQuestion: null as string | null,
    };
  }

  const lastAiIndex = findLastIndex(
    transcripts.slice(0, lastUserIndex),
    (segment) => segment.speaker === "AI",
  );
  if (lastAiIndex < 0) {
    return {
      echoLikely: false,
      echoStrength: "low",
      echoOverlapRatio: 0,
      referenceQuestion: null as string | null,
    };
  }

  const aiText = normalizeEchoText(transcripts[lastAiIndex]?.text ?? "");
  const userText = normalizeEchoText(transcripts[lastUserIndex]?.text ?? "");
  if (!aiText || !userText) {
    return {
      echoLikely: false,
      echoStrength: "low",
      echoOverlapRatio: 0,
      referenceQuestion: null as string | null,
    };
  }

  const aiTokens = aiText.split(" ").filter(Boolean);
  const userTokens = userText.split(" ").filter(Boolean);
  if (aiTokens.length < 5 || userTokens.length < 4) {
    return {
      echoLikely: false,
      echoStrength: "low" as const,
      echoOverlapRatio: 0,
      referenceQuestion: transcripts[lastAiIndex]?.text ?? null,
    };
  }

  const aiSet = new Set(aiTokens);
  let overlapCount = 0;
  for (const token of userTokens) {
    if (aiSet.has(token)) {
      overlapCount += 1;
    }
  }
  const overlapRatio = overlapCount / Math.max(1, userTokens.length);
  const introducesNewContentRatio =
    userTokens.filter((token) => !aiSet.has(token)).length / Math.max(1, userTokens.length);
  const echoLikely = overlapRatio >= 0.72 && introducesNewContentRatio <= 0.35;
  const echoStrength: "low" | "medium" | "high" =
    overlapRatio >= 0.85 ? "high" : overlapRatio >= 0.72 ? "medium" : "low";

  return {
    echoLikely,
    echoStrength: echoLikely ? echoStrength : "low",
    echoOverlapRatio: Number(overlapRatio.toFixed(2)),
    referenceQuestion: transcripts[lastAiIndex]?.text ?? null,
  };
}

function normalizeEchoText(value: string) {
  return value
    .toLowerCase()
    .replace(/[`"'.,!?;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findLastIndex<T>(list: T[], predicate: (item: T) => boolean) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i] as T)) {
      return i;
    }
  }
  return -1;
}

function normalizeStructuredEvidenceItem(value: unknown): CandidateEvidenceItem | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const area = typeof record.area === "string" ? record.area : null;
  const allowedAreas = ["reasoning", "testing", "complexity", "correctness", "edge_case", "debugging"] as const;
  if (!area || !allowedAreas.includes(area as (typeof allowedAreas)[number])) {
    return null;
  }

  const issue = typeof record.issue === "string" ? record.issue.trim() : "";
  const behavior = typeof record.behavior === "string" ? record.behavior.trim() : "";
  const evidence = typeof record.evidence === "string" ? record.evidence.trim() : "";
  const impact = typeof record.impact === "string" ? record.impact.trim() : "";
  const fix = typeof record.fix === "string" ? record.fix.trim() : "";

  if (!issue || !behavior || !evidence || !impact || !fix) {
    return null;
  }

  return {
    area: area as CandidateEvidenceItem["area"],
    issue,
    behavior,
    evidence,
    impact,
    fix,
  };
}


