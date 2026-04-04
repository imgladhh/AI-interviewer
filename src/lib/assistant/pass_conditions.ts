import type { MemoryLedger } from "@/lib/assistant/memory_ledger";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

export type TopicGateKey =
  | "implementation"
  | "complexity"
  | "testing"
  | "wrap_up";

export type TopicPassAssessment = {
  topic: TopicGateKey;
  passConditions: string[];
  satisfied: string[];
  missing: string[];
  complete: boolean;
};

export type PassConditionsAssessment = {
  implementation: TopicPassAssessment;
  complexity: TopicPassAssessment;
  testing: TopicPassAssessment;
  wrapUp: TopicPassAssessment;
};

export function assessPassConditions(input: {
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  memory: MemoryLedger;
  latestExecutionRun?: ExecutionRunLike | null;
}): PassConditionsAssessment {
  const { signals, memory, latestExecutionRun } = input;

  const implementationConditions = [
    "solution_direction_is_clear",
    "core_state_or_data_structure_is_named",
    "candidate_can_start_coding",
  ];
  const implementationSatisfied = implementationConditions.filter((condition) => {
    switch (condition) {
      case "solution_direction_is_clear":
        return (
          signals.understanding === "clear" &&
          (signals.algorithmChoice === "reasonable" || signals.algorithmChoice === "strong")
        );
      case "core_state_or_data_structure_is_named":
        return (
          signals.readyToCode ||
          memory.collectedEvidence.includes("implementation_plan") ||
          signals.behavior === "structured"
        );
      case "candidate_can_start_coding":
        return (
          signals.readyToCode ||
          (signals.progress === "progressing" && signals.communication !== "unclear")
        );
      default:
        return false;
    }
  });

  const complexityConditions = [
    "time_complexity_stated",
    "space_complexity_stated",
    "reasoning_is_consistent_with_algorithm",
  ];
  const complexitySatisfied = complexityConditions.filter((condition) => {
    switch (condition) {
      case "time_complexity_stated":
        return (
          memory.answeredTargets.includes("complexity") ||
          memory.collectedEvidence.includes("complexity_tradeoff") ||
          signals.complexityRigor !== "missing"
        );
      case "space_complexity_stated":
        return (
          memory.collectedEvidence.includes("complexity_tradeoff") ||
          memory.answeredTargets.includes("tradeoff") ||
          signals.complexityRigor === "partial" ||
          signals.complexityRigor === "strong"
        );
      case "reasoning_is_consistent_with_algorithm":
        return (
          signals.algorithmChoice !== "suboptimal" &&
          signals.reasoningDepth !== "thin" &&
          signals.complexityRigor !== "missing"
        );
      default:
        return false;
    }
  });

  const testingConditions = [
    "at_least_one_boundary_case",
    "expected_output_is_precise",
    "test_case_links_to_code_path_or_invariant",
  ];
  const testingSatisfied = testingConditions.filter((condition) => {
    switch (condition) {
      case "at_least_one_boundary_case":
        return (
          signals.edgeCaseAwareness === "present" ||
          memory.collectedEvidence.includes("boundary_coverage") ||
          memory.collectedEvidence.includes("test_cases")
        );
      case "expected_output_is_precise":
        return memory.collectedEvidence.includes("exact_test_outputs");
      case "test_case_links_to_code_path_or_invariant":
        return (
          signals.testingDiscipline === "strong" ||
          memory.collectedEvidence.includes("correctness_proof") ||
          signals.structuredEvidence.some(
            (item) => item.area === "testing" || item.area === "correctness" || item.area === "edge_case",
          )
        );
      default:
        return false;
    }
  });

  const wrapUpConditions = [
    "implementation_or_reasoning_is_concrete",
    "validation_story_is_covered",
    "performance_story_is_covered",
  ];
  const wrapUpSatisfied = wrapUpConditions.filter((condition) => {
    switch (condition) {
      case "implementation_or_reasoning_is_concrete":
        return (
          signals.progress === "done" ||
          latestExecutionRun?.status === "PASSED" ||
          memory.collectedEvidence.includes("implementation_plan")
        );
      case "validation_story_is_covered":
        return testingSatisfied.length >= 2 || memory.collectedEvidence.includes("test_cases");
      case "performance_story_is_covered":
        return complexitySatisfied.length >= 2 || memory.collectedEvidence.includes("complexity_tradeoff");
      default:
        return false;
    }
  });

  return {
    implementation: buildTopicAssessment("implementation", implementationConditions, implementationSatisfied),
    complexity: buildTopicAssessment("complexity", complexityConditions, complexitySatisfied),
    testing: buildTopicAssessment("testing", testingConditions, testingSatisfied),
    wrapUp: buildTopicAssessment("wrap_up", wrapUpConditions, wrapUpSatisfied),
  };
}

export function selectRelevantPassAssessment(
  decisionTarget: string,
  currentStage: CodingInterviewStage,
  assessment: PassConditionsAssessment,
) {
  if (["implementation", "approach", "understanding", "debugging"].includes(decisionTarget)) {
    return assessment.implementation;
  }
  if (["complexity", "tradeoff"].includes(decisionTarget)) {
    return assessment.complexity;
  }
  if (["testing", "edge_case"].includes(decisionTarget)) {
    return assessment.testing;
  }
  if (currentStage === "WRAP_UP" || decisionTarget === "summary") {
    return assessment.wrapUp;
  }

  return assessment.implementation;
}

function buildTopicAssessment(
  topic: TopicGateKey,
  passConditions: string[],
  satisfied: string[],
): TopicPassAssessment {
  return {
    topic,
    passConditions,
    satisfied,
    missing: passConditions.filter((condition) => !satisfied.includes(condition)),
    complete: satisfied.length === passConditions.length,
  };
}
