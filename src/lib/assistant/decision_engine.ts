import type {
  CandidateSignalSnapshot,
} from "@/lib/assistant/signal_extractor";
import type {
  CodingInterviewHintLevel,
  CodingInterviewHintStyle,
  CodingInterviewPolicy,
  CodingInterviewPolicyAction,
} from "@/lib/assistant/policy";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

export type CandidateDecisionAction =
  | "ask_followup"
  | "give_hint"
  | "move_stage"
  | "ask_for_test_case"
  | "ask_for_complexity"
  | "ask_for_debug_plan"
  | "encourage_and_continue";

export type CandidateDecisionTarget =
  | "understanding"
  | "approach"
  | "implementation"
  | "debugging"
  | "edge_case"
  | "complexity"
  | "tradeoff"
  | "testing"
  | "summary";

export type CandidateDecision = {
  action: CandidateDecisionAction;
  target: CandidateDecisionTarget;
  question: string;
  reason: string;
  confidence: number;
  suggestedStage?: CodingInterviewStage;
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
  policyAction: CodingInterviewPolicyAction;
};

export function makeCandidateDecision(input: {
  currentStage: CodingInterviewStage;
  policy: CodingInterviewPolicy;
  signals: CandidateSignalSnapshot;
  recentEvents?: Array<{ eventType: string; payloadJson?: unknown }>;
  latestExecutionRun?: ExecutionRunLike | null;
}): CandidateDecision {
  const { currentStage, policy, signals, latestExecutionRun } = input;
  const repeatedFailures = countRecentFailedRuns(input.recentEvents ?? []);
  const repeatedHints = countRecentHints(input.recentEvents ?? []);

  if (policy.shouldServeHint) {
    return {
      action: "give_hint",
      target: mapHintTarget(policy.hintStyle),
      question: buildHintDecisionQuestion(policy.hintStyle, policy.hintLevel),
      reason: `Policy requested a hint because ${policy.escalationReason ?? "the candidate needs guidance"} and the candidate currently looks ${signals.progress}.`,
      confidence: 0.86,
      suggestedStage: policy.nextStage,
      hintStyle: policy.hintStyle,
      hintLevel: policy.hintLevel,
      policyAction: policy.recommendedAction,
    };
  }

  if (signals.progress === "stuck" && repeatedFailures >= 2) {
    return {
      action: "ask_for_debug_plan",
      target: "debugging",
      question:
        "Let's narrow this down. Pick one failing input, tell me the first state that becomes wrong, and name the single line or branch you would inspect first.",
      reason: "The candidate looks stuck and has accumulated repeated failed runs, so the interviewer should force a very local debugging move.",
      confidence: 0.94,
      suggestedStage: "DEBUGGING",
      policyAction: "DEBUG_RUNTIME",
    };
  }

  if (latestExecutionRun?.status === "FAILED" || latestExecutionRun?.status === "ERROR" || latestExecutionRun?.status === "TIMEOUT") {
    return {
      action: "ask_for_debug_plan",
      target: "debugging",
      question:
        signals.edgeCaseAwareness === "missing"
          ? "What concrete failing input or edge case would you use to reproduce this bug first?"
          : "Where do you think the implementation first diverges from your intended logic, and how would you verify that quickly?",
      reason: "The latest code run failed, so the interviewer should move from open-ended discussion into concrete debugging.",
      confidence: 0.9,
      suggestedStage: "DEBUGGING",
      policyAction: policy.recommendedAction,
    };
  }

  if (latestExecutionRun?.status === "PASSED" && currentStage !== "WRAP_UP") {
    if (signals.edgeCaseAwareness === "missing" || signals.edgeCaseAwareness === "partial") {
      return {
        action: "ask_for_test_case",
        target: "edge_case",
        question: "Your latest run passed. What boundary conditions or edge cases would you test next before you call this done?",
        reason: "A passing run is a good point to probe validation depth and edge-case discipline.",
        confidence: 0.88,
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      };
    }

    return {
      action: "ask_for_complexity",
      target: "complexity",
      question: "Now that the implementation works, walk me through the final time and space complexity and the main tradeoff behind this approach.",
      reason: "The solution appears to work, so the interviewer should close the loop on complexity and tradeoffs.",
      confidence: 0.9,
      suggestedStage: "TESTING_AND_COMPLEXITY",
      policyAction: "VALIDATE_AND_TEST",
    };
  }

  if (currentStage === "PROBLEM_UNDERSTANDING") {
    if (signals.understanding !== "clear") {
      return {
        action: "ask_followup",
        target: "understanding",
        question: "Before we choose an algorithm, what assumptions are you making about the input and what would a correct output look like on one small example?",
        reason: "The candidate has not yet made the problem framing concrete enough.",
        confidence: 0.82,
        suggestedStage: "PROBLEM_UNDERSTANDING",
        policyAction: "CLARIFY",
      };
    }

    return {
      action: "move_stage",
      target: "approach",
      question: "Good. Given those assumptions, what algorithmic direction would you take first, and why does it fit the constraints?",
      reason: "The candidate sounds clear enough on the prompt to move into approach discussion.",
      confidence: 0.78,
      suggestedStage: "APPROACH_DISCUSSION",
      policyAction: "PROBE_APPROACH",
    };
  }

  if (currentStage === "APPROACH_DISCUSSION") {
    if (signals.understanding === "clear" && signals.algorithmChoice === "suboptimal") {
      return {
        action: "ask_followup",
        target: "tradeoff",
        question:
          "Your framing is clear. Now push on the algorithm choice itself: what would the runtime be here, and is there a more efficient pattern or data structure you would consider instead?",
        reason: "The candidate understands the problem, but the current algorithm choice still sounds too weak for the interview bar.",
        confidence: 0.9,
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (signals.algorithmChoice === "suboptimal") {
      return {
        action: "ask_followup",
        target: "tradeoff",
        question: "Can you compare that idea against a more efficient alternative and explain what tradeoff you are making?",
        reason: "The current algorithm choice still sounds weaker than it needs to be.",
        confidence: 0.83,
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (signals.communication === "unclear" || signals.behavior === "overthinking") {
      return {
        action: "ask_followup",
        target: "approach",
        question: "Let's make it concrete. Walk me through one example step by step and name the exact state you would track.",
        reason: "The candidate needs a narrower prompt to make the approach easier to evaluate.",
        confidence: 0.85,
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    return {
      action: "encourage_and_continue",
      target: "implementation",
      question: "That direction sounds reasonable. Go ahead and start implementing it, but narrate the invariant or the key branch as you code.",
      reason: "The approach looks workable enough to let the candidate move into implementation.",
      confidence: 0.8,
      suggestedStage: "IMPLEMENTATION",
      policyAction: "LET_IMPLEMENT",
    };
  }

  if (currentStage === "IMPLEMENTATION") {
    if (
      (signals.codeQuality === "correct" || latestExecutionRun?.status === "PASSED") &&
      (signals.edgeCaseAwareness === "missing" || signals.edgeCaseAwareness === "partial")
    ) {
      return {
        action: "ask_for_test_case",
        target: "edge_case",
        question:
          "The implementation looks close. Before we move on, which edge cases would you test first, and is there any boundary condition that could still break the current code?",
        reason: "The candidate appears close to done on implementation, but validation discipline is still thin.",
        confidence: 0.91,
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      };
    }

    if (signals.progress === "stuck") {
      return {
        action: "ask_followup",
        target: "implementation",
        question: "What is the single trickiest branch or state update in your implementation right now, and what should happen there on a small example?",
        reason: "The candidate seems stalled during implementation, so the interviewer should localize the problem.",
        confidence: 0.82,
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

    return {
      action: "encourage_and_continue",
      target: "implementation",
      question: "Keep going with the implementation. As you write it, call out the one invariant or pointer update that keeps the solution correct.",
      reason: "The candidate still appears to be making progress in implementation.",
      confidence: 0.74,
      suggestedStage: "IMPLEMENTATION",
      policyAction: "LET_IMPLEMENT",
    };
  }

  if (currentStage === "TESTING_AND_COMPLEXITY") {
    if (signals.edgeCaseAwareness === "missing") {
      return {
        action: "ask_for_test_case",
        target: "testing",
        question: "Before we wrap, which edge cases would you test first, and why are those the highest-risk cases for this solution?",
        reason: "The candidate has not yet shown enough validation discipline.",
        confidence: 0.84,
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      };
    }

    return {
      action: "ask_for_complexity",
      target: "complexity",
      question: "Great. Give me the final time complexity, space complexity, and one tradeoff you made in choosing this approach.",
      reason: "This is the right point to capture the final evaluation signals before wrap-up.",
      confidence: 0.86,
      suggestedStage: "WRAP_UP",
      policyAction: "WRAP_UP",
    };
  }

  if (repeatedHints >= 2 && signals.progress !== "done") {
    return {
      action: "ask_followup",
      target: "summary",
      question:
        "Before I give another hint, summarize where you are: what already works, what is still uncertain, and what exact next step you want to try.",
      reason: "Repeated hint usage suggests the interviewer should force a concise status reset before more guidance.",
      confidence: 0.81,
      suggestedStage: currentStage,
      policyAction: policy.recommendedAction,
    };
  }

  return {
    action: "ask_followup",
    target: "summary",
    question: "Wrap this up for me: what is the final approach, what are the main tradeoffs, and what would you improve if you had more time?",
    reason: "The interview is in wrap-up, so the interviewer should close with a concise summary request.",
    confidence: 0.78,
    suggestedStage: "WRAP_UP",
    policyAction: "WRAP_UP",
  };
}

function countRecentFailedRuns(events: Array<{ eventType: string; payloadJson?: unknown }>) {
  return events.filter((event) => {
    if (event.eventType !== "CODE_RUN_COMPLETED") {
      return false;
    }

    const payload =
      typeof event.payloadJson === "object" && event.payloadJson !== null
        ? (event.payloadJson as Record<string, unknown>)
        : {};

    return payload.status === "FAILED" || payload.status === "ERROR" || payload.status === "TIMEOUT";
  }).length;
}

function countRecentHints(events: Array<{ eventType: string; payloadJson?: unknown }>) {
  return events.filter((event) => event.eventType === "HINT_REQUESTED" || event.eventType === "HINT_SERVED").length;
}

function mapHintTarget(hintStyle?: CodingInterviewHintStyle): CandidateDecisionTarget {
  switch (hintStyle) {
    case "CLARIFYING_NUDGE":
      return "understanding";
    case "APPROACH_NUDGE":
      return "approach";
    case "IMPLEMENTATION_NUDGE":
      return "implementation";
    case "DEBUGGING_NUDGE":
      return "debugging";
    case "TESTING_NUDGE":
      return "testing";
    default:
      return "approach";
  }
}

function buildHintDecisionQuestion(hintStyle?: CodingInterviewHintStyle, hintLevel?: CodingInterviewHintLevel) {
  const prefix =
    hintLevel === "STRONG"
      ? "Let's narrow this down aggressively. "
      : hintLevel === "MEDIUM"
        ? "Here's a more direct nudge. "
        : "Small hint. ";

  switch (hintStyle) {
    case "CLARIFYING_NUDGE":
      return `${prefix}Focus first on the exact constraints and one concrete example before you pick an algorithm.`;
    case "APPROACH_NUDGE":
      return `${prefix}Think about which piece of information you need to look up quickly as you scan the input.`;
    case "IMPLEMENTATION_NUDGE":
      return `${prefix}Keep the core loop simple and name the invariant that should stay true on each iteration.`;
    case "DEBUGGING_NUDGE":
      return `${prefix}Start from the first failing path and identify the earliest branch or state transition that becomes wrong.`;
    case "TESTING_NUDGE":
      return `${prefix}Cover one happy path, one boundary case, and then summarize the final complexity.`;
    default:
      return `${prefix}Take one small example and identify the single most important piece of state to track.`;
  }
}
