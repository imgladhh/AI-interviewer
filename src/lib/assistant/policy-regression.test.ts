import { describe, expect, it } from "vitest";
import {
  evaluatePolicyScenario,
  POLICY_REGRESSION_SCENARIOS,
  runPolicyRegressionLab,
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
    expect(lab).toHaveLength(5);
    expect(lab[0]?.results).toHaveLength(2);
    expect(lab[0]?.results.map((item) => item.archetype)).toEqual(["bar_raiser", "collaborative"]);
    expect(lab[0]?.divergentFields).toContain("action");
    expect(lab[1]?.summary).toMatch(/converge|diverge/i);
  });
});
