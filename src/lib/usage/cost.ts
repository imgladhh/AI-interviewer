type SessionEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

type UsageSummary = {
  llmCalls: number;
  sttCalls: number;
  llmEstimatedCostUsd: number;
  sttEstimatedCostUsd: number;
  totalEstimatedCostUsd: number;
};

const OPENAI_TEXT_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
};

const OPENAI_STT_PER_MINUTE: Record<string, number> = {
  "gpt-4o-mini-transcribe": 0.003,
};

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function estimateOpenAiTextCost(model: string, inputTokens: number, outputTokens: number) {
  const pricing = OPENAI_TEXT_PRICING[model];
  if (!pricing) {
    return null;
  }

  return roundUsd(
    (inputTokens / 1_000_000) * pricing.inputPer1M +
      (outputTokens / 1_000_000) * pricing.outputPer1M,
  );
}

export function estimateOpenAiSttCost(model: string, audioBytes: number) {
  const perMinute = OPENAI_STT_PER_MINUTE[model];
  if (!perMinute) {
    return null;
  }

  const estimatedSeconds = audioBytes / 4000;
  const estimatedMinutes = estimatedSeconds / 60;
  return roundUsd(estimatedMinutes * perMinute);
}

export function summarizeUsageFromSessionEvents(events: SessionEventLike[]): UsageSummary {
  let llmCalls = 0;
  let sttCalls = 0;
  let llmEstimatedCostUsd = 0;
  let sttEstimatedCostUsd = 0;

  for (const event of events) {
    const payload = asRecord(event.payloadJson);

    if (event.eventType === "LLM_USAGE_RECORDED") {
      llmCalls += 1;
      llmEstimatedCostUsd += numberOrZero(payload.estimatedCostUsd);
    }

    if (event.eventType === "STT_USAGE_RECORDED") {
      sttCalls += 1;
      sttEstimatedCostUsd += numberOrZero(payload.estimatedCostUsd);
    }
  }

  return {
    llmCalls,
    sttCalls,
    llmEstimatedCostUsd: roundUsd(llmEstimatedCostUsd),
    sttEstimatedCostUsd: roundUsd(sttEstimatedCostUsd),
    totalEstimatedCostUsd: roundUsd(llmEstimatedCostUsd + sttEstimatedCostUsd),
  };
}

export function resolveLowCostMode(events: SessionEventLike[]) {
  const sessionCreated = [...events]
    .reverse()
    .find((event) => event.eventType === "SESSION_CREATED" || event.eventType === "INTERVIEW_READY");

  const payload = asRecord(sessionCreated?.payloadJson);
  return payload.lowCostMode === true;
}

function roundUsd(value: number) {
  return Math.round(value * 10000) / 10000;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
