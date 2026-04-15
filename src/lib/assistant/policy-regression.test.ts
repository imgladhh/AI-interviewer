import { describe, expect, it } from "vitest";
import {
  derivePolicyTuningSuggestions,
  evaluatePolicyScenario,
  evaluateSystemDesignScenario,
  evaluateSystemDesignRegressionHealth,
  POLICY_REGRESSION_SCENARIOS,
  runSystemDesignRegressionLab,
  runPolicyRegressionLab,
  SYSTEM_DESIGN_REGRESSION_SCENARIOS,
} from "@/lib/assistant/policy-regression";

describe("policy regression lab", () => {
  it("shows different pre-code behavior under collaborative and bar raiser archetypes", () => {
    const scenario = POLICY_REGRESSION_SCENARIOS.find((item) => item.id === "strong_precode");
    expect(scenario).toBeTruthy();

    const collaborative = evaluatePolicyScenario(scenario!, "collaborative");
    const barRaiser = evaluatePolicyScenario(scenario!, "bar_raiser");

    expect(collaborative.action).toBe("encourage_and_continue");
    expect(collaborative.suggestedStage).toBe("IMPLEMENTATION");
    expect(barRaiser.action).toBe("probe_tradeoff");
    expect(barRaiser.target).toBe("tradeoff");
    expect(typeof collaborative.totalScore).toBe("number");
    expect(typeof barRaiser.totalScore).toBe("number");
  });

  it("keeps both archetypes in a focused debugging move when the candidate is stuck", () => {
    const scenario = POLICY_REGRESSION_SCENARIOS.find((item) => item.id === "stuck_debugging");
    expect(scenario).toBeTruthy();

    const collaborative = evaluatePolicyScenario(scenario!, "collaborative");
    const barRaiser = evaluatePolicyScenario(scenario!, "bar_raiser");

    expect(collaborative.action).toBe("ask_for_debug_plan");
    expect(barRaiser.action).toBe("ask_for_debug_plan");
    expect(collaborative.target).toBe("debugging");
    expect(barRaiser.target).toBe("debugging");
  });

  it("preserves strong coding flow instead of interrupting with extra probes", () => {
    const scenario = POLICY_REGRESSION_SCENARIOS.find((item) => item.id === "flow_preservation");
    expect(scenario).toBeTruthy();

    const collaborative = evaluatePolicyScenario(scenario!, "collaborative");
    const barRaiser = evaluatePolicyScenario(scenario!, "bar_raiser");

    expect(["hold_and_listen", "encourage_and_continue"]).toContain(collaborative.action);
    expect(["hold_and_listen", "encourage_and_continue"]).toContain(barRaiser.action);
    expect(collaborative.target).toBe("implementation");
    expect(barRaiser.target).toBe("implementation");
    expect([collaborative.action, barRaiser.action]).not.toContain("probe_tradeoff");
    expect([collaborative.action, barRaiser.action]).not.toContain("ask_for_complexity");
  });

  it("does not re-open testing once the target has already been answered", () => {
    const scenario = POLICY_REGRESSION_SCENARIOS.find((item) => item.id === "answered_target_guard");
    expect(scenario).toBeTruthy();

    const collaborative = evaluatePolicyScenario(scenario!, "collaborative");
    const barRaiser = evaluatePolicyScenario(scenario!, "bar_raiser");

    expect([collaborative.action, barRaiser.action]).not.toContain("ask_for_test_case");
    expect([collaborative.target, barRaiser.target]).not.toContain("testing");
  });

  it("produces grouped strategy-lab output for the default archetypes", () => {
    const lab = runPolicyRegressionLab();
    expect(lab).toHaveLength(10);
    expect(lab[0]?.results).toHaveLength(2);
    expect(lab[0]?.results.map((item) => item.archetype)).toEqual(["bar_raiser", "collaborative"]);
    expect(lab[0]?.divergentFields).toContain("action");
    expect(lab[0]?.scoreSpread?.spread).toBeTypeOf("number");
    expect(lab[0]?.rewardSpread?.spread).toBeTypeOf("number");
    expect(lab[0]?.results.every((item) => item.scoreWeightProfile && typeof item.scoreWeightProfile.need === "number")).toBe(true);
    expect(lab[0]?.results.every((item) => Array.isArray(item.decisionTimeline) && item.decisionTimeline.length >= 1)).toBe(true);
    expect(lab[0]?.results.every((item) => typeof item.averageReward === "number")).toBe(true);
    expect(lab[1]?.summary).toMatch(/converge|diverge/i);
  });

  it("includes phase5 scenario fixtures for overconfident wrong answer and perfect flow", () => {
    const ids = POLICY_REGRESSION_SCENARIOS.map((item) => item.id);
    expect(ids).toContain("overconfident_wrong_answer");
    expect(ids).toContain("perfect_flow");
  });

  it("derives reward-driven policy tuning suggestions from lab outputs", () => {
    const lab = runPolicyRegressionLab();
    const suggestions = derivePolicyTuningSuggestions(lab);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.title).toBeTruthy();
    expect(Array.isArray(suggestions[0]?.recommendedAdjustments)).toBe(true);
  });

  it("forces echo recovery prompts instead of generic probing when the candidate repeats the question", () => {
    const scenario = POLICY_REGRESSION_SCENARIOS.find((item) => item.id === "echo_recovery");
    expect(scenario).toBeTruthy();

    const collaborative = evaluatePolicyScenario(scenario!, "collaborative");
    const barRaiser = evaluatePolicyScenario(scenario!, "bar_raiser");

    expect(collaborative.action).toBe("ask_for_clarification");
    expect(barRaiser.action).toBe("ask_for_clarification");
    expect(collaborative.reason).toMatch(/echo|repeat/i);
    expect(barRaiser.reason).toMatch(/echo|repeat/i);
  });

  it("boosts probing under idle+stalled conditions", () => {
    const scenario = POLICY_REGRESSION_SCENARIOS.find((item) => item.id === "idle_stall_probe_boost");
    expect(scenario).toBeTruthy();

    const collaborative = evaluatePolicyScenario(scenario!, "collaborative");
    const barRaiser = evaluatePolicyScenario(scenario!, "bar_raiser");

    expect(["probe_correctness", "probe_tradeoff", "ask_for_reasoning", "ask_for_clarification"]).toContain(collaborative.action);
    expect(["probe_correctness", "probe_tradeoff", "ask_for_reasoning", "ask_for_clarification"]).toContain(barRaiser.action);
  });

  it("keeps wrap-up irreversible and avoids reopening actions", () => {
    const scenario = POLICY_REGRESSION_SCENARIOS.find((item) => item.id === "wrap_up_irreversible");
    expect(scenario).toBeTruthy();

    const collaborative = evaluatePolicyScenario(scenario!, "collaborative");
    const barRaiser = evaluatePolicyScenario(scenario!, "bar_raiser");
    const actions = [collaborative.action, barRaiser.action];

    expect(actions).not.toContain("move_to_wrap_up");
    expect(actions).not.toContain("ask_for_reasoning");
    expect(actions).not.toContain("probe_correctness");
    expect(actions).not.toContain("probe_tradeoff");
  });

  it("includes system design phase6 scenario fixtures", () => {
    const ids = SYSTEM_DESIGN_REGRESSION_SCENARIOS.map((item) => item.id);
    expect(ids).toContain("late_bloomer");
    expect(ids).toContain("confident_bullshitter");
    expect(ids).toContain("rigid_coder");
  });

  it("pushes deep probing for confident handwave system design candidate", () => {
    const scenario = SYSTEM_DESIGN_REGRESSION_SCENARIOS.find((item) => item.id === "confident_bullshitter");
    expect(scenario).toBeTruthy();

    const result = evaluateSystemDesignScenario(scenario!);
    expect(result.decisionTimeline.length).toBeGreaterThan(0);
    expect(["PROBE_TRADEOFF", "ASK_CAPACITY", "CHALLENGE_SPOF"]).toContain(
      result.decisionTimeline[0]?.systemDesignActionType,
    );
    expect(Array.isArray(result.decisionTimeline[0]?.scoreBreakdown)).toBe(true);
  });

  it("produces score diff and reward diff across system design regression scenarios", () => {
    const reports = runSystemDesignRegressionLab();
    expect(reports).toHaveLength(3);
    expect(reports.every((item) => typeof item.scoreDiffFromBest === "number")).toBe(true);
    expect(reports.every((item) => typeof item.rewardDiffFromBest === "number")).toBe(true);
    expect(reports.some((item) => item.scoreDiffFromBest === 0)).toBe(true);
    expect(reports.some((item) => item.rewardDiffFromBest === 0)).toBe(true);
    expect(reports.every((item) => item.result.decisionTimeline.length >= 1)).toBe(true);
    expect(
      reports.every((item) =>
        item.result.decisionTimeline.every((turn) => Array.isArray(turn.scoreBreakdown)),
      ),
    ).toBe(true);
    expect(reports.every((item) => typeof item.expectationMet === "boolean")).toBe(true);
    expect(reports.every((item) => typeof item.expectationNote === "string")).toBe(true);
  });

  it("summarizes scenario-level health checks for late bloomer, bullshitter, and rigid coder", () => {
    const reports = runSystemDesignRegressionLab();
    const health = evaluateSystemDesignRegressionHealth(reports);

    expect(typeof health.lateBloomerRecovered).toBe("boolean");
    expect(typeof health.bullshitterSuppressed).toBe("boolean");
    expect(typeof health.rigidCapped).toBe("boolean");
    expect(typeof health.passRate).toBe("number");
    expect(health.passRate).toBeGreaterThanOrEqual(0);
    expect(health.passRate).toBeLessThanOrEqual(1);
    expect(typeof health.summary).toBe("string");
  });
});
