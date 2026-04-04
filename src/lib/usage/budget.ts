import { summarizeUsageFromSessionEvents } from "@/lib/usage/cost";

type SessionEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

export const SESSION_COST_BUDGET_USD = 2;

export type SessionBudgetStatus = {
  thresholdUsd: number;
  currentTotalUsd: number;
  projectedTotalUsd: number;
  exceeded: boolean;
};

export function assessSessionBudget(
  events: SessionEventLike[],
  additionalCostUsd = 0,
  thresholdUsd = SESSION_COST_BUDGET_USD,
): SessionBudgetStatus {
  const usageSummary = summarizeUsageFromSessionEvents(events);
  const currentTotalUsd = usageSummary.totalEstimatedCostUsd;
  const projectedTotalUsd = roundUsd(currentTotalUsd + numberOrZero(additionalCostUsd));

  return {
    thresholdUsd,
    currentTotalUsd,
    projectedTotalUsd,
    exceeded: projectedTotalUsd >= thresholdUsd,
  };
}

export function buildBudgetExceededReply(status: SessionBudgetStatus) {
  return `We have reached the session budget cap for this interview at about $${status.projectedTotalUsd.toFixed(2)}. Let us stop here and wrap up the session cleanly.`;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}
