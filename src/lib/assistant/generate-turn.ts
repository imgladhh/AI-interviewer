import { buildSkillsPrompt, DEFAULT_INTERVIEWER_SKILLS } from "@/lib/assistant/interviewer-skills";
import { reviewInterviewerReply, type CriticVerdict } from "@/lib/assistant/critic";
import { makeCandidateDecision, type CandidateDecision } from "@/lib/assistant/decision_engine";
import type { HintGranularity, RescueMode } from "@/lib/assistant/hinting_ledger";
import type { HintTier, HintInitiator, HintRequestTiming, MomentumAtHint } from "@/lib/assistant/hint_strategy";
import {
  enforceSystemDesignNoCodeInvariant,
  formatCodingInterviewPolicy,
  resolveCodingInterviewPolicy,
  type InterviewPolicyAction,
  type CodingInterviewHintLevel,
  type CodingInterviewHintStyle,
  type SystemDesignPolicyAction,
} from "@/lib/assistant/policy";
import { buildFallbackReplyFromDecision, describeReplyStrategy } from "@/lib/assistant/reply_strategy";
import { extractCandidateSignalsSmart, type CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import { applyDecisionInvariants, buildDecisionJustification } from "@/lib/assistant/invariants";
import { assessLatentCalibration } from "@/lib/assistant/latent_calibration";
import {
  adaptPolicyToCandidateDna,
  assessCandidateDna,
  type CandidateDnaProfile,
} from "@/lib/assistant/candidate_dna";
import { decideInterviewerIntent, type IntentDecision } from "@/lib/assistant/interviewer_intent";
import { assessPassConditions, selectRelevantPassAssessment } from "@/lib/assistant/pass_conditions";
import { applyDecisionPressure, assessInterviewPacing } from "@/lib/assistant/pacing";
import { mapPersonaToPolicy } from "@/lib/assistant/policy-mapper";
import { getPolicyPreset, type PolicyArchetype } from "@/lib/assistant/policy-config";
import { assessFlowState } from "@/lib/assistant/flow_state";
import { estimateCandidateTrajectory, type TrajectoryEstimate } from "@/lib/assistant/trajectory_estimator";
import {
  describeCodingStage,
  inferSuggestedCodingStage,
  inferSuggestedSystemDesignStage,
  isCodingInterviewStage,
  isSystemDesignStage,
  stageGuidance,
  type CodingInterviewStage,
  type SystemDesignStage,
} from "@/lib/assistant/stages";
import { makeSystemDesignDecision, type SystemDesignDecision } from "@/lib/assistant/system_design_decision";
import { estimateOpenAiTextCost, estimateTokens } from "@/lib/usage/cost";
import { assessSessionBudget } from "@/lib/usage/budget";
import { resolveAssistantLeadInDelayMs } from "@/lib/voice/turn-taking";

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

type InterviewMode = "CODING" | "SYSTEM_DESIGN";

type GenerateAssistantTurnResult = {
  reply: string;
  suggestedStage?: string;
  source: "fallback" | "openai" | "gemini";
  model?: string;
  policyAction?: InterviewPolicyAction;
  policyReason?: string;
  hintServed?: boolean;
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
  rescueMode?: RescueMode;
  hintGranularity?: HintGranularity;
  hintTier?: HintTier;
  hintCost?: number;
  hintInitiator?: HintInitiator;
  hintRequestTiming?: HintRequestTiming;
  momentumAtHint?: MomentumAtHint;
  escalationReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
  };
  signals?: CandidateSignalSnapshot;
  decision?: CandidateDecision;
  intent?: IntentDecision;
  trajectory?: TrajectoryEstimate;
  candidateDna?: CandidateDnaProfile;
  shadowPolicy?: ShadowPolicyEvaluation;
  criticVerdict?: CriticVerdict;
  providerFailure?: {
    provider: "gemini" | "openai";
    message: string;
  };
};

type ShadowPolicyEvaluation = {
  archetype: PolicyArchetype;
  action: CandidateDecision["action"];
  target: CandidateDecision["target"];
  pressure?: CandidateDecision["pressure"];
  timing?: CandidateDecision["timing"];
  reason: string;
  diff: Array<"action" | "target" | "pressure" | "timing">;
  scoreDiff?: Array<{
    action: string;
    actualScore: number;
    shadowScore: number;
    delta: number;
  }>;
};

const PROVIDER_COOLDOWN_MS = 90_000;
const providerCooldowns: Partial<Record<"gemini" | "openai", number>> = {};

export type StreamingAssistantTurnChunk = {
  textDelta?: string;
  final?: GenerateAssistantTurnResult;
  meta?: {
    thinkingDelayMs: number;
    action?: string;
    pressure?: string;
    decisionComplexity?: number;
    speechCommitMode?: "stream_draft" | "commit_only";
  };
};

export async function generateAssistantTurn(
  input: GenerateAssistantTurnInput,
): Promise<GenerateAssistantTurnResult> {
  const mode = normalizeInterviewMode(input.mode);
  if (mode === "SYSTEM_DESIGN") {
    return generateSystemDesignAssistantTurn(input);
  }
  return generateCodingAssistantTurn(input);
}

async function generateSystemDesignAssistantTurn(
  input: GenerateAssistantTurnInput,
): Promise<GenerateAssistantTurnResult> {
  const currentStage = normalizeSystemDesignStage(input.currentStage);
  const signals = await extractCandidateSignalsSmart({
    currentStage: "PROBLEM_UNDERSTANDING",
    mode: "SYSTEM_DESIGN",
    systemDesignStage: currentStage,
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const decision = buildSystemDesignDecision(
    signals,
    currentStage,
    input.targetLevel,
    input.recentEvents,
    input.recentTranscripts,
  );
  const reply = buildSystemDesignFallbackReply(decision, findLatestTurn(input.recentTranscripts, "AI") ?? undefined);
  const suggestedStage = inferSuggestedSystemDesignStage({
    currentStage: currentStage,
    latestUserTurn: findLatestTurn(input.recentTranscripts, "USER"),
    reply,
    events: input.recentEvents,
  });

  return {
    reply: finalizeReply(reply),
    suggestedStage,
    source: "fallback",
    signals,
    decision,
    policyAction: decision.systemDesignActionType ?? decision.policyAction,
    policyReason: decision.reason,
  };
}

async function generateCodingAssistantTurn(
  input: GenerateAssistantTurnInput,
): Promise<GenerateAssistantTurnResult> {
  const signals = await extractCandidateSignalsSmart({
    currentStage: normalizeStage(input.currentStage),
    mode: normalizeInterviewMode(input.mode),
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const { decision, intent, trajectory, candidateDna, shadowPolicy } = buildDecision(input, signals);
  let providerFailure: GenerateAssistantTurnResult["providerFailure"] | undefined;

  for (const provider of resolveProviderSequence()) {
    if (provider === "gemini") {
      try {
        const reply = await generateWithGemini(input, signals, decision, intent, trajectory);
        if (reply) {
          return {
            ...reply,
            candidateDna,
            shadowPolicy,
          };
        }
        providerFailure = { provider: "gemini", message: "Gemini returned no reply." };
        logProviderFallback("gemini", providerFailure.message);
      } catch (error) {
        providerFailure = {
          provider: "gemini",
          message: error instanceof Error ? error.message : "Gemini request failed.",
        };
        rememberProviderFailure("gemini", providerFailure.message);
        logProviderFallback("gemini", providerFailure.message);
      }
      continue;
    }

    if (provider === "openai") {
      try {
        const reply = await generateWithOpenAI(input, signals, decision, intent, trajectory);
        if (reply) {
          return {
            ...reply,
            candidateDna,
            shadowPolicy,
          };
        }
        providerFailure = { provider: "openai", message: "OpenAI returned no reply." };
        logProviderFallback("openai", providerFailure.message);
      } catch (error) {
        providerFailure = {
          provider: "openai",
          message: error instanceof Error ? error.message : "OpenAI request failed.",
        };
        rememberProviderFailure("openai", providerFailure.message);
        logProviderFallback("openai", providerFailure.message);
      }
    }
  }

  logProviderFallback("fallback", "Using local interviewer heuristics.");
  return generateFallbackTurn(input, signals, decision, intent, trajectory, candidateDna, shadowPolicy, providerFailure);
}

export async function* streamAssistantTurn(
  input: GenerateAssistantTurnInput,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamingAssistantTurnChunk> {
  const mode = normalizeInterviewMode(input.mode);
  if (mode === "SYSTEM_DESIGN") {
    yield* streamSystemDesignAssistantTurn(input, options);
    return;
  }
  yield* streamCodingAssistantTurn(input, options);
}

async function* streamSystemDesignAssistantTurn(
  input: GenerateAssistantTurnInput,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamingAssistantTurnChunk> {
  const currentStage = normalizeSystemDesignStage(input.currentStage);
  const signals = await extractCandidateSignalsSmart({
    currentStage: "PROBLEM_UNDERSTANDING",
    mode: "SYSTEM_DESIGN",
    systemDesignStage: currentStage,
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const decision = buildSystemDesignDecision(
    signals,
    currentStage,
    input.targetLevel,
    input.recentEvents,
    input.recentTranscripts,
  );
  const reply = buildSystemDesignFallbackReply(decision, findLatestTurn(input.recentTranscripts, "AI") ?? undefined);
  const suggestedStage = inferSuggestedSystemDesignStage({
    currentStage: currentStage,
    latestUserTurn: findLatestTurn(input.recentTranscripts, "USER"),
    reply,
    events: input.recentEvents,
  });

  yield {
    meta: {
      thinkingDelayMs: resolveAssistantLeadInDelayMs({
        action: decision.action,
        pressure: decision.pressure,
        lowCostMode: input.lowCostMode,
      }),
      action: decision.action,
      pressure: decision.pressure,
      decisionComplexity: decision.totalScore,
      speechCommitMode: "commit_only",
    },
  };

  for (const chunk of chunkText(reply)) {
    if (options?.signal?.aborted) {
      return;
    }
    yield { textDelta: chunk };
  }

  yield {
    final: {
      reply: finalizeReply(reply),
      suggestedStage,
      source: "fallback",
      signals,
      decision,
      policyAction: decision.systemDesignActionType ?? decision.policyAction,
      policyReason: decision.reason,
    },
  };
}

async function* streamCodingAssistantTurn(
  input: GenerateAssistantTurnInput,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamingAssistantTurnChunk> {
  const signals = await extractCandidateSignalsSmart({
    currentStage: normalizeStage(input.currentStage),
    mode: normalizeInterviewMode(input.mode),
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const { decision, intent, trajectory, candidateDna, shadowPolicy } = buildDecision(input, signals);
  const decisionComplexity = assessDecisionComplexity(decision);
  const speechCommitMode = decisionComplexity >= 0.6 ? "commit_only" : "stream_draft";
  yield {
    meta: {
      thinkingDelayMs: resolveAssistantLeadInDelayMs({
        action: decision.action,
        pressure: decision.pressure,
        lowCostMode: input.lowCostMode,
        decisionComplexity,
        conversationHealthMode: decision.conversationHealthMode,
      }),
      action: decision.action,
      pressure: decision.pressure,
      decisionComplexity,
      speechCommitMode,
    },
  };
  let providerFailure: GenerateAssistantTurnResult["providerFailure"] | undefined;

  for (const provider of resolveProviderSequence()) {
    if (provider === "gemini") {
      const geminiResult = yield* yieldProviderStream(
        streamWithGemini(input, signals, decision, intent, trajectory, options),
        input,
        "gemini",
        { candidateDna, shadowPolicy },
      );
      if (geminiResult.handled) {
        return;
      }
      providerFailure = geminiResult.providerFailure ?? {
        provider: "gemini",
        message: "Gemini did not produce a reply for this turn.",
      };
      rememberProviderFailure("gemini", providerFailure.message);
      logProviderFallback("gemini", providerFailure.message);
      continue;
    }

    if (provider === "openai") {
      const openAiResult = yield* yieldProviderStream(
        streamWithOpenAI(input, signals, decision, intent, trajectory, options),
        input,
        "openai",
        { candidateDna, shadowPolicy },
      );
      if (openAiResult.handled) {
        return;
      }
      providerFailure = openAiResult.providerFailure ?? {
        provider: "openai",
        message: "OpenAI did not produce a reply for this turn.",
      };
      rememberProviderFailure("openai", providerFailure.message);
      logProviderFallback("openai", providerFailure.message);
    }
  }

  logProviderFallback("fallback", "Using local interviewer heuristics.");
  const fallback = generateFallbackTurn(
    input,
    signals,
    decision,
    intent,
    trajectory,
    candidateDna,
    shadowPolicy,
    providerFailure,
  );
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
  extras?: Pick<GenerateAssistantTurnResult, "candidateDna" | "shadowPolicy">,
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
        yield {
          ...chunk,
          final: {
            ...chunk.final,
            ...extras,
          },
        };
        continue;
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
          ...extras,
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

  const now = Date.now();
  const available = sequence.filter((provider) => {
    const cooldownUntil = providerCooldowns[provider];
    return !cooldownUntil || cooldownUntil <= now;
  });

  return available.length > 0 ? available : sequence;
}

async function generateWithOpenAI(
  input: GenerateAssistantTurnInput,
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
  intent: IntentDecision,
  trajectory: TrajectoryEstimate,
): Promise<GenerateAssistantTurnResult | null> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const prompt = buildInterviewerPrompt(input, signals, decision, intent, trajectory);
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

  const reviewed = await applyCriticPass(
    enforceDecisionCompliance(reply, decision, input),
    input,
    signals,
    decision,
    "openai",
  );
  const enforcedReply = reviewed.reply;

  return {
    reply: finalizeReply(enforcedReply),
    suggestedStage: inferStage(enforcedReply, input),
    source: "openai",
    model,
    signals,
    decision,
    intent,
    trajectory,
    criticVerdict: reviewed.verdict,
    hintServed: decision.action === "give_hint",
    hintStyle: decision.hintStyle,
    hintLevel: decision.hintLevel,
    rescueMode: decision.rescueMode,
    hintGranularity: decision.hintGranularity,
    hintTier: decision.hintTier,
    hintCost: decision.hintCost,
    hintInitiator: decision.hintInitiator,
    hintRequestTiming: decision.hintRequestTiming,
    momentumAtHint: decision.momentumAtHint,
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
  intent: IntentDecision,
  trajectory: TrajectoryEstimate,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamingAssistantTurnChunk> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const prompt = buildInterviewerPrompt(input, signals, decision, intent, trajectory);
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

  const reviewed = await applyCriticPass(
    enforceDecisionCompliance(accumulated, decision, input),
    input,
    signals,
    decision,
    "openai",
  );
  const final = finalizeReply(selectAuthoritativeStreamReply(accumulated, reviewed.reply, reviewed.verdict));
  yield {
    final: {
        reply: final,
        suggestedStage: inferStage(final, input),
        source: "openai",
        model,
        signals,
        decision,
        intent,
        trajectory,
        criticVerdict: reviewed.verdict,
        hintServed: decision.action === "give_hint",
        hintStyle: decision.hintStyle,
        hintLevel: decision.hintLevel,
        rescueMode: decision.rescueMode,
        hintGranularity: decision.hintGranularity,
        hintTier: decision.hintTier,
        hintCost: decision.hintCost,
        hintInitiator: decision.hintInitiator,
        hintRequestTiming: decision.hintRequestTiming,
        momentumAtHint: decision.momentumAtHint,
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
  intent: IntentDecision,
  trajectory: TrajectoryEstimate,
): Promise<GenerateAssistantTurnResult | null> {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const prompt = buildInterviewerPrompt(input, signals, decision, intent, trajectory);
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

  const reviewed = await applyCriticPass(
    enforceDecisionCompliance(reply, decision, input),
    input,
    signals,
    decision,
    "gemini",
  );
  const enforcedReply = reviewed.reply;

  return {
    reply: finalizeReply(enforcedReply),
    suggestedStage: inferStage(enforcedReply, input),
    source: "gemini",
    model,
    signals,
    decision,
    intent,
    trajectory,
    criticVerdict: reviewed.verdict,
    hintServed: decision.action === "give_hint",
    hintStyle: decision.hintStyle,
    hintLevel: decision.hintLevel,
    rescueMode: decision.rescueMode,
    hintGranularity: decision.hintGranularity,
    hintTier: decision.hintTier,
    hintCost: decision.hintCost,
    hintInitiator: decision.hintInitiator,
    hintRequestTiming: decision.hintRequestTiming,
    momentumAtHint: decision.momentumAtHint,
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
  intent: IntentDecision,
  trajectory: TrajectoryEstimate,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamingAssistantTurnChunk> {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const prompt = buildInterviewerPrompt(input, signals, decision, intent, trajectory);
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

  const reviewed = await applyCriticPass(
    enforceDecisionCompliance(accumulated, decision, input),
    input,
    signals,
    decision,
    "gemini",
  );
  const final = finalizeReply(selectAuthoritativeStreamReply(accumulated, reviewed.reply, reviewed.verdict));
  yield {
    final: {
      reply: final,
      suggestedStage: inferStage(final, input),
      source: "gemini",
      model,
        signals,
        decision,
        intent,
        trajectory,
        criticVerdict: reviewed.verdict,
        hintServed: decision.action === "give_hint",
        hintStyle: decision.hintStyle,
        hintLevel: decision.hintLevel,
        rescueMode: decision.rescueMode,
        hintGranularity: decision.hintGranularity,
        hintTier: decision.hintTier,
        hintCost: decision.hintCost,
        hintInitiator: decision.hintInitiator,
        hintRequestTiming: decision.hintRequestTiming,
        momentumAtHint: decision.momentumAtHint,
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
    "Do not over-praise. At most use one short acknowledgement clause before the real interviewer move.",
    "Avoid generic filler like 'keep going' or 'that sounds reasonable' unless you immediately follow with a concrete, high-signal question.",
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
  intent: IntentDecision,
  trajectory: TrajectoryEstimate,
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
  const sessionMemory = buildSessionMemorySummary(
    input.recentEvents,
    signals,
    decision,
    input.currentStage,
    input.latestExecutionRun,
  );
  const ledger = buildMemoryLedger({
    currentStage: stage,
    recentEvents: input.recentEvents,
    signals,
    latestExecutionRun: input.latestExecutionRun,
  });
  const calibration = assessLatentCalibration({
    signals,
    ledger,
    latestExecutionRun: input.latestExecutionRun,
  });
  const flowState = assessFlowState({
    currentStage: stage,
    signals,
    recentTranscripts: input.recentTranscripts,
  });
  const passConditions = assessPassConditions({
    currentStage: stage,
    signals,
    memory: ledger,
    latestExecutionRun: input.latestExecutionRun,
  });
  const relevantPassConditions = selectRelevantPassAssessment(
    decision.target,
    decision.suggestedStage ?? stage,
    passConditions,
  );

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
    `Candidate state trend: ${signals.trendSummary ?? "No clear state trend yet."}`,
    `Session memory: ${sessionMemory}`,
    `Latent calibration: candidate_ceiling=${calibration.candidateCeiling}, ease_of_execution=${calibration.easeOfExecution}, level_up_ready=${calibration.levelUpReady}, confidence_in_verdict=${calibration.confidenceInVerdict}.`,
    `Flow state: coding_burst=${flowState.codingBurst}, thinking_burst=${flowState.thinkingBurst}, mute_until_pause=${flowState.muteUntilPause}, context_reestablishment_cost=${flowState.contextReestablishmentCost}.`,
    `Interviewer intent: intent=${intent.intent}, target_signal=${intent.targetSignal ?? "none"}, expected_outcome=${intent.expectedOutcome}, urgency=${intent.urgency}, can_defer=${intent.canDefer}.`,
    `Intent reason: ${intent.reason}`,
    `Trajectory estimate: candidate_trajectory=${trajectory.candidateTrajectory}, expected_without_intervention=${trajectory.expectedWithNoIntervention}, intervention_value=${trajectory.interventionValue}, best_intervention=${trajectory.bestIntervention}, interruption_cost=${trajectory.interruptionCost}, evidence_gain_if_ask_now=${trajectory.evidenceGainIfAskNow}, confidence=${trajectory.confidence}.`,
    `Relevant pass conditions for ${relevantPassConditions.topic}: required=${relevantPassConditions.passConditions.join(", ")}; satisfied=${relevantPassConditions.satisfied.join(", ") || "none"}; missing=${relevantPassConditions.missing.join(", ") || "none"}.`,
    `Candidate state confidence: ${signals.confidence}`,
    `Candidate evidence:\n- ${signals.evidence.join("\n- ")}`,
    signals.structuredEvidence.length > 0
      ? `Structured candidate issues:\n${signals.structuredEvidence
          .map(
            (item) =>
              `- [${item.area}] issue=${item.issue}; evidence=${item.evidence}; impact=${item.impact}; fix=${item.fix}`,
          )
          .join("\n")}`
      : null,
    signals.structuredEvidence.length > 0
      ? `Primary issue groups in this turn: ${[...new Set(signals.structuredEvidence.map((item) => item.area))].join(", ")}`
      : null,
    `Reasoning depth: ${signals.reasoningDepth}`,
    `Testing discipline: ${signals.testingDiscipline}`,
    `Complexity rigor: ${signals.complexityRigor}`,
    `Decision engine output: action=${decision.action}, target=${decision.target}, confidence=${decision.confidence}, pressure=${decision.pressure ?? "neutral"}, urgency=${decision.urgency ?? "medium"}, can_defer=${decision.canDefer ?? false}, interruption_cost=${decision.interruptionCost ?? "medium"}, evidence_importance=${decision.evidenceImportance ?? "important"}, batchable=${decision.batchable ?? false}${decision.batchGroup ? `, batch_group=${decision.batchGroup}` : ""}.`,
    decision.passConditions?.length
      ? `Decision pass gate: topic=${decision.passConditionTopic ?? "none"}, required=${decision.passConditions.join(", ")}, missing=${decision.missingPassConditions?.join(", ") || "none"}.`
      : null,
    `Decision reason: ${decision.reason}`,
    decision.specificIssue ? `Specific issue to surface: ${decision.specificIssue}` : null,
    decision.targetCodeLine ? `Target code line or focus area: ${decision.targetCodeLine}` : null,
    decision.expectedAnswer ? `Expected answer shape: ${decision.expectedAnswer}` : null,
    `Preferred next interviewer question: ${decision.question}`,
    `Required turn contract: the reply must execute decision action "${decision.action}" and target "${decision.target}".`,
    decision.specificIssue
      ? `Issue-specific instruction: the turn should directly address this issue without drifting away: ${decision.specificIssue}`
      : null,
    decision.expectedAnswer
      ? `Expected answer contract: push the candidate toward this exact answer shape: ${decision.expectedAnswer}`
      : null,
    `Reply strategy: ${describeReplyStrategy(decision, signals)}`,
    decision.hintStyle ? `Required hint style: ${decision.hintStyle}` : null,
    decision.hintLevel ? `Required hint level: ${decision.hintLevel}` : null,
    decision.rescueMode ? `Hint rescue mode: ${decision.rescueMode}` : null,
    decision.hintGranularity ? `Hint granularity: ${decision.hintGranularity}` : null,
    decision.hintTier ? `Hint tier: ${decision.hintTier}` : null,
    typeof decision.hintCost === "number" ? `Hint cost score: ${decision.hintCost}` : null,
    decision.suggestedStage ? `Suggested next stage after this turn: ${decision.suggestedStage}` : null,
    `Prompt strategy: ${policy.promptStrategy}. OPEN_ENDED means broader probing; GUIDED means narrower coaching; CONSTRAINED means ask the candidate to focus on one specific next step.`,
    improvingOrWorseningInstruction(signals.trendSummary),
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
    "If the decision action is ask_for_clarification, do not pretend certainty. Ask a tiny-example or expectation-check question first.",
    "If can_defer is true and interruption_cost is higher than urgency, prefer preserving the candidate's flow over collecting optional evidence immediately.",
    "If batchable is true, avoid interrupting for a single optional point when that evidence can be collected later as part of the same batch group.",
    "If flow state says mute_until_pause=true, do not interrupt with optional or medium-urgency probes unless the decision is critical.",
    "If latent calibration says level_up_ready=true and the candidate is already handling the base problem smoothly, it is acceptable to probe the candidate's ceiling rather than repeating foundational checks.",
    "If the recent state trend is worsening, reduce breadth and ask a narrower, more local follow-up.",
    "If the recent state trend is improving, do not over-interrupt. Keep the candidate moving while still protecting the key signal the decision engine wants.",
    "Prefer 1 or 2 sentences. The last sentence should usually be the concrete follow-up or instruction.",
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
  intent: IntentDecision,
  trajectory: TrajectoryEstimate,
  candidateDna: CandidateDnaProfile,
  shadowPolicy: ShadowPolicyEvaluation,
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
  const finalizeFallback = (
    result: Omit<GenerateAssistantTurnResult, "candidateDna" | "shadowPolicy">,
  ): GenerateAssistantTurnResult => ({
    ...result,
    candidateDna,
    shadowPolicy,
  });

  if (!latestUserTurn && !latestAiTurn) {
    return finalizeFallback({
      reply: `Let's get started with ${input.questionTitle}. Before you code, could you restate the problem in your own words and walk me through your initial approach?`,
      suggestedStage: "PROBLEM_UNDERSTANDING",
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    });
  }

  if (policy.promptStrategy === "CONSTRAINED") {
    return finalizeFallback({
      reply: withVariation(decision.question, latestAiTurn?.text, "Let's make this concrete. Pick one specific thing to inspect next, like a branch, pointer update, or edge case, and explain why you would start there."),
      suggestedStage: policy.nextStage ?? currentStage,
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    });
  }

  if (policy.promptStrategy === "GUIDED" && currentStage === "APPROACH_DISCUSSION") {
    return finalizeFallback({
      reply: withVariation(decision.question, latestAiTurn?.text, "Let's tighten the approach. Name the state you keep, how it changes each step, and the condition that tells you you're done."),
      suggestedStage: currentStage,
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    });
  }

  if (policy.shouldServeHint) {
    const hintedReply = buildFallbackHintReply(policy.hintStyle, policy.hintLevel, latestRun, latestAiTurn?.text);
    return finalizeFallback({
      reply: hintedReply,
      suggestedStage: policy.nextStage ?? currentStage,
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      hintServed: true,
      hintStyle: decision.hintStyle ?? policy.hintStyle,
      hintLevel: decision.hintLevel ?? policy.hintLevel,
      rescueMode: decision.rescueMode,
      hintGranularity: decision.hintGranularity,
      hintTier: decision.hintTier,
      hintCost: decision.hintCost,
      hintInitiator: decision.hintInitiator,
      hintRequestTiming: decision.hintRequestTiming,
      momentumAtHint: decision.momentumAtHint,
      escalationReason: policy.escalationReason,
    });
  }

  if (latestRun?.status === "ERROR") {
    return finalizeFallback({
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
    });
  }

  if (latestRun?.status === "TIMEOUT") {
    return finalizeFallback({
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
    });
  }

  if (latestRun?.status === "PASSED") {
    return finalizeFallback({
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
    });
  }

  const latestUserText = latestUserTurn?.text.toLowerCase() ?? "";
  const wordCount = latestUserText.split(/\s+/).filter(Boolean).length;

  if (currentStage === "PROBLEM_UNDERSTANDING") {
    if (/\b(hash map|two pointers|sort|stack|queue|binary search|dfs|bfs)\b/.test(latestUserText)) {
      return finalizeFallback({
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
      });
    }

    return finalizeFallback({
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
    });
  }

  if (latestUserText.includes("stuck") || latestUserText.includes("not sure") || latestUserText.includes("don't know")) {
    return finalizeFallback({
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
    });
  }

  if (wordCount <= 5) {
    return finalizeFallback({
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
    });
  }

  const strategicReply = buildFallbackReplyFromDecision({
    decision,
    signals,
    currentStage,
    previousAiTurn: latestAiTurn?.text,
  });

  if (strategicReply) {
    return finalizeFallback({
      reply: strategicReply,
      suggestedStage: decision.suggestedStage ?? currentStage,
      source: "fallback",
      signals,
      decision,
      providerFailure,
      policyAction: policy.recommendedAction,
      policyReason: policy.reason,
      escalationReason: policy.escalationReason,
    });
  }

  if (
    latestUserText.includes("hash map") ||
    latestUserText.includes("dictionary") ||
    latestUserText.includes("two pointers") ||
    latestUserText.includes("sort")
  ) {
    return finalizeFallback({
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
    });
  }

  if (latestUserText.includes("complexity") || latestUserText.includes("o(")) {
    return finalizeFallback({
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
    });
  }

  if (currentStage === "IMPLEMENTATION") {
    return finalizeFallback({
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
    });
  }

  if (currentStage === "TESTING_AND_COMPLEXITY") {
    return finalizeFallback({
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
    });
  }

  if (latestUserText.includes("edge case") || latestUserText.includes("empty") || latestUserText.includes("duplicate")) {
    return finalizeFallback({
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
    });
  }

  return finalizeFallback({
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
    intent,
    trajectory,
    providerFailure,
    policyAction: policy.recommendedAction,
    policyReason: policy.reason,
    escalationReason: policy.escalationReason,
  });
}

function inferStage(reply: string, input: GenerateAssistantTurnInput) {
  if (normalizeInterviewMode(input.mode) === "SYSTEM_DESIGN") {
    return inferSuggestedSystemDesignStage({
      currentStage: input.currentStage,
      latestUserTurn: findLatestTurn(input.recentTranscripts, "USER"),
      reply,
      events: input.recentEvents,
    });
  }
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

export function resetProviderCooldownsForTests() {
  delete providerCooldowns.gemini;
  delete providerCooldowns.openai;
}

function rememberProviderFailure(provider: "gemini" | "openai", message: string) {
  if (isRetryableProviderFailure(message)) {
    providerCooldowns[provider] = Date.now() + PROVIDER_COOLDOWN_MS;
  }
}

async function buildProviderError(provider: "gemini" | "openai", response: Response) {
  const text = await response.text().catch(() => "");
  const status = response.status;

  if (!text.trim()) {
    const error = new Error(`${provider} request failed with status ${status}.`);
    rememberProviderFailure(provider, error.message);
    return error;
  }

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const message =
      readProviderErrorMessage(payload) ??
      `${provider} request failed with status ${status}.`;
    const error = new Error(message);
    rememberProviderFailure(provider, `${status} ${message}`);
    return error;
  } catch {
    const error = new Error(`${provider} request failed with status ${status}: ${truncate(text, 220)}`);
    rememberProviderFailure(provider, `${status} ${text}`);
    return error;
  }
}

function isRetryableProviderFailure(message: string) {
  return /\b429\b|rate limit|resource exhausted|too many requests|quota|temporar|unavailable|overloaded/i.test(
    message,
  );
}

export function buildSessionMemorySummary(
  recentEvents: GenerateAssistantTurnInput["recentEvents"],
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
  currentStage?: string | null,
  latestExecutionRun?: ExecutionRunLike | null,
) {
  const events = recentEvents ?? [];
  const stage = normalizeStage(currentStage);
  const ledger = buildMemoryLedger({
    currentStage: stage,
    recentEvents: events,
    signals,
    latestExecutionRun,
  });

  return [
    ledger.answeredTargets.length > 0
      ? `Targets already answered recently: ${ledger.answeredTargets.slice(0, 4).join(", ")}. Do not immediately ask for the same target again unless new evidence reopens it.`
      : "No answered-target memory is available yet.",
    ledger.collectedEvidence.length > 0
      ? `Collected evidence so far: ${ledger.collectedEvidence.slice(0, 4).join(", ")}. Prefer gathering missing evidence instead of repeating what is already on record.`
      : "No collected-evidence memory is available yet.",
    ledger.unresolvedIssues.length > 0
      ? `Unresolved issues still in play: ${ledger.unresolvedIssues.slice(0, 3).join(" | ")}`
      : "No unresolved issues are currently standing out.",
    ledger.resolvedIssues.length > 0
      ? `Recently resolved issues: ${ledger.resolvedIssues.slice(0, 2).join(" | ")}. Do not keep pressing them unless fresh evidence reopens them.`
      : "No resolved issues have been captured yet.",
    ledger.recentlyProbedTargets.length > 0
      ? `Recently pressed targets: ${[...new Set(ledger.recentlyProbedTargets)].slice(0, 3).join(", ")}. Avoid repeating the same target unless there is fresh evidence or the candidate still has not answered it.`
      : "No recently pressed targets captured yet.",
    ledger.recentlyProbedIssues.length > 0
      ? `Issues already asked about recently: ${ledger.recentlyProbedIssues.slice(0, 3).join(" | ")}. Avoid re-asking them verbatim.`
      : "No recently asked issue list is available yet.",
    ledger.missingEvidence.length > 0
      ? `Missing evidence the interviewer should still collect before moving on: ${ledger.missingEvidence.join(", ")}.`
      : "No major missing evidence is currently flagged.",
    ledger.repeatedFailurePattern
      ? `Repeated failure pattern: ${ledger.repeatedFailurePattern}.`
      : "No repeated failure pattern is currently dominant.",
    `Recent failed runs: ${ledger.recentFailedRuns}.`,
    `Recent hints: ${ledger.recentHints}.`,
    ledger.persistentWeakness ? `Persistent weakness across recent turns: ${ledger.persistentWeakness}.` : "No persistent weakness is dominating yet.",
    `Current decision to execute: ${decision.action} -> ${decision.target}.`,
    `Decision timing metadata: urgency=${decision.urgency ?? "medium"}, can_defer=${decision.canDefer ?? false}, interruption_cost=${decision.interruptionCost ?? "medium"}, evidence_importance=${decision.evidenceImportance ?? "important"}${decision.batchGroup ? `, batch_group=${decision.batchGroup}` : ""}.`,
    ...ledger.summary,
  ].join(" ");
}

function improvingOrWorseningInstruction(trendSummary?: string) {
  if (!trendSummary) {
    return "State trend instruction: no strong trend signal yet.";
  }

  if (/\bfrom (stuck|partial|missing|buggy) to (progressing|done|present|strong|moderate|deep|correct)\b/i.test(trendSummary)) {
    return "State trend instruction: the candidate appears to be improving, so avoid broad resets and keep the turn short and momentum-preserving.";
  }

  if (/\bfrom (progressing|correct|present|deep|strong) to (stuck|buggy|missing|thin)\b/i.test(trendSummary)) {
    return "State trend instruction: the candidate appears to be getting less stable, so narrow the turn and focus on one local issue only.";
  }

  return "State trend instruction: the candidate state is broadly stable, so keep the pacing measured and targeted.";
}

async function rewriteWithOpenAi(
  originalReply: string,
    verdict: CriticVerdict,
  decision: CandidateDecision,
  input: GenerateAssistantTurnInput,
) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 120,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "Rewrite one interviewer turn. Keep it to 1 or 2 sentences. Make it specific, concrete, and evaluative. Return plain text only.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Original reply: ${originalReply}`,
                `Critic verdict: ${verdict.reason}. ${verdict.explanation}`,
                `Decision action: ${decision.action}`,
                `Decision target: ${decision.target}`,
                `Decision pressure: ${decision.pressure ?? "neutral"}`,
                `Decision urgency: ${decision.urgency ?? "medium"}`,
                `Decision can defer: ${decision.canDefer ?? false}`,
                `Decision interruption cost: ${decision.interruptionCost ?? "medium"}`,
                `Decision evidence importance: ${decision.evidenceImportance ?? "important"}`,
                `Decision batch group: ${decision.batchGroup ?? "none"}`,
                `Specific issue: ${decision.specificIssue ?? "none"}`,
                `Expected answer shape: ${decision.expectedAnswer ?? "none"}`,
                `Required fallback if rewriting fails: ${verdict.revisedReply ?? decision.question}`,
                "Rewrite the interviewer turn so it is sharper and does not repeat an already-answered target.",
              ].join("\n"),
            },
          ],
        },
      ],
    }),
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as { output_text?: string } | null;
  return payload?.output_text?.trim() || null;
}

async function rewriteWithGemini(
  originalReply: string,
    verdict: CriticVerdict,
  decision: CandidateDecision,
  input: GenerateAssistantTurnInput,
) {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }

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
        systemInstruction: {
          parts: [
            {
              text:
                "Rewrite one interviewer turn. Keep it to 1 or 2 sentences. Make it specific, concrete, and evaluative. Return plain text only.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  `Original reply: ${originalReply}`,
                  `Critic verdict: ${verdict.reason}. ${verdict.explanation}`,
                  `Decision action: ${decision.action}`,
                  `Decision target: ${decision.target}`,
                  `Decision pressure: ${decision.pressure ?? "neutral"}`,
                  `Decision urgency: ${decision.urgency ?? "medium"}`,
                  `Decision can defer: ${decision.canDefer ?? false}`,
                  `Decision interruption cost: ${decision.interruptionCost ?? "medium"}`,
                  `Decision evidence importance: ${decision.evidenceImportance ?? "important"}`,
                  `Decision batch group: ${decision.batchGroup ?? "none"}`,
                  `Specific issue: ${decision.specificIssue ?? "none"}`,
                  `Expected answer shape: ${decision.expectedAnswer ?? "none"}`,
                  `Required fallback if rewriting fails: ${verdict.revisedReply ?? decision.question}`,
                  "Rewrite the interviewer turn so it is sharper and does not repeat an already-answered target.",
                ].join("\n"),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 120,
        },
      }),
    },
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
            }>;
          };
        }>;
      }
    | null;
  return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() || null;
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

function normalizeInterviewMode(mode: string | null | undefined): InterviewMode {
  return mode === "SYSTEM_DESIGN" ? "SYSTEM_DESIGN" : "CODING";
}

function normalizeSystemDesignStage(stage: string | null | undefined): SystemDesignStage {
  return isSystemDesignStage(stage) ? stage : "REQUIREMENTS";
}

function buildSystemDesignDecision(
  signals: CandidateSignalSnapshot,
  currentStage: SystemDesignStage,
  targetLevel?: string | null,
  recentEvents?: GenerateAssistantTurnInput["recentEvents"],
  recentTranscripts?: GenerateAssistantTurnInput["recentTranscripts"],
): SystemDesignDecision {
  const previousActionType = findPreviousSystemDesignActionType(recentEvents);
  const baseDecision = makeSystemDesignDecision({
    currentStage,
    signals,
    targetLevel,
    previousActionType,
    recentEvents: (recentEvents ?? []).map((event) => ({
      eventType: event.eventType,
      payloadJson: event.payloadJson,
    })),
    recentTranscripts: recentTranscripts ?? [],
  });
  const guarded = enforceSystemDesignNoCodeInvariant({
    mode: "SYSTEM_DESIGN",
    action: baseDecision.action,
    target: baseDecision.target,
    question: baseDecision.question,
  });

  if (guarded.action === baseDecision.action && guarded.target === baseDecision.target && guarded.question === baseDecision.question) {
    return baseDecision;
  }

  return {
    ...baseDecision,
    action: guarded.action as CandidateDecision["action"],
    target: guarded.target as CandidateDecision["target"],
    question: guarded.question,
  };
}

function findPreviousSystemDesignActionType(
  events: GenerateAssistantTurnInput["recentEvents"] | undefined,
): SystemDesignPolicyAction | null {
  for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
    const event = events?.[index];
    if (!event || event.eventType !== "DECISION_RECORDED") {
      continue;
    }
    const payload = asRecord(event.payloadJson);
    const decision = asRecord(payload.decision);
    const action = decision.systemDesignActionType;
    if (
      action === "ASK_REQUIREMENT" ||
      action === "ASK_CAPACITY" ||
      action === "PROBE_TRADEOFF" ||
      action === "CHALLENGE_SPOF" ||
      action === "ZOOM_IN" ||
      action === "WRAP_UP"
    ) {
      return action;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function buildSystemDesignFallbackReply(decision: CandidateDecision, previousAiTurn?: string) {
  const primary = decision.question;
  const alternate = "Keep this at architecture level. Give one concrete design choice and justify it with tradeoff plus reliability impact.";
  return withVariation(primary, previousAiTurn, alternate);
}

function buildDecision(input: GenerateAssistantTurnInput, signals: CandidateSignalSnapshot) {
  const currentStage = normalizeStage(input.currentStage);
  const basePolicyConfig = mapPersonaToPolicy({
    personaSummary: input.personaSummary,
    appliedPromptContext: input.appliedPromptContext,
  });
  const policy = resolveCodingInterviewPolicy({
    currentStage,
    recentTranscripts: input.recentTranscripts,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const ledger = buildMemoryLedger({
    currentStage,
    recentEvents: input.recentEvents,
    recentTranscripts: input.recentTranscripts,
    signals,
    latestExecutionRun: input.latestExecutionRun,
  });
  const intent = decideInterviewerIntent({
    currentStage,
    signals,
    memory: ledger,
    latestExecutionRun: input.latestExecutionRun,
  });
  const flowState = assessFlowState({
    currentStage,
    signals,
    recentTranscripts: input.recentTranscripts,
  });
  const trajectory = estimateCandidateTrajectory({
    currentStage,
    signals,
    memory: ledger,
    latestExecutionRun: input.latestExecutionRun,
    flowState,
    recentEvents: input.recentEvents,
    intent,
  });
  const candidateDna = assessCandidateDna({
    signals,
    memory: ledger,
    latestExecutionRun: input.latestExecutionRun,
  });
  const policyAdaptation = adaptPolicyToCandidateDna(basePolicyConfig, candidateDna);
  const policyConfig = policyAdaptation.policyConfig;
  const decision = makeCandidateDecision({
    currentStage,
    policy,
    policyConfig,
    signals,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
    intent,
    trajectory,
  });
  const pacing = assessInterviewPacing({
    currentStage,
    signals,
    ledger,
    latestExecutionRun: input.latestExecutionRun,
    decision,
    recentTranscripts: input.recentTranscripts,
    policyConfig,
  });
  const pressureAdjustedDecision = applyDecisionPressure({
    decision,
    signals,
    ledger,
    pacing,
    currentStage,
    intent: intent.intent,
    trajectory: trajectory.candidateTrajectory,
    latestExecutionRun: input.latestExecutionRun,
    policyConfig,
  });
  const budgetState = assessSessionBudget(input.recentEvents ?? []);
  const invariantResult = applyDecisionInvariants({
    decision: {
      ...pressureAdjustedDecision,
    },
    currentStage,
    signals,
    memory: ledger,
    trajectory,
    policyConfig,
    budgetState,
    recentEvents: input.recentEvents,
  });
  const finalizedDecision = {
    ...invariantResult.decision,
    policyArchetype: basePolicyConfig.archetype,
    policyMode: policyAdaptation.policyMode,
    policyAdaptationReason: policyAdaptation.reason,
    decisionPathway: invariantResult.decisionPathway,
    ...toDecisionJustificationFields(buildDecisionJustification({
      decision: invariantResult.decision,
      signals,
      memory: ledger,
      trajectory,
      blockedByInvariant: invariantResult.blockedByInvariant,
    })),
  };
  const shadowPolicy = evaluateShadowPolicy({
    currentStage,
    signals,
    policy,
    actualPolicyArchetype: basePolicyConfig.archetype,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
    intent,
    trajectory,
  }, finalizedDecision);
  return {
    decision: finalizedDecision,
    intent,
    trajectory,
    candidateDna,
    shadowPolicy,
  };
}

function evaluateShadowPolicy(
  input: {
    currentStage: CodingInterviewStage;
    signals: CandidateSignalSnapshot;
    policy: ReturnType<typeof resolveCodingInterviewPolicy>;
    actualPolicyArchetype: PolicyArchetype;
    recentEvents?: GenerateAssistantTurnInput["recentEvents"];
    latestExecutionRun?: GenerateAssistantTurnInput["latestExecutionRun"];
    intent: IntentDecision;
    trajectory: TrajectoryEstimate;
  },
  actualDecision: CandidateDecision,
): ShadowPolicyEvaluation {
  const shadowArchetype: PolicyArchetype =
    input.actualPolicyArchetype === "bar_raiser" ? "collaborative" : "bar_raiser";
  const shadowDecision = makeCandidateDecision({
    currentStage: input.currentStage,
    policy: input.policy,
    policyConfig: getPolicyPreset(shadowArchetype),
    signals: input.signals,
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
    intent: input.intent,
    trajectory: input.trajectory,
  });

  const diff: ShadowPolicyEvaluation["diff"] = [];
  if (shadowDecision.action !== actualDecision.action) {
    diff.push("action");
  }
  if (shadowDecision.target !== actualDecision.target) {
    diff.push("target");
  }
  if (shadowDecision.pressure !== actualDecision.pressure) {
    diff.push("pressure");
  }
  if (shadowDecision.timing !== actualDecision.timing) {
    diff.push("timing");
  }

  return {
    archetype: shadowArchetype,
    action: shadowDecision.action,
    target: shadowDecision.target,
    pressure: shadowDecision.pressure,
    timing: shadowDecision.timing,
    reason: shadowDecision.reason,
    diff,
    scoreDiff: buildScoreDiff(actualDecision, shadowDecision),
  };
}

function buildScoreDiff(
  actualDecision: CandidateDecision,
  shadowDecision: CandidateDecision,
) {
  const toMap = (decision: CandidateDecision) =>
    new Map(
      (decision.candidateScores ?? [])
        .filter((item) => typeof item.action === "string" && typeof item.totalScore === "number")
        .map((item) => [String(item.action), Number(item.totalScore)] as const),
    );
  const actual = toMap(actualDecision);
  const shadow = toMap(shadowDecision);
  const allActions = [...new Set([...actual.keys(), ...shadow.keys()])];

  return allActions
    .map((action) => {
      const actualScore = actual.get(action) ?? 0;
      const shadowScore = shadow.get(action) ?? 0;
      return {
        action,
        actualScore: Number(actualScore.toFixed(2)),
        shadowScore: Number(shadowScore.toFixed(2)),
        delta: Number((actualScore - shadowScore).toFixed(2)),
      };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 6);
}

async function applyCriticPass(
  reply: string,
  input: GenerateAssistantTurnInput,
  signals: CandidateSignalSnapshot,
  decision: CandidateDecision,
  provider: "openai" | "gemini",
) {
  const verdict = reviewInterviewerReply({
    reply,
    decision,
    signals,
    currentStage: normalizeStage(input.currentStage),
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });

  if (verdict.approved) {
    return { reply, verdict };
  }

  const rewritten =
    provider === "openai"
      ? await rewriteWithOpenAi(reply, verdict, decision, input)
      : await rewriteWithGemini(reply, verdict, decision, input);
  const candidateReply = rewritten ? collapseReply(rewritten) : verdict.revisedReply ?? reply;
  const finalReview = reviewInterviewerReply({
    reply: candidateReply,
    decision,
    signals,
    currentStage: normalizeStage(input.currentStage),
    recentEvents: input.recentEvents,
    latestExecutionRun: input.latestExecutionRun,
  });
  const finalReply = finalReview.approved ? candidateReply : verdict.revisedReply ?? candidateReply;

  return {
    reply: finalReply,
    verdict: finalReview.approved ? finalReview : verdict,
  };
}

function enforceDecisionCompliance(
  reply: string,
  decision: CandidateDecision,
  input: GenerateAssistantTurnInput,
) {
  const normalized = collapseReply(reply);
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
  const genericOpeningOnly =
    /^(thanks|good|great|nice|okay|alright|sounds good|that makes sense)[,.!\s]+/i.test(normalized) &&
    !normalized.includes("?") &&
    !mentionsTarget;

  const requiresConcreteFollowup = ["ask_for_test_case", "ask_for_complexity", "ask_for_debug_plan", "give_hint", "ask_for_clarification"].includes(
    decision.action,
  );
  const allowsNonQuestion = ["encourage_and_continue", "hold_and_listen"].includes(decision.action);

  if (requiresConcreteFollowup && !mentionsTarget) {
    return decision.question;
  }

  if (soundsGeneric) {
    return collapseReply(`${normalized} ${decision.question}`);
  }

  if (genericOpeningOnly) {
    return decision.question;
  }

  if (input.lowCostMode && normalized.split(/\s+/).length > 55) {
    return decision.question;
  }

  const sentenceCount = normalized.split(/[.!?]+/).filter((part) => part.trim()).length;
  if (sentenceCount > 2 && decision.action !== "give_hint" && decision.action !== "hold_and_listen") {
    return decision.question;
  }

  if (!normalized.includes("?") && !allowsNonQuestion) {
    return decision.question;
  }

  return normalized;
}

function collapseReply(reply: string) {
  const normalized = reply.replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  return sentences.slice(0, 2).join(" ").trim();
}

function selectAuthoritativeStreamReply(
  streamedReply: string,
  reviewedReply: string,
  verdict: CriticVerdict,
) {
  const streamed = collapseReply(streamedReply);
  const reviewed = collapseReply(reviewedReply);

  if (!streamed) {
    return reviewed;
  }

  if (!reviewed || streamed === reviewed) {
    return reviewed || streamed;
  }

  if (!isSpecificStreamedReply(streamed)) {
    return reviewed;
  }

  const overlap = calculateReplyTokenOverlap(streamed, reviewed);
  const closureShift = !looksLikeClosureReply(streamed) && looksLikeClosureReply(reviewed);
  const streamedAsksQuestion = streamed.includes("?");
  const reviewedAsksQuestion = reviewed.includes("?");
  const intentShift = streamedAsksQuestion !== reviewedAsksQuestion;
  const aggressiveRewrite =
    closureShift ||
    verdict.reason === "evidence_saturated" ||
    verdict.reason === "repeated_answered_target" ||
    verdict.reason === "should_move_to_implementation";

  if (aggressiveRewrite && overlap < 0.72) {
    return streamed;
  }

  if (intentShift && overlap < 0.5) {
    return streamed;
  }

  if (overlap < 0.3) {
    return streamed;
  }

  return reviewed;
}

function isSpecificStreamedReply(reply: string) {
  if (reply.split(/\s+/).filter(Boolean).length < 8) {
    return false;
  }

  return !/\b(keep going|good start|sounds reasonable|that makes sense|nice work so far|continue)\b/i.test(reply);
}

function looksLikeClosureReply(reply: string) {
  return /\b(wrap up|close this question|done here|done with this question|move on|we are done|we'll close this question)\b/i.test(
    reply,
  );
}

function calculateReplyTokenOverlap(left: string, right: string) {
  const tokenize = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9_]+/i)
        .filter((token) => token.length >= 4),
    );
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function assessDecisionComplexity(decision: CandidateDecision) {
  const candidateScores = decision.candidateScores ?? [];
  const sortedScores = candidateScores
    .map((item) => Number(item.totalScore))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);
  const topScore = sortedScores[0] ?? 0;
  const secondScore = sortedScores[1] ?? topScore;
  const edge = Math.max(0, topScore - secondScore);
  const scoreAmbiguity = Math.max(0, Math.min(1, (0.25 - edge) / 0.25));
  const lowConfidence = Math.max(0, Math.min(1, (0.8 - decision.confidence) / 0.8));
  const fragileDecisionSurface =
    decision.normalizedAction === "Guide" || decision.normalizedAction === "Probe" ? 0.1 : 0;
  const conversationPenalty =
    decision.conversationHealthMode === "TERMINATE_OR_REPLAN"
      ? 0.42
      : decision.conversationHealthMode === "RESCUE"
        ? 0.28
        : decision.conversationHealthMode === "GUIDED"
          ? 0.18
          : decision.conversationHealthMode === "CONSTRAINED"
            ? 0.1
            : 0;
  const echoPenalty = decision.echoRecoveryMode
    ? 0.2 + Math.min(0.1, (decision.echoRecoveryAttempt ?? 0) * 0.05)
    : 0;

  return Number(
    Math.min(
      1,
      Math.max(
        0,
        (
          scoreAmbiguity * 0.42 +
          lowConfidence * 0.24 +
          fragileDecisionSurface +
          conversationPenalty +
          echoPenalty
        ),
      ),
    ).toFixed(2),
  );
}

function toDecisionJustificationFields(justification: {
  whyNow: string;
  whyThisAction: string;
  whyNotAlternatives: string[];
  supportingSignals: string[];
  blockedByInvariant?: string;
}) {
  return {
    justificationWhyNow: justification.whyNow,
    justificationWhyThisAction: justification.whyThisAction,
    justificationWhyNotAlternatives: justification.whyNotAlternatives,
    supportingSignals: justification.supportingSignals,
    blockedByInvariant: justification.blockedByInvariant,
  };
}








