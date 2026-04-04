import { describe, expect, it } from "vitest";
import { assessSessionBudget, buildBudgetExceededReply, SESSION_COST_BUDGET_USD } from "@/lib/usage/budget";

describe("session budget", () => {
  it("flags sessions that are already over budget", () => {
    const result = assessSessionBudget([
      {
        eventType: "LLM_USAGE_RECORDED",
        payloadJson: { estimatedCostUsd: 1.4 },
      },
      {
        eventType: "STT_USAGE_RECORDED",
        payloadJson: { estimatedCostUsd: 0.7 },
      },
    ]);

    expect(result.currentTotalUsd).toBe(2.1);
    expect(result.projectedTotalUsd).toBe(2.1);
    expect(result.exceeded).toBe(true);
    expect(result.thresholdUsd).toBe(SESSION_COST_BUDGET_USD);
  });

  it("includes projected usage when checking the next turn", () => {
    const result = assessSessionBudget(
      [
        {
          eventType: "LLM_USAGE_RECORDED",
          payloadJson: { estimatedCostUsd: 1.92 },
        },
      ],
      0.11,
    );

    expect(result.currentTotalUsd).toBe(1.92);
    expect(result.projectedTotalUsd).toBe(2.03);
    expect(result.exceeded).toBe(true);
    expect(buildBudgetExceededReply(result)).toMatch(/\$2\.03/);
  });
});
