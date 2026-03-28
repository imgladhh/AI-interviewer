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

export type CandidateSignalSnapshot = {
  understanding: CandidateUnderstandingState;
  progress: CandidateProgressState;
  communication: CandidateCommunicationState;
  codeQuality: CandidateCodeQualityState;
  algorithmChoice: CandidateAlgorithmChoiceState;
  edgeCaseAwareness: CandidateEdgeCaseAwarenessState;
  behavior: CandidateBehaviorState;
  confidence: number;
  evidence: string[];
  summary: string;
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

  const understanding = resolveUnderstandingState(normalizedUserText, input.currentStage, evidence);
  const progress = resolveProgressState(normalizedUserText, latestRun, recentEvents, evidence);
  const communication = resolveCommunicationState(recentUserTurns, evidence);
  const codeQuality = resolveCodeQualityState(normalizedUserText, latestRun, evidence);
  const algorithmChoice = resolveAlgorithmChoiceState(normalizedUserText, input.currentStage, evidence);
  const edgeCaseAwareness = resolveEdgeCaseAwarenessState(normalizedUserText, latestRun, evidence);
  const behavior = resolveBehaviorState(normalizedUserText, recentUserTurns, evidence);
  const confidence = resolveConfidence({
    recentUserTurns,
    latestRun,
    understanding,
    progress,
  });

  return {
    understanding,
    progress,
    communication,
    codeQuality,
    algorithmChoice,
    edgeCaseAwareness,
    behavior,
    confidence,
    evidence: dedupeEvidence(evidence).slice(0, 6),
    summary: buildSignalSummary({
      understanding,
      progress,
      communication,
      codeQuality,
      algorithmChoice,
      edgeCaseAwareness,
      behavior,
    }),
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

function resolveConfidence(input: {
  recentUserTurns: TranscriptLike[];
  latestRun?: ExecutionRunLike | null;
  understanding: CandidateUnderstandingState;
  progress: CandidateProgressState;
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

  return Math.max(0.2, Math.min(0.95, Number(confidence.toFixed(2))));
}

function buildSignalSummary(input: Omit<CandidateSignalSnapshot, "confidence" | "evidence" | "summary">) {
  return [
    `Understanding is ${input.understanding}`,
    `progress is ${input.progress}`,
    `communication is ${input.communication}`,
    `code quality is ${input.codeQuality}`,
    `algorithm choice is ${input.algorithmChoice}`,
    `edge-case awareness is ${input.edgeCaseAwareness}`,
    `behavior is ${input.behavior}`,
  ].join(", ");
}

function dedupeEvidence(evidence: string[]) {
  return evidence.filter((item, index) => evidence.indexOf(item) === index);
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

  return [
    "You are an interview observer. Infer the candidate state from the recent coding interview evidence.",
    `Current stage: ${input.currentStage}`,
    `Recent conversation:\n${recentTurns || "No turns."}`,
    `Recent execution run: ${latestRun}`,
    `Recent events: ${recentEvents || "none"}`,
    `Heuristic baseline: ${JSON.stringify(heuristic)}`,
    "Return JSON only with keys:",
    "understanding, progress, communication, codeQuality, algorithmChoice, edgeCaseAwareness, behavior, confidence, evidence, summary",
    "Allowed values:",
    'understanding: "confused" | "partial" | "clear"',
    'progress: "stuck" | "progressing" | "done"',
    'communication: "unclear" | "mixed" | "clear"',
    'codeQuality: "unknown" | "buggy" | "partial" | "correct"',
    'algorithmChoice: "unknown" | "suboptimal" | "reasonable" | "strong"',
    'edgeCaseAwareness: "missing" | "partial" | "present"',
    'behavior: "structured" | "overthinking" | "rushing" | "balanced"',
    "evidence must be a short array of strings, max 4 items.",
    "summary must be one concise sentence.",
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
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0.2, Math.min(0.95, Number(parsed.confidence.toFixed(2))))
          : heuristic.confidence,
      evidence:
        Array.isArray(parsed.evidence) && parsed.evidence.length > 0
          ? parsed.evidence.filter((item): item is string => typeof item === "string").slice(0, 6)
          : heuristic.evidence,
      summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : heuristic.summary,
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
