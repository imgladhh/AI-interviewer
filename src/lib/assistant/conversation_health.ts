import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import { latestAdjudicatedSignals } from "@/lib/assistant/turn-assessment";

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
  assessmentStatus: "available" | "unavailable";
};

export function assessConversationHealth(input: {
  recentEvents?: SessionEventLike[];
  signals: CandidateSignalSnapshot;
}): ConversationHealth {
  const recentEvents = input.recentEvents ?? [];
  const assessments = latestAdjudicatedSignals(recentEvents).slice(-6);
  const recentSignals = assessments.map((item) => item.signals);
  const recentEchoEvents = recentSignals.filter((signals) => signals.echoLikely).length;
  const denominator = recentSignals.length + 1;
  const novelty = clamp(Number((1 - recentSignals.filter((signals) => signals.progress === "stuck").length / Math.max(1, denominator)).toFixed(2)), 0, 1);
  const echoRate = clamp(
    Number(((recentEchoEvents + (input.signals.echoLikely ? 1 : 0)) / Math.max(1, denominator)).toFixed(2)),
    0,
    1,
  );
  const noProgressTurns = Math.max(
    assessments.length > 0 ? trailingNoProgressCount([...recentSignals, input.signals]) : (input.signals.echoLikely ? 1 : 0),
    recentEchoEvents,
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
    assessmentStatus: assessments.length > 0 ? "available" : "unavailable",
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

function trailingNoProgressCount(signals: CandidateSignalSnapshot[]) {
  let repeats = 0;
  for (let i = signals.length - 1; i >= 0; i -= 1) {
    if (signals[i].progress !== "stuck" && !signals[i].echoLikely) break;
    repeats += 1;
  }
  return repeats;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
