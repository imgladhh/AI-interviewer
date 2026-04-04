import type {
  CandidateSignalSnapshot,
} from "@/lib/assistant/signal_extractor";
import type {
  CodingInterviewHintLevel,
  CodingInterviewHintStyle,
  CodingInterviewPolicy,
  CodingInterviewPolicyAction,
} from "@/lib/assistant/policy";
import {
  type HintGranularity,
  type RescueMode,
} from "@/lib/assistant/hinting_ledger";
import {
  resolveHintStrategy,
  type HintTier,
  type HintInitiator,
  type HintRequestTiming,
  type MomentumAtHint,
} from "@/lib/assistant/hint_strategy";
import {
  decideInterviewerIntent,
  type IntentDecision,
  type InterviewerIntent,
} from "@/lib/assistant/interviewer_intent";
import {
  assessPassConditions,
  selectRelevantPassAssessment,
} from "@/lib/assistant/pass_conditions";
import type {
  DecisionPressure,
  DecisionUrgency,
  EvidenceImportance,
  InterruptionCost,
} from "@/lib/assistant/pacing";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import type { CodingInterviewStage } from "@/lib/assistant/stages";
import {
  estimateCandidateTrajectory,
  type TrajectoryEstimate,
} from "@/lib/assistant/trajectory_estimator";

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

export type CandidateDecisionAction =
  | "ask_followup"
  | "ask_for_clarification"
  | "give_hint"
  | "move_stage"
  | "move_to_wrap_up"
  | "close_topic"
  | "end_interview"
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
  intent?: InterviewerIntent;
  intentReason?: string;
  intentTargetSignal?: string;
  expectedOutcome?: IntentDecision["expectedOutcome"];
  trajectory?: TrajectoryEstimate["candidateTrajectory"];
  expectedWithNoIntervention?: TrajectoryEstimate["expectedWithNoIntervention"];
  interventionValue?: TrajectoryEstimate["interventionValue"];
  bestIntervention?: TrajectoryEstimate["bestIntervention"];
  expectedEvidenceGain?: TrajectoryEstimate["evidenceGainIfAskNow"];
  worthAskingNow?: boolean;
  timing?: "ask_now" | "defer" | "skip";
  closureCandidate?: boolean;
  passConditions?: string[];
  missingPassConditions?: string[];
  passConditionTopic?: string;
  pressure?: DecisionPressure;
  urgency?: DecisionUrgency;
  canDefer?: boolean;
  interruptionCost?: InterruptionCost;
  evidenceImportance?: EvidenceImportance;
  batchable?: boolean;
  batchGroup?: string;
  question: string;
  reason: string;
  confidence: number;
  targetCodeLine?: string;
  specificIssue?: string;
  expectedAnswer?: string;
  suggestedStage?: CodingInterviewStage;
  hintStyle?: CodingInterviewHintStyle;
  hintLevel?: CodingInterviewHintLevel;
  rescueMode?: RescueMode;
  hintGranularity?: HintGranularity;
  hintTier?: HintTier;
  hintCost?: number;
  hintInitiator?: HintInitiator;
  hintRequestTiming?: HintRequestTiming;
  momentumAtHint?: MomentumAtHint;
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
  intent?: IntentDecision;
  trajectory?: TrajectoryEstimate;
}): CandidateDecision {
  const { currentStage, policy, signals, latestExecutionRun } = input;
  const ledger = buildMemoryLedger({
    currentStage,
    recentEvents: input.recentEvents ?? [],
    signals,
    latestExecutionRun,
  });
  const repeatedFailures = ledger.recentFailedRuns;
  const repeatedHints = ledger.recentHints;
  const latestTurns = (input.recentEvents ?? []).slice(-8);
  const aiTurnCount = latestTurns.filter((event) => event.eventType === "AI_SPOKE").length;
  const candidateTurnCount = latestTurns.filter((event) => event.eventType === "CANDIDATE_SPOKE").length;
  const candidateHasFloor = candidateTurnCount > aiTurnCount;
  const improvingTrend = looksImproving(signals.trendSummary);
  const unstableTrend = looksUnstable(signals.trendSummary);
  const persistentWeakness = ledger.persistentWeakness;
  const invariantEvidence = findStructuredEvidence(signals, "correctness", /invariant|correctness/i);
  const boundaryEvidence = findStructuredEvidence(signals, "edge_case", /boundary|edge-case|edge case/i);
  const tradeoffEvidence = findStructuredEvidence(signals, "complexity", /tradeoff/i);
  const hadRecentImplementationReadiness = detectRecentImplementationReadiness(input.recentEvents ?? []);
  const proofStyleAlreadyPressedTooMuch = ledger.recentProofStyleProbeCount >= 1;
  const passAssessment = assessPassConditions({
    currentStage,
    signals,
    memory: ledger,
    latestExecutionRun,
  });
  const shouldPreferImplementation =
    (signals.readyToCode || hadRecentImplementationReadiness) &&
    signals.understanding === "clear" &&
    (signals.algorithmChoice === "reasonable" || signals.algorithmChoice === "strong") &&
    signals.progress === "progressing" &&
    signals.communication !== "unclear";
  const enoughPreCodeEvidence =
    shouldPreferImplementation && passAssessment.implementation.complete;
  const targetAlreadyAnswered = (...targets: string[]) =>
    targets.some((target) => ledger.answeredTargets.includes(target));
  const hasCollectedEvidence = (...evidence: string[]) =>
    evidence.some((item) => ledger.collectedEvidence.includes(item));
  const resolvedIntent =
    input.intent ??
    decideInterviewerIntent({
      currentStage,
      signals,
      memory: ledger,
      latestExecutionRun,
    });
  const resolvedTrajectory =
    input.trajectory ??
    estimateCandidateTrajectory({
      currentStage,
      signals,
      memory: ledger,
      latestExecutionRun,
      intent: resolvedIntent,
    });
  const attachIntentTrajectory = (decision: CandidateDecision): CandidateDecision => {
    const relevantPassAssessment = selectRelevantPassAssessment(
      decision.target,
      decision.suggestedStage ?? currentStage,
      passAssessment,
    );
    const worthAskingNow =
      resolvedIntent.intent === "close"
        ? false
        : !(resolvedTrajectory.interruptionCost === "high" && resolvedTrajectory.evidenceGainIfAskNow === "low");
    return {
      ...decision,
      intent: resolvedIntent.intent,
      intentReason: resolvedIntent.reason,
      intentTargetSignal: resolvedIntent.targetSignal,
      expectedOutcome: resolvedIntent.expectedOutcome,
      trajectory: resolvedTrajectory.candidateTrajectory,
      expectedWithNoIntervention: resolvedTrajectory.expectedWithNoIntervention,
      interventionValue: resolvedTrajectory.interventionValue,
      bestIntervention: resolvedTrajectory.bestIntervention,
      expectedEvidenceGain: resolvedTrajectory.evidenceGainIfAskNow,
      worthAskingNow,
      timing:
        !worthAskingNow
          ? "defer"
          : resolvedIntent.intent === "close"
            ? "skip"
            : "ask_now",
      closureCandidate:
        resolvedIntent.intent === "close" ||
        resolvedTrajectory.bestIntervention === "close_topic" ||
        decision.action === "move_to_wrap_up" ||
        decision.action === "close_topic" ||
        decision.action === "end_interview",
      passConditions: relevantPassAssessment.passConditions,
      missingPassConditions: relevantPassAssessment.missing,
      passConditionTopic: relevantPassAssessment.topic,
    };
  };

  if (input.intent && resolvedIntent.intent === "close") {
    return attachIntentTrajectory({
      action: currentStage === "WRAP_UP" ? "end_interview" : "close_topic",
      target: "summary",
      question:
        currentStage === "WRAP_UP"
          ? "That covers this question well. We are done here."
          : "You have already covered the important evidence for this topic. Let us close this out and move on.",
      reason: resolvedIntent.reason,
      confidence: 0.91,
      suggestedStage: currentStage === "WRAP_UP" ? "WRAP_UP" : currentStage,
      policyAction: currentStage === "WRAP_UP" ? "WRAP_UP" : input.policy.recommendedAction,
    });
  }

  if (input.intent && resolvedIntent.intent === "advance" && resolvedTrajectory.bestIntervention === "move_to_implementation" && currentStage !== "WRAP_UP") {
    return attachIntentTrajectory({
      action: "encourage_and_continue",
      target: "implementation",
      question:
        "You have enough evidence on the approach. Go ahead and implement it now, and we can come back to any remaining details after we see the code.",
      reason: "Intent and trajectory both suggest that the highest-value move is to advance into implementation instead of interrupting momentum.",
      confidence: 0.9,
      suggestedStage: "IMPLEMENTATION",
      policyAction: "LET_IMPLEMENT",
    });
  }

  if (signals.confidence <= 0.4) {
    if (shouldPreferImplementation) {
      return attachIntentTrajectory({
        action: "encourage_and_continue",
        target: "implementation",
        question:
          "Your direction is concrete enough to code. Go ahead and implement it, and as you write, briefly call out the key state update or branch you are relying on.",
        reason:
          "Confidence is low, but the candidate has already shown concrete implementation evidence, so the interviewer should avoid regressing into generic clarification and let coding start.",
        confidence: 0.75,
        targetCodeLine: "the first key loop, branch, or state update in the implementation",
        specificIssue:
          "The system is not confident enough to over-probe, but there is already enough implementation evidence to start coding.",
        expectedAnswer: "Implementation progress plus one concise note about the key state update or branch.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      });
    }

    if (candidateHasFloor && signals.progress === "progressing") {
      return attachIntentTrajectory({
        action: "hold_and_listen",
        target: currentStage === "IMPLEMENTATION" ? "implementation" : "reasoning",
        question:
          "Keep going for a moment. I want to hear one more concrete example, branch, or state update before I narrow you further.",
        reason: "The candidate-state confidence is low, so the interviewer should avoid a strong probe and give the candidate a little more room before judging.",
        confidence: 0.72,
        targetCodeLine: "the next concrete example, branch, or state update that will make the candidate state easier to classify",
        specificIssue: "Current candidate-state confidence is low, so the next move should preserve information rather than over-commit to one diagnosis.",
        expectedAnswer: "One more concrete explanation, branch walk-through, or state update that improves classifier confidence.",
        suggestedStage: currentStage,
        policyAction: policy.recommendedAction,
      });
    }

    return attachIntentTrajectory({
      action: "ask_for_clarification",
      target: currentStage === "PROBLEM_UNDERSTANDING" ? "understanding" : "reasoning",
      question:
        currentStage === "PROBLEM_UNDERSTANDING"
          ? "Let me make sure I understand your framing. What assumptions are you making about the input, and can you show one tiny example?"
          : "I want to make sure I am reading your state correctly. Can you restate the next step on one tiny example and say what exact state or output you expect?",
      reason: "The candidate-state confidence is low, so the interviewer should ask a clarifying question rather than making a strong evaluative probe.",
      confidence: 0.78,
      targetCodeLine:
        currentStage === "PROBLEM_UNDERSTANDING"
          ? "the candidate's assumptions and one tiny example"
          : "the next step, expected state, or expected output on one tiny example",
      specificIssue: "Current candidate-state confidence is low, so the interviewer needs clarification before making a sharper judgment.",
      expectedAnswer:
        currentStage === "PROBLEM_UNDERSTANDING"
          ? "A clearer statement of assumptions and one example."
          : "A tiny example, the exact next step, and the expected state or output.",
      suggestedStage: currentStage,
      policyAction: policy.recommendedAction,
    });
  }

  if (policy.shouldServeHint) {
    const hintStrategy = resolveHintStrategy({
      currentStage,
      signals,
      recentFailedRuns: repeatedFailures,
      hintStyle: policy.hintStyle,
      hintLevel: policy.hintLevel,
      recentEvents: input.recentEvents,
    });
    return attachIntentTrajectory({
      action: "give_hint",
      target: mapHintTarget(policy.hintStyle),
      question: buildHintDecisionQuestion(policy.hintStyle, policy.hintLevel),
      reason: `Policy requested a ${hintStrategy.tier.toLowerCase().replaceAll("_", " ")} / ${hintStrategy.granularity} hint because ${policy.escalationReason ?? "the candidate needs guidance"} and the current turn is in ${hintStrategy.rescueMode.replaceAll("_", " ")}.`,
      confidence: 0.86,
      targetCodeLine: "the single next state update or branch to focus on",
      specificIssue: "The candidate needs a bounded hint instead of another broad prompt.",
      expectedAnswer: "A smaller next step or local insight the candidate can act on without receiving the full solution.",
      suggestedStage: policy.nextStage,
      hintStyle: policy.hintStyle,
      hintLevel: policy.hintLevel,
      rescueMode: hintStrategy.rescueMode,
      hintGranularity: hintStrategy.granularity,
      hintTier: hintStrategy.tier,
      hintCost: hintStrategy.hintCost,
      hintInitiator: hintStrategy.hintInitiator,
      hintRequestTiming: hintStrategy.hintRequestTiming,
      momentumAtHint: hintStrategy.momentumAtHint,
      policyAction: policy.recommendedAction,
    });
  }

  if (signals.progress === "stuck" && repeatedFailures >= 2) {
    const failureSignal = classifyFailureSignal(latestExecutionRun, signals);
    return attachIntentTrajectory({
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
    });
  }

  if (latestExecutionRun?.status === "FAILED" || latestExecutionRun?.status === "ERROR" || latestExecutionRun?.status === "TIMEOUT") {
    const failureSignal = classifyFailureSignal(latestExecutionRun, signals);
    return attachIntentTrajectory({
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
    });
  }

  if (!latestExecutionRun && enoughPreCodeEvidence) {
    return attachIntentTrajectory({
      action: "encourage_and_continue",
      target: "implementation",
      question:
        "You've already specified the algorithm, complexity, and the main validation cases clearly enough. Go ahead and implement it now, and we can revisit correctness details after the code is written.",
      reason:
        "The candidate has already provided enough pre-code evidence, so the interviewer should stop front-loading more probing and move into implementation.",
      confidence: 0.9,
      targetCodeLine: "the main loop, lookup/update order, and return path in the implementation",
      specificIssue: "Pre-code evidence is already sufficient; implementation should start now.",
      expectedAnswer: "Implementation progress plus brief narration of the main loop or state update.",
      suggestedStage: "IMPLEMENTATION",
      policyAction: "LET_IMPLEMENT",
    });
  }

  if (latestExecutionRun?.status === "PASSED" && currentStage !== "WRAP_UP") {
    if (passAssessment.testing.complete && passAssessment.complexity.complete) {
      return attachIntentTrajectory({
        action: "move_to_wrap_up",
        target: "summary",
        question:
          "Good. The implementation, validation, and performance story are all covered well enough. Give me one concise final wrap-up and then we will close this question.",
        reason:
          "The testing and complexity pass conditions are already satisfied, so the highest-value next move is to wrap up cleanly.",
        confidence: 0.91,
        targetCodeLine: "the final wrapped solution story",
        specificIssue: "The main post-code evaluation gates are already satisfied.",
        expectedAnswer: "A concise final summary of the solution and one production-minded check.",
        suggestedStage: "WRAP_UP",
        policyAction: "WRAP_UP",
      });
    }

    if (
      !targetAlreadyAnswered("testing", "edge_case") &&
      (signals.edgeCaseAwareness === "missing" || signals.edgeCaseAwareness === "partial")
    ) {
      const testPrompt =
        signals.edgeCaseAwareness === "missing"
          ? "Your latest run passed. Before you call it done, what empty-input, single-element, or duplicate-heavy cases would you test next?"
          : "Your latest run passed. Which boundary condition would you test next, and what exact output should it produce?";
      return attachIntentTrajectory({
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
      });
    }

    if (!targetAlreadyAnswered("complexity", "tradeoff")) {
      return attachIntentTrajectory({
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
      });
    }

    return attachIntentTrajectory({
      action: "move_to_wrap_up",
      target: "summary",
      question: "Good. You have already covered the implementation, validation, and performance story well enough. Give me one concise final wrap-up of the approach and one thing you would double-check in production, then we will close this question.",
      reason: "The candidate already answered the complexity and tradeoff target, so the interviewer should not immediately repeat it after a passing run.",
      confidence: 0.88,
      targetCodeLine: "the final solution summary and one production-risk check",
      specificIssue: "The core performance target has already been answered, so the next move should advance the interview rather than repeat the same target.",
      expectedAnswer: "A short final summary of the approach and one realistic production-risk check or improvement.",
      suggestedStage: "WRAP_UP",
      policyAction: "WRAP_UP",
    });
  }

  if (currentStage === "PROBLEM_UNDERSTANDING") {
    if (shouldPreferImplementation && signals.behavior !== "overthinking" && signals.confidence >= 0.5) {
      return attachIntentTrajectory({
        action: "encourage_and_continue",
        target: "implementation",
        question:
          "That direction is concrete enough to move on. Go ahead and start implementing it, and as you code, briefly call out the one branch, state update, or invariant that matters most.",
        reason:
          "The candidate already has a workable direction and enough framing signal, so the interviewer should let implementation begin rather than over-probing the setup.",
        confidence: 0.83,
        targetCodeLine: "the first key loop, branch, or state update in the implementation",
        specificIssue: "The candidate is already on a workable path, so early momentum matters more than more framing questions.",
        expectedAnswer: "Implementation progress with short narration of the key branch, state update, or invariant.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      });
    }

    if (signals.understanding !== "clear") {
      return attachIntentTrajectory({
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
      });
    }

    return attachIntentTrajectory({
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
    });
  }

  if (currentStage === "APPROACH_DISCUSSION") {
    if (
      shouldPreferImplementation &&
      signals.behavior === "structured" &&
      !unstableTrend &&
      signals.confidence >= 0.5
    ) {
      return attachIntentTrajectory({
        action: "encourage_and_continue",
        target: "implementation",
        question:
          "That sounds like a workable plan. Start implementing it, and as you code, briefly narrate the one invariant, branch, or state update that is easiest to get wrong.",
        reason:
          "The candidate already has a viable approach, so the interviewer should let them start coding and revisit deeper correctness or tradeoff details after implementation evidence exists.",
        confidence: 0.84,
        targetCodeLine: "the first implementation step plus the one branch, invariant, or state update worth tracking",
        specificIssue: "The interview has enough approach signal to prioritize implementation momentum over more front-loaded probing.",
        expectedAnswer: "Implementation progress with one short note on the most failure-prone branch, state update, or invariant.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      });
    }

    if (shouldPreferImplementation && proofStyleAlreadyPressedTooMuch) {
      return {
        action: "encourage_and_continue",
        target: "implementation",
        question:
          "You've explained enough of the idea to start coding. Go ahead and implement it now, and we can come back to correctness details after the code is on the page.",
        reason:
          "The candidate is ready to implement and the interviewer has already spent a proof-style turn, so the next move should be implementation rather than another correctness probe.",
        confidence: 0.87,
        targetCodeLine: "the main loop, lookup/update order, and return path in the implementation",
        specificIssue: "Implementation should start now; deeper correctness discussion can wait until after code exists.",
        expectedAnswer: "Implementation progress with brief narration of the main loop or state update.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

    if (persistentWeakness === "reasoning" && !ledger.shouldAvoidTarget("reasoning", "correctness")) {
      return {
        action: "ask_for_reasoning",
        target: "reasoning",
        question:
          "Let's make the logic sharper. Give me the proof sketch or invariant that makes this approach correct, not just the intuition.",
        reason: "Recent candidate-state snapshots show that reasoning depth has stayed weak across multiple turns, so the interviewer should force a direct correctness explanation.",
        confidence: 0.93,
        targetCodeLine: "the proof sketch, invariant, or state relationship that justifies the approach",
        specificIssue: "Reasoning depth has remained weak across multiple recent turns.",
        expectedAnswer: "A short proof sketch, invariant, or state argument that explains why the approach stays correct.",
        suggestedStage: "APPROACH_DISCUSSION",
        policyAction: "PROBE_APPROACH",
      };
    }

    if (invariantEvidence && !ledger.shouldAvoidTarget("correctness")) {
      return attachIntentTrajectory({
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
      });
    }

    if (tradeoffEvidence && signals.algorithmChoice !== "strong" && !ledger.shouldAvoidTarget("tradeoff", "complexity")) {
      return attachIntentTrajectory({
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
      });
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

    if (
      signals.reasoningDepth === "thin" &&
      signals.communication !== "unclear" &&
      !ledger.shouldAvoidTarget("reasoning", "correctness")
    ) {
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
    if (
      persistentWeakness === "reasoning" &&
      signals.codeQuality !== "buggy" &&
      !ledger.shouldAvoidTarget("reasoning", "correctness")
    ) {
      return {
        action: "probe_correctness",
        target: "correctness",
        question:
          "You are making progress, but the correctness story is still thin. What invariant stays true after each update, and why does that keep the implementation safe?",
        reason: "Recent candidate-state snapshots show that correctness reasoning has remained weak even while implementation progressed.",
        confidence: 0.9,
        targetCodeLine: "the invariant or state relationship that the current implementation relies on",
        specificIssue: "Correctness reasoning has stayed weak across multiple implementation turns.",
        expectedAnswer: "The invariant, where the implementation maintains it, and why that invariant is enough to trust the code.",
        suggestedStage: "IMPLEMENTATION",
        policyAction: "LET_IMPLEMENT",
      };
    }

    if (
      invariantEvidence &&
      signals.codeQuality !== "buggy" &&
      !ledger.shouldAvoidTarget("correctness")
    ) {
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

    if (
      signals.progress === "progressing" &&
      signals.behavior === "structured" &&
      candidateHasFloor &&
      persistentWeakness === null &&
      ledger.unresolvedIssues.length === 0
    ) {
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
      return attachIntentTrajectory({
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
      });
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
    if (
      persistentWeakness === "testing" &&
      !targetAlreadyAnswered("testing", "edge_case") &&
      !ledger.shouldAvoidTarget("testing", "edge_case")
    ) {
      return attachIntentTrajectory({
        action: "ask_for_test_case",
        target: "testing",
        question:
          "Your validation has stayed a bit thin across the last few turns. Give me the exact high-risk test cases you would run next, and the exact expected output for each.",
        reason: "Recent candidate-state snapshots show that testing discipline has remained weak, so the interviewer should stay focused on explicit validation evidence.",
        confidence: 0.92,
        targetCodeLine: "the exact high-risk tests and expected outputs needed to validate the current implementation",
        specificIssue: "Testing discipline has remained weak across multiple recent turns.",
        expectedAnswer: "Two or three concrete test cases, why they matter, and the exact expected output for each.",
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      });
    }

    if (
      persistentWeakness === "complexity" &&
      !targetAlreadyAnswered("complexity", "tradeoff") &&
      !ledger.shouldAvoidTarget("complexity", "tradeoff")
    ) {
      return {
        action: "probe_tradeoff",
        target: "tradeoff",
        question:
          "You've mentioned complexity more than once, but I still need the real tradeoff story. What are you paying in runtime, memory, or simplicity, and why is that tradeoff justified for these constraints?",
        reason: "Recent candidate-state snapshots show that complexity rigor has remained weak, so the interviewer should force a constraint-aware tradeoff explanation.",
        confidence: 0.91,
        targetCodeLine: "the concrete tradeoff between the chosen solution and a realistic alternative under the given constraints",
        specificIssue: "Complexity reasoning has remained shallow across multiple recent turns.",
        expectedAnswer: "A constraint-aware tradeoff explanation comparing the chosen approach with one realistic alternative.",
        suggestedStage: "TESTING_AND_COMPLEXITY",
        policyAction: "VALIDATE_AND_TEST",
      };
    }

    if (
      boundaryEvidence &&
      signals.testingDiscipline !== "strong" &&
      !targetAlreadyAnswered("testing", "edge_case") &&
      !ledger.shouldAvoidTarget("testing", "edge_case")
    ) {
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

    if (
      tradeoffEvidence &&
      !targetAlreadyAnswered("complexity", "tradeoff") &&
      !ledger.shouldAvoidTarget("complexity", "tradeoff")
    ) {
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

    if (
      unstableTrend &&
      signals.testingDiscipline !== "strong" &&
      !targetAlreadyAnswered("testing", "edge_case")
    ) {
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

    if (
      !targetAlreadyAnswered("testing", "edge_case") &&
      (signals.testingDiscipline === "missing" || signals.edgeCaseAwareness === "missing")
    ) {
      return attachIntentTrajectory({
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
      });
    }

    if (!targetAlreadyAnswered("complexity", "tradeoff") && signals.complexityRigor !== "strong") {
      return attachIntentTrajectory({
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
      });
    }

    if (!targetAlreadyAnswered("complexity", "tradeoff")) {
      return attachIntentTrajectory({
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
      });
    }

    if (
      hasCollectedEvidence("complexity_tradeoff", "test_cases") &&
      !ledger.missingEvidence.includes("correctness_proof")
    ) {
      return attachIntentTrajectory({
        action: "move_to_wrap_up",
        target: "summary",
        question: "Good. You have covered the tests and performance story. Give me one concise final summary of the solution and one implementation detail you would still watch carefully, then we will close this question.",
        reason: "The candidate has already answered the active testing and complexity targets, so the interviewer should stop repeating them and move toward wrap-up.",
        confidence: 0.87,
        targetCodeLine: "the final solution summary and one implementation detail worth watching",
        specificIssue: "Testing and performance evidence have already been collected for this stage.",
        expectedAnswer: "A concise final summary plus one implementation detail or risk to watch.",
        suggestedStage: "WRAP_UP",
        policyAction: "WRAP_UP",
      });
    }
  }

  if (
    currentStage === "WRAP_UP" &&
    (passAssessment.wrapUp.complete ||
      (targetAlreadyAnswered("summary") &&
        (signals.progress === "done" || hasCollectedEvidence("implementation_plan", "test_cases", "complexity_tradeoff"))))
  ) {
    return attachIntentTrajectory({
      action: "end_interview",
      target: "summary",
      question: "That covers this question well. We are done here.",
      reason: "The candidate has already provided the final summary and the core evidence is saturated, so the interviewer should explicitly close instead of asking for more.",
      confidence: 0.93,
      targetCodeLine: "the final wrapped solution story that is already on record",
      specificIssue: "The active topic is already covered well enough and additional prompting would only create repetition.",
      expectedAnswer: "No further answer is required beyond a brief acknowledgment.",
      suggestedStage: "WRAP_UP",
      policyAction: "WRAP_UP",
    });
  }

  if (currentStage === "WRAP_UP") {
    if (
      ledger.missingEvidence.includes("correctness_proof") &&
      !ledger.shouldAvoidTarget("reasoning", "correctness")
    ) {
      return attachIntentTrajectory({
        action: "probe_correctness",
        target: "correctness",
        question:
          "Before we close, give me the shortest proof sketch or invariant that makes you confident this solution is actually correct.",
        reason: "The session is near wrap-up, but the memory ledger still shows missing correctness evidence.",
        confidence: 0.88,
        targetCodeLine: "the invariant, proof sketch, or correctness argument that justifies the final solution",
        specificIssue: "The interview still lacks a concise correctness proof before wrap-up.",
        expectedAnswer: "A short proof sketch, invariant, or state argument that explains why the final solution is correct.",
        suggestedStage: "WRAP_UP",
        policyAction: "WRAP_UP",
      });
    }

    if (
      ledger.missingEvidence.includes("exact_test_outputs") &&
      !ledger.shouldAvoidTarget("testing", "edge_case")
    ) {
      return attachIntentTrajectory({
        action: "ask_for_test_case",
        target: "testing",
        question:
          "One last validation check: give me the highest-risk test case and the exact output you expect from the current implementation.",
        reason: "The session is near wrap-up, but the memory ledger still shows missing exact test-output evidence.",
        confidence: 0.86,
        targetCodeLine: "the highest-risk test case and its exact expected output",
        specificIssue: "The interview still lacks one explicit expected-output validation before wrap-up.",
        expectedAnswer: "One high-risk test case, why it matters, and the precise expected output.",
        suggestedStage: "WRAP_UP",
        policyAction: "WRAP_UP",
      });
    }

    if (
      ledger.missingEvidence.includes("constraint_tradeoff") &&
      !ledger.shouldAvoidTarget("complexity", "tradeoff")
    ) {
      return attachIntentTrajectory({
        action: "probe_tradeoff",
        target: "tradeoff",
        question:
          "Before we finish, justify the final tradeoff against the actual constraints. Why is this runtime, memory, or simplicity tradeoff the right one here?",
        reason: "The session is near wrap-up, but the memory ledger still shows missing constraint-aware tradeoff evidence.",
        confidence: 0.87,
        targetCodeLine: "the final tradeoff story under the actual constraints",
        specificIssue: "The interview still lacks a constraint-aware tradeoff justification before wrap-up.",
        expectedAnswer: "A concise explanation of the accepted runtime, memory, or simplicity tradeoff and why it fits the constraints.",
        suggestedStage: "WRAP_UP",
        policyAction: "WRAP_UP",
      });
    }
  }

  if (repeatedHints >= 2 && signals.progress !== "done") {
    return attachIntentTrajectory({
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
    });
  }

  return attachIntentTrajectory({
    action: "move_to_wrap_up",
    target: "summary",
    question: "Wrap this up for me once: what is the final approach, what are the main tradeoffs, and what would you improve if you had more time?",
    reason: "The interview is in wrap-up, so the interviewer should collect one final summary and then close rather than keep the topic open.",
    confidence: 0.78,
    targetCodeLine: "the final summary of approach, tradeoffs, and next improvement",
    specificIssue: "The interview is ending and needs a concise final summary.",
    expectedAnswer: "The final approach, main tradeoffs, and one improvement to try next.",
    suggestedStage: "WRAP_UP",
    policyAction: "WRAP_UP",
  });
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

function detectRecentImplementationReadiness(
  recentEvents: Array<{ eventType: string; payloadJson?: unknown }>,
) {
  return recentEvents
    .filter((event) => event.eventType === "SIGNAL_SNAPSHOT_RECORDED")
    .slice(-3)
    .some((event) => {
      const payload =
        typeof event.payloadJson === "object" && event.payloadJson !== null
          ? (event.payloadJson as Record<string, unknown>)
          : {};
      const signals =
        typeof payload.signals === "object" && payload.signals !== null
          ? (payload.signals as Record<string, unknown>)
          : {};

      return (
        signals.readyToCode === true ||
        (signals.understanding === "clear" &&
          (signals.algorithmChoice === "reasonable" || signals.algorithmChoice === "strong") &&
          signals.progress === "progressing")
      );
    });
}





