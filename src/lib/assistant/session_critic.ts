import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";

type SessionEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

export type SessionCriticSummary = {
  redundancyScore: number;
  interruptionScore: number;
  pressureBalance: "too_soft" | "good" | "too_harsh";
  flowPreservation: "poor" | "ok" | "good";
  timingQuality: "poor" | "ok" | "good";
  closureQuality: "poor" | "ok" | "good";
  notes: string[];
};

export function summarizeSessionCritic(input: {
  events: SessionEventLike[];
  latestSignals?: CandidateSignalSnapshot | Record<string, unknown> | null;
}): SessionCriticSummary {
  const criticVerdicts = input.events
    .filter((event) => event.eventType === "CRITIC_VERDICT_RECORDED")
    .map((event) => asRecord(asRecord(event.payloadJson).criticVerdict));
  const decisions = input.events
    .filter((event) => event.eventType === "DECISION_RECORDED")
    .map((event) => asRecord(asRecord(event.payloadJson).decision));

  const repetitiveVerdicts = criticVerdicts.filter(
    (item) => stringValue(item.reason) === "repeated_answered_target" || stringValue(item.reason) === "evidence_saturated",
  ).length;
  const deferredVerdicts = criticVerdicts.filter((item) => stringValue(item.timingVerdict) === "defer").length;
  const skipVerdicts = criticVerdicts.filter((item) => stringValue(item.timingVerdict) === "skip").length;
  const sharpPressureCount = decisions.filter((decision) => {
    const pressure = stringValue(decision.pressure);
    return pressure === "challenging" || pressure === "surgical";
  }).length;
  const softPressureCount = decisions.filter((decision) => stringValue(decision.pressure) === "soft").length;
  const interruptionHeavy = criticVerdicts.filter((item) => stringValue(item.interruptionCost) === "high").length;
  const closureVerdicts = criticVerdicts.filter((item) => {
    const verdict = stringValue(item.verdict);
    return verdict === "move_to_wrap_up" || verdict === "close_topic" || verdict === "end_interview";
  }).length;
  const poorTiming = criticVerdicts.filter((item) => stringValue(item.reason) === "poor_timing").length;

  const redundancyScore = clamp100(
    100 -
      repetitiveVerdicts * 14 -
      Math.max(0, decisions.length - criticVerdicts.length) * 2,
  );
  const interruptionScore = clamp100(
    100 -
      poorTiming * 18 -
      Math.max(0, interruptionHeavy - deferredVerdicts) * 8,
  );

  const pressureBalance =
    sharpPressureCount >= softPressureCount + 4
      ? "too_harsh"
      : softPressureCount >= sharpPressureCount + 5
        ? "too_soft"
        : "good";

  const flowPreservation =
    deferredVerdicts >= poorTiming + 2
      ? "good"
      : poorTiming > deferredVerdicts
        ? "poor"
        : "ok";

  const timingQuality =
    poorTiming >= 3
      ? "poor"
      : deferredVerdicts + skipVerdicts >= 2
        ? "good"
        : "ok";

  const closureQuality =
    closureVerdicts >= 1
      ? "good"
      : decisions.some((decision) => stringValue(decision.target) === "summary")
        ? "ok"
        : "poor";

  const notes: string[] = [];

  if (pressureBalance === "too_harsh") {
    notes.push("Pressure skewed too sharp across the session; consider more guide/advance turns before surgical probes.");
  } else if (pressureBalance === "too_soft") {
    notes.push("Pressure stayed too soft overall; the interviewer may be leaving evaluative signal on the table.");
  }

  if (flowPreservation === "poor") {
    notes.push("The critic saw multiple mistimed interruptions relative to candidate flow.");
  } else if (flowPreservation === "good") {
    notes.push("Flow was preserved well; optional evidence was often deferred instead of interrupting productive momentum.");
  }

  if (closureQuality === "good") {
    notes.push("The interview closed topics cleanly once evidence was saturated.");
  } else if (closureQuality === "poor") {
    notes.push("Closure behavior is still weak; topics may remain open after enough evidence is collected.");
  }

  if (redundancyScore < 70) {
    notes.push("Some turns still repeated already-covered targets or revisited saturated evidence.");
  }

  const latestSignals = asRecord(input.latestSignals);
  if (stringValue(latestSignals.reasoningDepth) === "deep" && pressureBalance === "too_soft") {
    notes.push("The candidate looked capable of handling more depth; a stronger level-up probe might have been justified.");
  }

  return {
    redundancyScore,
    interruptionScore,
    pressureBalance,
    flowPreservation,
    timingQuality,
    closureQuality,
    notes: notes.slice(0, 4),
  };
}

function clamp100(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}
