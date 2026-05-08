import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

type SessionEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

export type ConversationHealthMode =
  | "NORMAL"
  | "CONSTRAINED"
  | "GUIDED"
  | "RESCUE"
  | "TERMINATE_OR_REPLAN";

export type ConversationHealth = {
  mode: ConversationHealthMode;
  score: number;
  novelty: number;
  echoRate: number;
  noProgressTurns: number;
  reasons: string[];
};

export function assessConversationHealth(input: {
  recentEvents?: SessionEventLike[];
  signals: CandidateSignalSnapshot;
}): ConversationHealth {
  const recentEvents = input.recentEvents ?? [];
  const recentCandidateTurns = extractRecentCandidateTurns(recentEvents, 6);
  const uniqueTurnCount = new Set(recentCandidateTurns).size;
  const novelty =
    recentCandidateTurns.length === 0
      ? 1
      : clamp(Number((uniqueTurnCount / recentCandidateTurns.length).toFixed(2)), 0, 1);
  const recentEchoEvents = recentEvents
    .slice(-8)
    .filter((event) => event.eventType === "CANDIDATE_ECHO_DETECTED").length;
  const echoRate = clamp(
    Number((recentEchoEvents / Math.max(1, recentCandidateTurns.length)).toFixed(2)),
    0,
    1,
  );
  const noProgressTurns = Math.max(
    trailingRepeatCount(recentCandidateTurns),
    recentEchoEvents,
    input.signals.echoLikely ? 1 : 0,
  );
  const score = clamp(
    Number((1 - echoRate * 0.45 - (1 - novelty) * 0.35 - Math.min(noProgressTurns / 4, 1) * 0.2).toFixed(2)),
    0,
    1,
  );
  const mode = resolveHealthMode({
    echoRate,
    noProgressTurns,
    echoLikely: input.signals.echoLikely ?? false,
  });
  const reasons = buildReasons({ novelty, echoRate, noProgressTurns, mode });

  return {
    mode,
    score,
    novelty,
    echoRate,
    noProgressTurns,
    reasons,
  };
}

function resolveHealthMode(input: {
  echoRate: number;
  noProgressTurns: number;
  echoLikely: boolean;
}): ConversationHealthMode {
  if (input.noProgressTurns >= 5 || (input.echoRate >= 0.75 && input.noProgressTurns >= 4)) {
    return "TERMINATE_OR_REPLAN";
  }

  if (input.noProgressTurns >= 3 || input.echoRate >= 0.6) {
    return "RESCUE";
  }

  if (input.noProgressTurns >= 2 || input.echoRate >= 0.45) {
    return "GUIDED";
  }

  if (input.noProgressTurns >= 1 || input.echoRate >= 0.25 || input.echoLikely) {
    return "CONSTRAINED";
  }

  return "NORMAL";
}

function buildReasons(input: {
  novelty: number;
  echoRate: number;
  noProgressTurns: number;
  mode: ConversationHealthMode;
}) {
  const reasons: string[] = [];
  reasons.push(`mode=${input.mode}`);
  if (input.echoRate >= 0.25) {
    reasons.push(`echo_rate=${input.echoRate.toFixed(2)}`);
  }
  if (input.novelty <= 0.5) {
    reasons.push(`low_novelty=${input.novelty.toFixed(2)}`);
  }
  if (input.noProgressTurns >= 1) {
    reasons.push(`no_progress_turns=${input.noProgressTurns}`);
  }
  return reasons;
}

function extractRecentCandidateTurns(events: SessionEventLike[], limit: number) {
  const turns = events
    .filter((event) => event.eventType === "CANDIDATE_SPOKE")
    .map((event) => normalizeTurnText(asRecord(event.payloadJson).text))
    .filter((value): value is string => Boolean(value));
  return turns.slice(-limit);
}

function trailingRepeatCount(turns: string[]) {
  if (turns.length <= 1) {
    return 0;
  }
  let repeats = 0;
  for (let i = turns.length - 1; i > 0; i -= 1) {
    if (turnOverlapRatio(turns[i], turns[i - 1]) < 0.6) {
      break;
    }
    repeats += 1;
  }
  return repeats;
}

function turnOverlapRatio(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function tokenSet(text: string) {
  const stopWords = new Set(["the", "for", "here", "this", "that", "think", "would", "could", "can", "still", "basically"]);
  return new Set(
    text
      .split(/\s+/)
      .map((token) => canonicalToken(token.trim()))
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function canonicalToken(token: string) {
  if (token === "using") {
    return "use";
  }
  return token;
}

function normalizeTurnText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .toLowerCase()
    .replace(/\bhash\s*map\b/g, "hashmap")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
