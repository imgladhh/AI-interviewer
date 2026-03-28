import { buildSkillsPrompt, DEFAULT_INTERVIEWER_SKILLS } from "@/lib/assistant/interviewer-skills";
import { makeCandidateDecision, type CandidateDecision } from "@/lib/assistant/decision_engine";
import {
  formatCodingInterviewPolicy,
  resolveCodingInterviewPolicy,
  type CodingInterviewPolicyAction,
  type CodingInterviewHintLevel,
  type CodingInterviewHintStyle,
} from "@/lib/assistant/policy";
import { extractCandidateSignalsSmart, type CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import {
  describeCodingStage,
  inferSuggestedCodingStage,
  isCodingInterviewStage,
  stageGuidance,
  type CodingInterviewStage,
} from "@/lib/assistant/stages";
import { estimateOpenAiTextCost, estimateTokens } from "@/lib/usage/cost";

type TranscriptLike = {
  speaker: "USER" | "AI" | "SYSTEM";
  text: string;
};

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

type GenerateAssistantTurnInput = {
  mode: string;
  questionTitle: string;
  questionPrompt: string;
  targetLevel?: string | null;
  selectedLanguage?: string | null;
  lowCostMode?: boolean;
  personaSummary?: string | null;
  appliedPromptContext?: string | null;
  currentStage?: string | null;
  recentTranscripts: TranscriptLike[];
  recentEvents?: Array<{
    eventType: string;
    eventTime?: Date | string;
    payloadJson?: unknown;
  }>;
  latestExecutionRun?: ExecutionRunLike | null;
};

type GenerateAssistantTurnResult = {
  reply: string;
  suggestedStage?: string;
  source: "fallback" | "openai" | "gemini";
  model?: string;
  policyAction?: CodingInterviewPolicyAction;
  policyReason?: string;
  hintServed?: boolean;
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
  escalationReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
  };
  signals?: CandidateSignalSnapshot;
  decision?: CandidateDecision;
  providerFailure?: {
    provider: "gemini" | "openai";
    message: string;
  };
};

export type StreamingAssistantTurnChunk = {
  textDelta?: string;
  final?: GenerateAssistantTurnResult;
};

export async function generateAssistantTurn(
  input: GenerateAssistantTurnInput,
): Promise<GenerateAssistantTurnResult> {
  const signals = await extractCandidateSignalsSmart({
    currentStage: normalizeStage(input.currentStage),
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const decision = buildDecision(input, signals);
  let providerFailure: GenerateAssistantTurnResult["providerFailure"] | undefined;

  for (const provider of resolveProviderSequence()) {
    if (provider === "gemini") {
      try {
        const reply = await generateWithGemini(input, signals, decision);
        if (reply) {
          return reply;
        }
        providerFailure = { provider: "gemini", message: "Gemini returned no reply." };
        logProviderFallback("gemini", providerFailure.message);
      } catch (error) {
        providerFailure = {
          provider: "gemini",
          message: error instanceof Error ? error.message : "Gemini request failed.",
        };
        logProviderFallback("gemini", providerFailure.message);
      }
      continue;
    }

    if (provider === "openai") {
      try {
        const reply = await generateWithOpenAI(input, signals, decision);
        if (reply) {
          return reply;
        }
        providerFailure = { provider: "openai", message: "OpenAI returned no reply." };
        logProviderFallback("openai", providerFailure.message);
      } catch (error) {
        providerFailure = {
          provider: "openai",
          message: error instanceof Error ? error.message : "OpenAI request failed.",
        };
        logProviderFallback("openai", providerFailure.message);
      }
    }
  }

  logProviderFallback("fallback", "Using local interviewer heuristics.");
  return generateFallbackTurn(input, signals, decision, providerFailure);
}

export async function* streamAssistantTurn(
  input: GenerateAssistantTurnInput,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamingAssistantTurnChunk> {
  const signals = await extractCandidateSignalsSmart({
    currentStage: normalizeStage(input.currentStage),
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const decision = buildDecision(input, signals);
  let providerFailure: GenerateAssistantTurnResult["providerFailure"] | undefined;

  for (const provider of resolveProviderSequence()) {
    if (provider === "gemini") {
      const geminiResult = yield* yieldProviderStream(streamWithGemini(input, signals, decision, options), input, "gemini");
      if (geminiResult.handled) {
        return;
      }
      providerFailure = geminiResult.providerFailure ?? {
        provider: "gemini",
        message: "Gemini did not produce a reply for this turn.",
      };
      logProviderFallback("gemini", providerFailure.message);
      continue;
    }

    if (provider === "openai") {
      const openAiResult = yield* yieldProviderStream(streamWithOpenAI(input, signals, decision, options), input, "openai");
      if (openAiResult.handled) {
        return;
      }
      providerFailure = openAiResult.providerFailure ?? {
        provider: "openai",
        message: "OpenAI did not produce a reply for this turn.",
      };
      logProviderFallback("openai", providerFailure.message);
    }
  }

  logProviderFallback("fallback", "Using local interviewer heuristics.");
  const fallback = generateFallbackTurn(input, signals, decision, providerFailure);
  for (const chunk of chunkText(fallback.reply)) {
    if (options?.signal?.aborted) {
      return;
    }
    yield { textDelta: chunk };
  }
  yield { final: fallback };
}

async function* yieldProviderStream(
  stream: AsyncGenerator<StreamingAssistantTurnChunk>,
  input: GenerateAssistantTurnInput,
  source: "openai" | "gemini",
): AsyncGenerator<
  StreamingAssistantTurnChunk,
  { handled: boolean; providerFailure?: GenerateAssistantTurnResult["providerFailure"] }
> {
  let accumulated = "";
  let yieldedAny = false;
  let yieldedFinal = false;

  try {
    for await (const chunk of stream) {
      yieldedAny = true;

      if (chunk.textDelta) {
        accumulated += chunk.textDelta;
      }

      if (chunk.final) {
        yieldedFinal = true;
      }

      yield chunk;
    }
  } catch (error) {
    return {
      handled: false,
      providerFailure: {
        provider: source,
        message: error instanceof Error ? error.message : `${source} streaming failed.`,
      },
    };
  }

  if (!yieldedAny) {
    return { handled: false };
  }

  if (!yieldedFinal && accumulated.trim()) {
    const final = finalizeReply(accumulated);
    yield {
      final: {
        reply: final,
        suggestedStage: inferStage(final, input),
        source,
      },
    };
  }

  return { handled: true };
}

function resolveProvider() {
  const preferred = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (preferred === "gemini" || preferred === "openai" || preferred === "fallback") {
    return preferred;
  }

  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return "fallback";
}

function resolveProviderSequence() {
  const preferred = resolveProvider();
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

async function generateWithOpenAI(
  input: GenerateAssistantTurnInput,
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
): Promise<GenerateAssistantTurnResult | null> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const prompt = buildInterviewerPrompt(input, signals, decision);
  const inputTokens = estimateTokens(buildSystemPrompt()) + estimateTokens(prompt);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: input.lowCostMode ? 180 : 320,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: buildSystemPrompt() }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw await buildProviderError("openai", response);
  }

  const payload = (await response.json()) as {
    output_text?: string;
  };

  const reply = payload.output_text?.trim();
  if (!reply) {
    return null;
  }

  const enforcedReply = enforceDecisionCompliance(reply, decision, input);

  return {
    reply: finalizeReply(enforcedReply),
    suggestedStage: inferStage(enforcedReply, input),
    source: "openai",
    model,
    signals,
    decision,
    usage: {
      inputTokens,
      outputTokens: estimateTokens(enforcedReply),
      estimatedCostUsd: estimateOpenAiTextCost(model, inputTokens, estimateTokens(enforcedReply)),
    },
  };
}

async function* streamWithOpenAI(
  input: GenerateAssistantTurnInput,
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamingAssistantTurnChunk> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const prompt = buildInterviewerPrompt(input, signals, decision);
  const inputTokens = estimateTokens(buildSystemPrompt()) + estimateTokens(prompt);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_output_tokens: input.lowCostMode ? 180 : 320,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: buildSystemPrompt() }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
    }),
    signal: options?.signal,
  }).catch(() => null);

  if (!response?.ok || !response.body) {
    if (response && !response.ok) {
      throw await buildProviderError("openai", response);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    if (options?.signal?.aborted) {
      return;
    }

    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const rawEvents = buffer.split("\n\n");
    buffer = rawEvents.pop() ?? "";

    for (const rawEvent of rawEvents) {
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) {
        continue;
      }

      if (parsed.type === "response.output_text.delta" && typeof parsed.payload?.delta === "string") {
        accumulated += parsed.payload.delta;
        yield { textDelta: parsed.payload.delta };
      }
    }
  }

  if (!accumulated.trim()) {
    return;
  }

  const final = finalizeReply(enforceDecisionCompliance(accumulated, decision, input));
  yield {
    final: {
        reply: final,
        suggestedStage: inferStage(final, input),
        source: "openai",
        model,
        signals,
        decision,
        usage: {
        inputTokens,
        outputTokens: estimateTokens(final),
        estimatedCostUsd: estimateOpenAiTextCost(model, inputTokens, estimateTokens(final)),
      },
    },
  };
}

async function generateWithGemini(
  input: GenerateAssistantTurnInput,
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
): Promise<GenerateAssistantTurnResult | null> {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const prompt = buildInterviewerPrompt(input, signals, decision);
  const inputTokens = estimateTokens(buildSystemPrompt()) + estimateTokens(prompt);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemPrompt() }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: input.lowCostMode ? 180 : 320,
        },
      }),
    },
  );

  if (!response.ok) {
    throw await buildProviderError("gemini", response);
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

  const reply = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!reply) {
    return null;
  }

  const enforcedReply = enforceDecisionCompliance(reply, decision, input);

  return {
    reply: finalizeReply(enforcedReply),
    suggestedStage: inferStage(enforcedReply, input),
    source: "gemini",
    model,
    signals,
    decision,
    usage: {
      inputTokens,
      outputTokens: estimateTokens(enforcedReply),
      estimatedCostUsd: null,
    },
  };
}

async function* streamWithGemini(
  input: GenerateAssistantTurnInput,
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamingAssistantTurnChunk> {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const prompt = buildInterviewerPrompt(input, signals, decision);
  const inputTokens = estimateTokens(buildSystemPrompt()) + estimateTokens(prompt);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemPrompt() }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: input.lowCostMode ? 180 : 320,
        },
      }),
      signal: options?.signal,
    },
  ).catch(() => null);

  if (!response?.ok || !response.body) {
    if (response && !response.ok) {
      throw await buildProviderError("gemini", response);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    if (options?.signal?.aborted) {
      return;
    }

    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const rawEvents = buffer.split("\n\n");
    buffer = rawEvents.pop() ?? "";

    for (const rawEvent of rawEvents) {
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) {
        continue;
      }

      const textDelta = extractGeminiText(parsed.payload);
      if (!textDelta) {
        continue;
      }

      accumulated += textDelta;
      yield { textDelta };
    }
  }

  if (!accumulated.trim()) {
    return;
  }

  const final = finalizeReply(enforceDecisionCompliance(accumulated, decision, input));
  yield {
    final: {
      reply: final,
      suggestedStage: inferStage(final, input),
      source: "gemini",
      model,
      signals,
      decision,
      usage: {
        inputTokens,
        outputTokens: estimateTokens(final),
        estimatedCostUsd: null,
      },
    },
  };
}

function buildSystemPrompt() {
  return [
    "You are a North American SDE coding interviewer.",
    "Keep replies concise, natural, and interview-like.",
    "Sound like a thoughtful human interviewer rather than a chatbot.",
    "Ask one focused follow-up question at a time.",
    "You must follow the supplied decision engine output for this turn.",
    "Treat the decision engine question as the required next interviewer move unless it would be unsafe or nonsensical.",
    "Do not replace a concrete decision-engine question with generic encouragement.",
    "Do not reveal full solutions unless the candidate explicitly asks for a hint.",
    "If the candidate mentions an approach, probe correctness, edge cases, complexity, or tradeoffs.",
    "Use basic interview etiquette: calm tone, clear transitions, and respectful pacing.",
    "Avoid repeating the exact same follow-up wording from your last turn.",
    "Prefer 1 to 3 sentences total, and keep the final sentence as the primary follow-up question.",
    "Return plain text only.",
    "Interviewer skills:\n" + buildSkillsPrompt(DEFAULT_INTERVIEWER_SKILLS),
  ].join(" ");
}

function buildInterviewerPrompt(
  input: GenerateAssistantTurnInput,
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
) {
  const stage = normalizeStage(input.currentStage);
  const policy = resolveCodingInterviewPolicy({
    currentStage: stage,
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const recentTurns = input.recentTranscripts
    .slice(input.lowCostMode ? -2 : -4)
    .map((item) => `${item.speaker}: ${truncate(item.text, input.lowCostMode ? 140 : 220)}`)
    .join("\n");

  return [
    `Mode: ${input.mode}`,
    `Question: ${input.questionTitle}`,
    `Prompt: ${input.questionPrompt}`,
    `Target level: ${input.targetLevel ?? "unspecified"}`,
    `Language: ${input.selectedLanguage ?? "unspecified"}`,
    `Current interview stage: ${describeCodingStage(stage)} (${stage})`,
    `Stage guidance: ${stageGuidance(stage)}`,
    `Interview policy:\n${formatCodingInterviewPolicy(policy)}`,
    `Candidate state snapshot: ${signals.summary}`,
    `Candidate state confidence: ${signals.confidence}`,
    `Candidate evidence:\n- ${signals.evidence.join("\n- ")}`,
    `Decision engine output: action=${decision.action}, target=${decision.target}, confidence=${decision.confidence}.`,
    `Decision reason: ${decision.reason}`,
    `Preferred next interviewer question: ${decision.question}`,
    `Required turn contract: the reply must execute decision action "${decision.action}" and target "${decision.target}".`,
    decision.hintStyle ? `Required hint style: ${decision.hintStyle}` : null,
    decision.hintLevel ? `Required hint level: ${decision.hintLevel}` : null,
    decision.suggestedStage ? `Suggested next stage after this turn: ${decision.suggestedStage}` : null,
    `Prompt strategy: ${policy.promptStrategy}. OPEN_ENDED means broader probing; GUIDED means narrower coaching; CONSTRAINED means ask the candidate to focus on one specific next step.`,
    `Persona summary: ${input.personaSummary ?? "generic interviewer"}`,
    `Applied prompt context: ${input.appliedPromptContext ?? "none"}`,
    input.latestExecutionRun
      ? `Latest code run: ${input.latestExecutionRun.status}. stdout=${truncate(input.latestExecutionRun.stdout ?? "", 180)} stderr=${truncate(input.latestExecutionRun.stderr ?? "", 180)}`
      : "Latest code run: none",
    `Latest AI turn: ${truncate(findLatestTurn(input.recentTranscripts, "AI") ?? "none", input.lowCostMode ? 140 : 220)}`,
    `Latest user turn: ${truncate(findLatestTurn(input.recentTranscripts, "USER") ?? "none", input.lowCostMode ? 140 : 220)}`,
    `Recent conversation:\n${recentTurns || "No turns yet."}`,
    "Write the interviewer's next single reply.",
    "The reply should explicitly align with the decision engine target and should usually reuse the decision engine question semantically, even if you rephrase it naturally.",
    "If the decision action is give_hint, provide a hint and not a generic probe.",
    "If the decision action is ask_for_test_case or ask_for_complexity, ask exactly for those signals rather than a broad open-ended follow-up.",
    "Advance the interview deliberately. Stay in the current stage unless there is a clear reason to move forward.",
    "Do not repeat the previous AI sentence verbatim.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function generateFallbackTurn(
  input: GenerateAssistantTurnInput,
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
  providerFailure?: GenerateAssistantTurnResult["providerFailure"],
): GenerateAssistantTurnResult {
  const latestUserTurn = [...input.recentTranscripts].reverse().find((item) => item.speaker === "USER");
  const latestAiTurn = [...input.recentTranscripts].reverse().find((item) => item.speaker === "AI");
  const latestRun = input.latestExecutionRun;
  const currentStage: CodingInterviewStage = isCodingInterviewStage(input.currentStage)
    ? input.currentStage
    : "PROBLEM_UNDERSTANDING";
  const policy = resolveCodingInterviewPolicy({
    currentStage,
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: latestRun,
  });

  if (!latestUserTurn && !latestAiTurn) {
    return {
      reply: `Let's get started with ${input.questionTitle}. Before you code, could you restate the problem in your own words and walk me through your initial approach?`,
      suggestedStage: "PROBLEM_UNDERSTANDING",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (policy.promptStrategy === "CONSTRAINED") {
    return {
      reply: withVariation(decision.question, latestAiTurn?.text, "Let's make this concrete. Pick one specific thing to inspect next, like a branch, pointer update, or edge case, and explain why you would start there."),
      suggestedStage: policy.nextStage ?? currentStage,
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (policy.promptStrategy === "GUIDED" && currentStage === "APPROACH_DISCUSSION") {
    return {
      reply: withVariation(decision.question, latestAiTurn?.text, "Let's tighten the approach. Name the state you keep, how it changes each step, and the condition that tells you you're done."),
      suggestedStage: currentStage,
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (policy.shouldServeHint) {
    const hintedReply = buildFallbackHintReply(policy.hintStyle, policy.hintLevel, latestRun, latestAiTurn?.text);
    return {
      reply: hintedReply,
      suggestedStage: policy.nextStage ?? currentStage,
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      hintServed: true,
      hintStyle: policy.hintStyle,
      hintLevel: policy.hintLevel,
      escalationReason: policy.escalationReason,
    };
  }

  if (latestRun?.status === "ERROR") {
    return {
      reply: withVariation(
        "I see the latest run hit an error. What do you think is causing it, and how would you debug it before changing the implementation?",
        latestAiTurn?.text,
        "Looks like the latest run failed. Where would you inspect first, and what specific bug do you suspect?",
      ),
      suggestedStage: "DEBUGGING",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (latestRun?.status === "TIMEOUT") {
    return {
      reply: withVariation(
        "The latest run timed out. Can you reason about the time complexity and what part of the implementation might be doing more work than expected?",
        latestAiTurn?.text,
        "The timeout is a useful signal. Which step of your solution is likely dominating the runtime, and how would you tighten it up?",
      ),
      suggestedStage: "COMPLEXITY_DISCUSSION",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (latestRun?.status === "PASSED") {
    return {
      reply: withVariation(
        "Your latest run completed successfully. Before we move on, what edge cases would you test next, and what are the time and space complexities?",
        latestAiTurn?.text,
        "Nice, that run completed. What edge cases are still worth checking, and how would you describe the final time and space complexity?",
      ),
      suggestedStage: "TESTING_AND_COMPLEXITY",
      source: "fallback",
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  const latestUserText = latestUserTurn?.text.toLowerCase() ?? "";
  const wordCount = latestUserText.split(/\s+/).filter(Boolean).length;

  if (currentStage === "PROBLEM_UNDERSTANDING") {
    if (/\b(hash map|two pointers|sort|stack|queue|binary search|dfs|bfs)\b/.test(latestUserText)) {
      return {
        reply: withVariation(
          "Good, that's a reasonable starting point. Walk me through one small example so I can see how that approach plays out step by step.",
          latestAiTurn?.text,
          "Okay, that sounds plausible. Use one concrete example and show me how your idea would evolve across the input.",
        ),
        suggestedStage: "APPROACH_DISCUSSION",
        source: "fallback",
        signals,
        decision,
        providerFailure,
        policyAction: policy.recommendedAction,
        policyReason: policy.reason,
      };
    }

    return {
      reply: withVariation(
        "Before we lock in an approach, what constraints or edge conditions matter most here, and how are you interpreting the expected output?",
        latestAiTurn?.text,
        "Let's stay on problem framing for a moment. What assumptions are you making about the input, and what would count as a correct output?",
      ),
      suggestedStage: "PROBLEM_UNDERSTANDING",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (latestUserText.includes("stuck") || latestUserText.includes("not sure") || latestUserText.includes("don't know")) {
    return {
      reply: withVariation(
        "Let's narrow it down. What data structure would help you look up or group information quickly here, and why?",
        latestAiTurn?.text,
        "No problem. If you simplify the problem first, what data structure seems most useful, and what would it buy you?",
      ),
      suggestedStage: "HINTING",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (wordCount <= 5) {
    return {
      reply: withVariation(
        "Could you make that a bit more concrete? Walk me through the steps on one small example.",
        latestAiTurn?.text,
        "Say a little more about that. Pick one example input and narrate exactly what your algorithm would do.",
      ),
      suggestedStage: "APPROACH_DISCUSSION",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (
    latestUserText.includes("hash map") ||
    latestUserText.includes("dictionary") ||
    latestUserText.includes("two pointers") ||
    latestUserText.includes("sort")
  ) {
    return {
      reply: withVariation(
        currentStage === "IMPLEMENTATION"
          ? "That approach sounds reasonable. As you code it, call out the core loop and any invariant that keeps the implementation correct."
          : "That sounds like a reasonable direction. Walk me through one concrete example and then tell me the expected time and space complexity.",
        latestAiTurn?.text,
        currentStage === "IMPLEMENTATION"
          ? "Okay, keep going at the implementation level. Which variables or pointers are carrying the key state, and how do they change over time?"
          : "Okay, that direction makes sense. Can you step through one example and explain why the data structure choice helps?",
      ),
      suggestedStage: currentStage === "IMPLEMENTATION" ? "IMPLEMENTATION" : "APPROACH_DISCUSSION",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (latestUserText.includes("complexity") || latestUserText.includes("o(")) {
    return {
      reply: withVariation(
        "Good. Now think about correctness: what invariants or edge cases would you use to convince yourself this approach is safe?",
        latestAiTurn?.text,
        "That covers complexity. Now help me believe the solution is correct: what invariant or edge case would you use to validate it?",
      ),
      suggestedStage: "CORRECTNESS_DISCUSSION",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    };
  }

  if (currentStage === "IMPLEMENTATION") {
    return {
      reply: withVariation(
        "Keep implementing, but narrate the key branches as you go. What is the trickiest line or condition in this solution?",
        latestAiTurn?.text,
        "As you write the code, focus on the part that's easiest to get wrong. Which branch or pointer update deserves the most care?",
      ),
      suggestedStage: "IMPLEMENTATION",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
    };
  }

  if (currentStage === "TESTING_AND_COMPLEXITY") {
    return {
      reply: withVariation(
        "Let's close the loop on validation. Which edge cases would you run, and what are the final time and space complexities?",
        latestAiTurn?.text,
        "Before we wrap, give me the edge cases you care about most and the final time and space complexity.",
      ),
      suggestedStage: "TESTING_AND_COMPLEXITY",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
    };
  }

  if (latestUserText.includes("edge case") || latestUserText.includes("empty") || latestUserText.includes("duplicate")) {
    return {
      reply: withVariation(
        "Good catch. How would your implementation handle that case, and do you need to change anything in the core logic?",
        latestAiTurn?.text,
        "That's a useful edge case. Would your current implementation already handle it, or would you adjust the logic?",
      ),
      suggestedStage: "CORRECTNESS_DISCUSSION",
      source: "fallback",
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
    };
  }

  return {
    reply: withVariation(
      decision.question,
      latestAiTurn?.text,
      currentStage === "WRAP_UP"
        ? "Give me a concise final summary: core idea, complexity, and one follow-up improvement you would consider."
        : "You're heading in a reasonable direction. Keep walking me through it step by step, and be explicit about assumptions and tradeoffs.",
    ),
    suggestedStage: currentStage === "WRAP_UP" ? "WRAP_UP" : "APPROACH_DISCUSSION",
    source: "fallback",
    signals,
    decision,
    providerFailure,
    policyAction: policy.recommendedAction,
    policyReason: policy.reason,
    escalationReason: policy.escalationReason,
  };
}

function inferStage(reply: string, input: GenerateAssistantTurnInput) {
  return inferSuggestedCodingStage({
    currentStage: input.currentStage,
    latestExecutionRun: input.latestExecutionRun,
    latestUserTurn: findLatestTurn(input.recentTranscripts, "USER"),
    reply,
  });
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function buildFallbackHintReply(
  hintStyle: CodingInterviewHintStyle | undefined,
  hintLevel: CodingInterviewHintLevel | undefined,
  latestRun: ExecutionRunLike | null | undefined,
  previousAiTurn?: string,
) {
  const intensityPrefix =
    hintLevel === "STRONG"
      ? "Stronger hint: "
      : hintLevel === "MEDIUM"
        ? "More direct hint: "
        : "Small hint: ";

  switch (hintStyle) {
    case "CLARIFYING_NUDGE":
      return withVariation(
        `${intensityPrefix}before choosing an algorithm, pin down the constraints and one representative example. That usually makes the right data structure much clearer.`,
        previousAiTurn,
        `${intensityPrefix}clarify the input constraints and walk one example first. That should make the solution space much narrower.`,
      );
    case "APPROACH_NUDGE":
      return withVariation(
        `${intensityPrefix}think about what information you want to retrieve quickly as you scan the input. Which data structure would make that lookup cheap?`,
        previousAiTurn,
        `${intensityPrefix}ask yourself what state you need to remember across the scan. A structure with fast lookup may simplify the approach.`,
      );
    case "IMPLEMENTATION_NUDGE":
      return withVariation(
        `${intensityPrefix}keep the core loop simple and name the state you need to preserve on each iteration. Focus on the one branch most likely to go wrong.`,
        previousAiTurn,
        `${intensityPrefix}identify the invariant for your main loop and code around that, rather than handling every case separately.`,
      );
    case "DEBUGGING_NUDGE":
      return withVariation(
        latestRun?.stderr
          ? `${intensityPrefix}start from the latest failure signal, especially this stderr clue: ${truncate(latestRun.stderr ?? "", 120)}. Which variable or branch does that point to first?`
          : `${intensityPrefix}compare the failing path against a tiny hand-worked example and check the first place where state diverges from your expectation.`,
        previousAiTurn,
        `${intensityPrefix}localize the failure before rewriting anything. Which exact line or state transition becomes wrong first?`,
      );
    case "TESTING_NUDGE":
      return withVariation(
        `${intensityPrefix}cover one happy path, one boundary case, and one case that stresses your main assumption. Then state the final time and space complexity explicitly.`,
        previousAiTurn,
        `${intensityPrefix}choose the edge case most likely to break your assumptions, then summarize the final complexity.`,
      );
    default:
      return `${intensityPrefix}narrow the problem to one concrete example and identify the single most useful piece of state to track.`;
  }
}

function finalizeReply(reply: string) {
  const normalized = reply.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return normalized;
  }

  if (/[.!?]["']?$/.test(normalized)) {
    return normalized;
  }

  const lastSentenceEnd = Math.max(
    normalized.lastIndexOf("."),
    normalized.lastIndexOf("?"),
    normalized.lastIndexOf("!"),
  );

  if (lastSentenceEnd >= normalized.length * 0.45) {
    return normalized.slice(0, lastSentenceEnd + 1).trim();
  }

  const lastClauseBreak = Math.max(
    normalized.lastIndexOf(","),
    normalized.lastIndexOf(";"),
    normalized.lastIndexOf(":"),
  );

  if (lastClauseBreak >= normalized.length * 0.65) {
    return `${normalized.slice(0, lastClauseBreak).trim()}.`;
  }

  return `${normalized}.`;
}

function findLatestTurn(transcripts: TranscriptLike[], speaker: TranscriptLike["speaker"]) {
  return [...transcripts].reverse().find((item) => item.speaker === speaker)?.text ?? null;
}

function withVariation(primary: string, previousAiTurn?: string, alternate?: string) {
  if (!previousAiTurn) {
    return primary;
  }

  const normalizedPrevious = previousAiTurn.trim().toLowerCase();
  if (normalizedPrevious === primary.trim().toLowerCase() && alternate) {
    return alternate;
  }

  return primary;
}

function* chunkText(text: string) {
  const parts = text.split(/(\s+)/).filter(Boolean);
  let buffer = "";

  for (const part of parts) {
    buffer += part;
    const wordCount = buffer.trim().split(/\s+/).filter(Boolean).length;
    if (/[.!?]["']?$/.test(part) || wordCount >= 5) {
      yield buffer;
      buffer = "";
    }
  }

  if (buffer.trim()) {
    yield buffer;
  }
}

function parseSseEvent(rawEvent: string) {
  const lines = rawEvent.split("\n");
  let payloadLine = "";

  for (const line of lines) {
    if (line.startsWith("data:")) {
      payloadLine += line.slice(5).trim();
    }
  }

  if (!payloadLine || payloadLine === "[DONE]") {
    return null;
  }

  try {
    const payload = JSON.parse(payloadLine) as Record<string, unknown>;
    return {
      type: typeof payload.type === "string" ? payload.type : "message",
      payload,
    };
  } catch {
    return null;
  }
}

function extractGeminiText(payload: Record<string, unknown>) {
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }

  const firstCandidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } };
  const parts = firstCandidate.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }

  return parts.map((part) => part.text ?? "").join("");
}

function logProviderFallback(provider: "gemini" | "openai" | "fallback", message: string) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.warn(`[assistant-turn] ${provider}: ${message}`);
}

async function buildProviderError(provider: "gemini" | "openai", response: Response) {
  const text = await response.text().catch(() => "");

  if (!text.trim()) {
    return new Error(`${provider} request failed with status ${response.status}.`);
  }

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const message =
      readProviderErrorMessage(payload) ??
      `${provider} request failed with status ${response.status}.`;
    return new Error(message);
  } catch {
    return new Error(`${provider} request failed with status ${response.status}: ${truncate(text, 220)}`);
  }
}

function readProviderErrorMessage(payload: Record<string, unknown>) {
  const error = payload.error;
  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return null;
}

function normalizeStage(stage: string | null | undefined): CodingInterviewStage {
  return isCodingInterviewStage(stage) ? stage : "PROBLEM_UNDERSTANDING";
}

function buildDecision(input: GenerateAssistantTurnInput, signals: CandidateSignalSnapshot) {
  const currentStage = normalizeStage(input.currentStage);
  const policy = resolveCodingInterviewPolicy({
    currentStage,
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });

  return makeCandidateDecision({
    currentStage,
    policy,
    signals,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
}

function enforceDecisionCompliance(
  reply: string,
  decision: CandidateDecision,
  input: GenerateAssistantTurnInput,
) {
  const normalized = reply.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return decision.question;
  }

  const lower = normalized.toLowerCase();
  const questionLower = decision.question.toLowerCase();
  const mentionsTarget =
    lower.includes(decision.target.replaceAll("_", " ")) ||
    lower.includes(questionLower.slice(0, Math.min(questionLower.length, 24)));

  const soundsGeneric =
    /\b(keep going|that sounds reasonable|reasonable direction|good start|nice start|continue|walk me through your approach step by step)\b/i.test(
      normalized,
    ) && !mentionsTarget;

  const requiresConcreteFollowup = ["ask_for_test_case", "ask_for_complexity", "ask_for_debug_plan", "give_hint"].includes(
    decision.action,
  );

  if (requiresConcreteFollowup && !mentionsTarget) {
    return decision.question;
  }

  if (soundsGeneric) {
    if (normalized.endsWith("?")) {
      return `${normalized} ${decision.question}`;
    }

    return `${normalized} ${decision.question}`;
  }

  if (input.lowCostMode && normalized.split(/\s+/).length > 55) {
    return decision.question;
  }

  return normalized;
}
