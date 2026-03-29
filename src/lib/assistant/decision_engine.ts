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
  | "encourage_and_continue"
  | "ask_for_reasoning"
  | "probe_correctness"
  | "probe_tradeoff"
  | "hold_and_listen";

export type CandidateDecisionTarget =
  | "understanding"
  | "approach"
  | "implementation"
  | "debugging"
  | "edge_case"
  | "complexity"
  | "tradeoff"
  | "testing"
  | "summary"
  | "reasoning"
  | "correctness";

export type CandidateDecision = {
  action: CandidateDecisionAction;
  target: CandidateDecisionTarget;
  question: string;
  reason: string;
  confidence: number;
  targetCodeLine?: string;
  specificIssue?: string;
  expectedAnswer?: string;
  suggestedStage?: CodingInterviewStage;
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
  policyAction: CodingInterviewPolicyAction;
};

type FailureSignal = {
  type: "timeout" | "index" | "null" | "assertion" | "wrong_answer" | "generic";
  question: string;
  targetCodeLine: string;
  specificIssue: string;
  expectedAnswer: string;
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
  const latestTurns = (input.recentEvents ?? []).slice(-8);
  const aiTurnCount = latestTurns.filter((event) => event.eventType === "AI_SPOKE").length;
  const candidateTurnCount = latestTurns.filter((event) => event.eventType === "CANDIDATE_SPOKE").length;
  const candidateHasFloor = candidateTurnCount > aiTurnCount;
  const improvingTrend = looksImproving(signals.trendSummary);
  const unstableTrend = looksUnstable(signals.trendSummary);
  const invariantEvidence = findStructuredEvidence(signals, "correctness", /invariant|correctness/i);
  const boundaryEvidence = findStructuredEvidence(signals, "edge_case", /boundary|edge-case|edge case/i);
  const tradeoffEvidence = findStructuredEvidence(signals, "complexity", /tradeoff/i);

  if (policy.shouldServeHint) {
    return {
      action: "give_hint",
      target: mapHintTarget(policy.hintStyle),
      question: buildHintDecisionQuestion(policy.hintStyle, policy.hintLevel),
      reason: `Policy requested a hint because ${policy.escalationReason ?? "the candidate needs guidance"} and the candidate currently looks ${signals.progress}.`,
      confidence: 0.86,
      targetCodeLine: "the single next state update or branch to focus on",
      specificIssue: "The candidate needs a bounded hint instead of another broad prompt.",
      expectedAnswer: "A smaller next step or local insight the candidate can act on without receiving the full solution.",
      suggestedStage: policy.nextStage,
      hintStyle: policy.hintStyle,
      hintLevel: policy.hintLevel,
      policyAction: policy.recommendedAction,
    };
  }

  if (signals.progress === "stuck" && repeatedFailures >= 2) {
    const failureSignal = classifyFailureSignal(latestExecutionRun, signals);
    return {
      action: "ask_for_debug_plan",
      target: "debugging",
      question: failureSignal.question,
      reason: "The candidate looks stuck and has accumulated repeated failed runs, so the interviewer should force a very local debugging move.",
      confidence: 0.94,
      targetCodeLine: failureSignal.targetCodeLine,
      specificIssue: `Repeated failed runs indicate the candidate is not localizing the bug. ${failureSignal.specificIssue}`,
      expectedAnswer: failureSignal.expectedAnswer,
      suggestedStage: "DEBUGGING",
      policyAction: "DEBUG_RUNTIME",
    };
  }

  if (latestExecutionRun?.status === "FAILED" || latestExecutionRun?.status === "ERROR" || latestExecutionRun?.status === "TIMEOUT") {
    const failureSignal = classifyFailureSignal(latestExecutionRun, signals);
    return {
      action: "ask_for_debug_plan",
      target: "debugging",
      question: failureSignal.question,
      reason: "The latest code run failed, so the interviewer should move from open-ended discussion into concrete debugging.",
      confidence: 0.9,
      targetCodeLine: failureSignal.targetCodeLine,
      specificIssue: failureSignal.specificIssue,
      expectedAnswer: failureSignal.expectedAnswer,
      suggestedStage: "DEBUGGING",
      policyAction: policy.recommendedAction,
    };
  }

  if (latestExecutionRun?.status === "PASSED" && currentStage !== "WRAP_UP") {
    if (signals.edgeCaseAwareness === "missing" || signals.edgeCaseAwareness === "partial") {
      const testPrompt =
        signals.edgeCaseAwareness === "missing"
          ? "Your latest run passed. Before you call it done, what empty-input, single-element, or duplicate-heavy cases would you test next?"
          : "Your latest run passed. Which boundary condition would you test next, and what exact output should it produce?";
      return {
        action: "ask_for_test_case",
        target: "edge_case",
        question: testPrompt,
        reason: "A passing run is a good point to probe validation depth and edge-case discipline.",
        confidence: 0.88,
        targetCodeLine:
          signals.edgeCaseAwareness === "missing"
            ? "input guards and boundary-condition branches that have not been exercised yet"
            : "the most failure-prone boundary condition around the current logic",
        specificIssue:
          signals.edgeCaseAwareness === "missing"
            ? "The code ran successfully, but the candidate has not shown any concrete edge-case coverage yet."
            : "The code ran successfully, but the candidate has not named the highest-risk boundary case explicitly enough.",
        expectedAnswer:
          signals.edgeCaseAwareness === "missing"
            ? "Two or three high-risk edge cases such as empty input, single element, or duplicates, plus the expected output."
            : "One highest-risk boundary case and the exact output expected from the current implementation.",
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
      targetCodeLine: "the dominant loop or operation that drives runtime and memory usage",
      specificIssue: "The implementation is working, but the final performance story still needs to be made explicit.",
      expectedAnswer: "Final time complexity, space complexity, and one tradeoff compared with an alternative.",
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
        targetCodeLine: "problem constraints, input assumptions, and expected output shape",
        specificIssue: "The prompt framing is still incomplete.",
        expectedAnswer: "A clarified restatement with explicit assumptions and one small example.",
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
      targetCodeLine: "the algorithm choice before any implementation details",
      specificIssue: "The prompt framing is now strong enough to transition into approach selection.",
      expectedAnswer: "A concrete algorithm direction plus why it fits the constraints.",
      suggestedStage: "APPROACH_DISCUSSION",
      policyAction: "PROBE_APPROACH",
    };
  }

  if (currentStage === "APPROACH_DISCUSSION") {
    if (invariantEvidence) {
      return {
        action: "probe_correctness",
        target: "correctness",
        question:
          "Make the correctness argument sharper for me. What invariant stays true after each step, or what exact state transition convinces you this approach remains correct?",
        reason: "The latest candidate evidence says the approach exists, but the invariant or correctness story is still underspecified.",
        confidence: 0.92,
        targetCodeLine: "the invariant, tracked state, or state transition that proves the approach stays correct",
        specificIssue: invariantEvidence.issue,
        expectedAnswer:
          "One explicit invariant or one concrete example that shows what remains true after each step and why that guarantees correctness.",
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (tradeoffEvidence && signals.algorithmChoice !== "strong") {
      return {
        action: "probe_tradeoff",
        target: "tradeoff",
        question:
          "You named the complexity, but compare this approach against a realistic alternative for me. What cost are you accepting on runtime, memory, or implementation complexity, and why is that tradeoff worth it here?",
        reason: "The candidate mentioned complexity, but the tradeoff analysis is still shallow.",
        confidence: 0.9,
        targetCodeLine: "the chosen algorithm versus one realistic alternative",
        specificIssue: tradeoffEvidence.issue,
        expectedAnswer:
          "A direct comparison against one alternative, plus the runtime, memory, or simplicity tradeoff that justifies the chosen approach.",
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (unstableTrend && signals.reasoningDepth !== "deep") {
      return {
        action: "ask_for_reasoning",
        target: "reasoning",
        question:
          "Let's reset on the core logic. In one concrete example, what state are you tracking, how does it change, and why does that produce the right output?",
        reason: "The recent candidate-state trend looks unstable, so the interviewer should force a concrete reasoning reset instead of another broad prompt.",
        confidence: 0.91,
        targetCodeLine: "the core state or invariant in the proposed approach",
        specificIssue: "The approach discussion is wobbling and needs a concrete reasoning reset.",
        expectedAnswer: "One example, the tracked state, and why that state evolution leads to the correct output.",
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (signals.reasoningDepth === "thin" && signals.communication !== "unclear") {
      return {
        action: "ask_for_reasoning",
        target: "reasoning",
        question:
          "Make the reasoning explicit for me. Why does this approach work, and what exact state or invariant makes you confident it stays correct on a concrete example?",
        reason: "The candidate named a direction, but the reasoning behind it is still too thin for a strong interview signal.",
        confidence: 0.9,
        targetCodeLine: "the invariant or correctness argument behind the chosen approach",
        specificIssue: "The candidate has an approach, but the why-it-works argument is still too implicit.",
        expectedAnswer: "A concrete example or invariant that makes the approach feel trustworthy.",
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (signals.understanding === "clear" && signals.algorithmChoice === "suboptimal") {
      return {
        action: "probe_tradeoff",
        target: "tradeoff",
        question:
          "Your framing is clear. Now push on the algorithm choice itself: what would the runtime be here, and is there a more efficient pattern or data structure you would consider instead?",
        reason: "The candidate understands the problem, but the current algorithm choice still sounds too weak for the interview bar.",
        confidence: 0.9,
        targetCodeLine: "the algorithm choice itself before coding begins",
        specificIssue: "The candidate's algorithm choice looks workable but weaker than it should be.",
        expectedAnswer: "The runtime of the current idea, a stronger alternative, and the tradeoff between them.",
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (signals.algorithmChoice === "suboptimal") {
      return {
        action: "probe_tradeoff",
        target: "tradeoff",
        question: "Can you compare that idea against a more efficient alternative and explain what tradeoff you are making?",
        reason: "The current algorithm choice still sounds weaker than it needs to be.",
        confidence: 0.83,
        targetCodeLine: "the data-structure or pattern choice that determines asymptotic performance",
        specificIssue: "The candidate is leaning toward a weaker algorithmic pattern.",
        expectedAnswer: "A direct comparison against a more efficient alternative and the tradeoff being accepted.",
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
        targetCodeLine: "the exact state tracked in the example walkthrough",
        specificIssue: "The current explanation is too broad or too hedged to evaluate cleanly.",
        expectedAnswer: "A step-by-step example with one clear piece of tracked state.",
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (improvingTrend) {
      return {
        action: "encourage_and_continue",
        target: "implementation",
        question: "This is getting sharper. Go ahead and implement it, and narrate the one invariant or state update that matters most.",
        reason: "The candidate-state trend is improving, so the interviewer should stop over-probing and let the implementation begin.",
        confidence: 0.8,
        targetCodeLine: "the next invariant or key state update to narrate while coding",
        specificIssue: "The candidate is improving and should be allowed to keep momentum.",
        expectedAnswer: "Continued implementation with light narration of the most failure-prone step.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

    return {
      action: "encourage_and_continue",
      target: "implementation",
      question: "That direction sounds reasonable. Go ahead and start implementing it, but narrate the invariant or the key branch as you code.",
      reason: "The approach looks workable enough to let the candidate move into implementation.",
      confidence: 0.8,
      targetCodeLine: "the main loop, invariant, or key branch in the upcoming implementation",
      specificIssue: "The candidate has enough approach signal to move from talking into coding.",
      expectedAnswer: "Implementation progress with brief narration of the core invariant or key branch.",
      suggestedStage: "IMPLEMENTATION",
      policyAction: "LET_IMPLEMENT",
    };
  }

  if (currentStage === "IMPLEMENTATION") {
    if (invariantEvidence && signals.codeQuality !== "buggy") {
      return {
        action: "probe_correctness",
        target: "correctness",
        question:
          "Pause on the code itself for a second. Which invariant or state relationship has to remain true after each iteration for this implementation to stay correct?",
        reason: "The implementation is moving, but the correctness invariant is still too implicit in the latest evidence.",
        confidence: 0.88,
        targetCodeLine: "the loop invariant or state relationship that the implementation depends on",
        specificIssue: invariantEvidence.issue,
        expectedAnswer:
          "The specific invariant, where the code maintains it, and how one example shows it stays true after each iteration.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

    if (unstableTrend && signals.progress !== "done") {
      return {
        action: "ask_followup",
        target: "implementation",
        question:
          "Pause on the full solution for a second. What exact state update or branch keeps drifting, and what should it do on one tiny input?",
        reason: "The candidate-state trend suggests the implementation is wobbling, so the interviewer should localize the next move.",
        confidence: 0.86,
        targetCodeLine: "the exact state update or branch that is drifting",
        specificIssue: "The implementation is moving, but state quality is getting worse.",
        expectedAnswer: "One tiny input plus the exact state update or branch that should be correct there.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

    if (signals.progress === "progressing" && signals.behavior === "structured" && candidateHasFloor) {
      return {
        action: "hold_and_listen",
        target: "implementation",
        question: "Continue. As you code, call out just the one branch or invariant that is easiest to get wrong.",
        reason: "The candidate is progressing in a structured way, so the interviewer should avoid over-interrupting and only lightly steer the implementation.",
        confidence: 0.72,
        targetCodeLine: "the one branch or invariant worth lightly narrating while coding",
        specificIssue: "The candidate is progressing and should keep the floor rather than being over-probed.",
        expectedAnswer: "Continued implementation with one short note about the most error-prone branch or invariant.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

    if (
      (signals.codeQuality === "correct" || latestExecutionRun?.status === "PASSED") &&
      signals.reasoningDepth === "thin"
    ) {
      return {
        action: "probe_correctness",
        target: "correctness",
        question:
          "Before we move on, convince me this implementation is correct on one concrete example. What invariant or reasoning step makes it safe?",
        reason: "The implementation looks close, but the correctness argument is still too thin for a strong signal.",
        confidence: 0.89,
        targetCodeLine: "the specific branch, invariant, or example that proves correctness",
        specificIssue: "The code may be close, but the candidate has not yet demonstrated why it is correct.",
        expectedAnswer: "A concrete example or invariant showing why the implementation stays correct.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

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
        targetCodeLine: boundaryEvidence
          ? "the boundary-condition branch or guard clause that still needs explicit validation"
          : "input guards and boundary-condition handling around the current implementation",
        specificIssue:
          boundaryEvidence?.issue ?? "The implementation looks close, but edge-case coverage is not yet visible.",
        expectedAnswer: boundaryEvidence
          ? "Two concrete boundary cases, the exact expected output for each, and whether the current implementation already covers them."
          : "The highest-risk boundary cases and whether the current code already handles them.",
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
        targetCodeLine: "the single trickiest branch or state update in the current implementation",
        specificIssue: "The candidate is stalled and needs the problem localized.",
        expectedAnswer: "One branch or state update plus what it should do on a tiny example.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

    return {
      action: "hold_and_listen",
      target: "implementation",
      question: "Keep going with the implementation. As you write it, call out the one invariant or pointer update that keeps the solution correct.",
      reason: "The candidate still appears to be making progress in implementation.",
      confidence: 0.74,
      targetCodeLine: "the invariant or pointer update to keep naming while coding",
      specificIssue: "The candidate is still progressing and should keep momentum.",
      expectedAnswer: "Continued implementation with concise narration of the most important invariant or pointer update.",
      suggestedStage: "IMPLEMENTATION",
      policyAction: "LET_IMPLEMENT",
    };
  }

  if (currentStage === "TESTING_AND_COMPLEXITY") {
    if (boundaryEvidence && signals.testingDiscipline !== "strong") {
      return {
        action: "ask_for_test_case",
        target: "testing",
        question:
          "Let's make the boundary coverage concrete. Which exact empty, minimal, or duplicate-heavy inputs would you test next, and what output should each produce?",
        reason: "The latest evidence says boundary coverage is still too narrow for a clean close-out.",
        confidence: 0.9,
        targetCodeLine: "the exact boundary-condition inputs and expected outputs that validate the solution",
        specificIssue: boundaryEvidence.issue,
        expectedAnswer:
          "At least two boundary cases, why they matter, and the precise expected output for each.",
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      };
    }

    if (tradeoffEvidence) {
      return {
        action: "probe_tradeoff",
        target: "tradeoff",
        question:
          "You already named the complexity. Now tell me the tradeoff story: what are you paying in memory, implementation complexity, or flexibility, and why is that acceptable compared with the main alternative?",
        reason: "The candidate has mentioned complexity, but the tradeoff analysis is still too shallow to finish strongly.",
        confidence: 0.89,
        targetCodeLine: "the tradeoff between the chosen approach and the main alternative",
        specificIssue: tradeoffEvidence.issue,
        expectedAnswer:
          "A concrete comparison with one alternative and the reason this runtime, memory, or simplicity tradeoff is acceptable.",
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      };
    }

    if (unstableTrend && signals.testingDiscipline !== "strong") {
      return {
        action: "ask_for_test_case",
        target: "testing",
        question:
          "Let's make validation concrete. Name the two highest-risk edge cases you would run next, and what result you expect from each.",
        reason: "The latest state trend has not stabilized, so the interviewer should ask for explicit test evidence before wrapping up.",
        confidence: 0.88,
        targetCodeLine: "the highest-risk tests or boundary conditions that validate the solution",
        specificIssue: "The session is nearing wrap-up, but validation evidence is still unstable.",
        expectedAnswer: "Two high-risk edge cases and the expected result for each.",
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      };
    }

    if (signals.testingDiscipline === "missing" || signals.edgeCaseAwareness === "missing") {
      return {
        action: "ask_for_test_case",
        target: "testing",
        question: "Before we wrap, which edge cases would you test first, and why are those the highest-risk cases for this solution?",
        reason: "The candidate has not yet shown enough validation discipline.",
        confidence: 0.84,
        targetCodeLine: "the explicit test cases and boundary conditions that should be checked before wrap-up",
        specificIssue: "The candidate has not yet demonstrated a concrete validation plan.",
        expectedAnswer: "A short list of high-risk edge cases and why they matter.",
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      };
    }

    if (signals.complexityRigor !== "strong") {
      return {
        action: "ask_for_complexity",
        target: "complexity",
        question:
          "Now pin down the final time and space complexity, and tell me what tradeoff you accepted to get there.",
        reason: "The candidate has not yet articulated complexity rigor strongly enough for a clean close-out.",
        confidence: 0.87,
        targetCodeLine: "the dominant runtime and memory drivers in the final approach",
        specificIssue: "The final complexity and tradeoff story is still incomplete.",
        expectedAnswer: "Final time complexity, space complexity, and the tradeoff accepted to reach them.",
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
      targetCodeLine: "the final complexity statement and tradeoff summary",
      specificIssue: "The interview is ready to capture final complexity and tradeoff signals before wrap-up.",
      expectedAnswer: "A concise final complexity statement plus one tradeoff in the chosen approach.",
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
      targetCodeLine: "the current uncertainty and the single next step the candidate wants to try",
      specificIssue: "Repeated hints suggest the candidate needs a status reset before more guidance.",
      expectedAnswer: "What already works, what remains uncertain, and one precise next step.",
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
    targetCodeLine: "the final summary of approach, tradeoffs, and next improvement",
    specificIssue: "The interview is ending and needs a concise final summary.",
    expectedAnswer: "The final approach, main tradeoffs, and one improvement to try next.",
    suggestedStage: "WRAP_UP",
    policyAction: "WRAP_UP",
  };
}

function looksImproving(trendSummary?: string) {
  if (!trendSummary) {
    return false;
  }

  return /\b(moved from (stuck|partial|missing) to (progressing|done|present|strong|moderate|deep)|changed from buggy to correct)\b/i.test(
    trendSummary,
  );
}

function looksUnstable(trendSummary?: string) {
  if (!trendSummary) {
    return false;
  }

  return /\b(moved from progressing to stuck|changed from correct to buggy|changed from present to missing|changed from deep to thin|changed from strong to missing)\b/i.test(
    trendSummary,
  );
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

function classifyFailureSignal(
  latestExecutionRun: ExecutionRunLike | null | undefined,
  signals: CandidateSignalSnapshot,
): FailureSignal {
  const stderr = latestExecutionRun?.stderr?.toLowerCase() ?? "";
  const stdout = latestExecutionRun?.stdout?.toLowerCase() ?? "";

  if (latestExecutionRun?.status === "TIMEOUT" || /timed out|timeout/.test(stderr)) {
    return {
      type: "timeout",
      question:
        "This looks like a timeout. Which loop, recursion branch, or repeated operation is likely dominating the runtime, and what smaller complexity target are you aiming for?",
      targetCodeLine: "the hottest loop, recursion branch, or repeated operation causing the timeout",
      specificIssue: "The current implementation is doing more work than expected and needs a complexity-focused debugging pass.",
      expectedAnswer: "The candidate should name the expensive step, estimate its cost, and describe a tighter alternative.",
    };
  }

  if (/indexerror|out of range|outofbounds|out of bounds/.test(stderr)) {
    return {
      type: "index",
      question:
        "This looks like an indexing or bounds bug. Which pointer, index, or array access can step outside the valid range first, and on what smallest input would that happen?",
      targetCodeLine: "the first pointer or array access that can fall outside the valid range",
      specificIssue: "The current code likely violates an index or bounds assumption on a small input.",
      expectedAnswer: "The candidate should name the risky pointer/index, a minimal reproducer input, and the guard or branch that prevents it.",
    };
  }

  if (/null|none|undefined|attributeerror|typeerror/.test(stderr)) {
    return {
      type: "null",
      question:
        "This looks like a missing guard around null, None, or undefined state. Which value can be absent here, and where would you add the first protective check?",
      targetCodeLine: "the first branch that assumes a value exists when it may be null, None, or undefined",
      specificIssue: "The implementation is assuming state exists without guarding the missing-value path.",
      expectedAnswer: "The candidate should identify the nullable value, the failing path, and the guard clause or conditional needed first.",
    };
  }

  if (/assert|expected|mismatch|wrong answer/.test(stderr) || /expected/.test(stdout)) {
    return {
      type: "assertion",
      question:
        signals.edgeCaseAwareness === "missing"
          ? "The run suggests a wrong answer. What exact input would you use to reproduce the mismatch, and which edge case or branch do you think it exposes?"
          : "The run suggests a wrong answer. On the failing input, where does your state first differ from the expected result?",
      targetCodeLine: "the branch or state transition that first produces the wrong output",
      specificIssue: "The implementation is producing an incorrect answer rather than crashing, so the logical divergence needs to be localized.",
      expectedAnswer: "A failing input, the first incorrect state or branch, and why that branch produces the wrong output.",
    };
  }

  if (signals.edgeCaseAwareness === "missing") {
    return {
      type: "wrong_answer",
      question: "What concrete failing input or edge case would you use to reproduce this bug first?",
      targetCodeLine: "the branch that handles the first high-risk edge case the candidate has not validated yet",
      specificIssue: "There is execution evidence of failure, and edge-case coverage is still weak.",
      expectedAnswer: "A concrete reproducer input, the edge case it exposes, and the first branch to inspect.",
    };
  }

  return {
    type: "generic",
    question: "Where do you think the implementation first diverges from your intended logic, and how would you verify that quickly?",
    targetCodeLine: "the first branch or state transition that diverges on the failing path",
    specificIssue: "There is execution evidence of failure, but the next debugging move is still too broad.",
    expectedAnswer: "A concrete failing input and the first place in the code where the candidate suspects the logic diverges.",
  };
}

function findStructuredEvidence(
  signals: CandidateSignalSnapshot,
  area: CandidateSignalSnapshot["structuredEvidence"][number]["area"],
  issuePattern?: RegExp,
) {
  return (
    signals.structuredEvidence.find((item) => {
      if (item.area !== area) {
        return false;
      }

      if (!issuePattern) {
        return true;
      }

      return issuePattern.test(item.issue) || issuePattern.test(item.evidence);
    }) ?? null
  );
}
