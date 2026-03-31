import type { CandidateDecision } from "@/lib/assistant/decision_engine";
import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

export function describeReplyStrategy(
  decision: CandidateDecision,
  signals: CandidateSignalSnapshot,
) {
  const trend = signals.trendSummary ?? "No clear trend yet.";
  const issueStyle = describeIssueStyle(decision.specificIssue);
  const pressure = decision.pressure ?? "neutral";

  switch (decision.action) {
    case "ask_for_clarification":
      return `Clarify before you judge. Pressure=${pressure}. Ask the candidate to restate one tiny example, assumption, or expected state so the interviewer can reduce uncertainty. Trend context: ${trend}`;
    case "hold_and_listen":
      return `Be brief and non-intrusive. Pressure=${pressure}. Give the candidate room to continue, while lightly naming the one invariant, branch, or state update worth narrating. Trend context: ${trend}`;
    case "ask_for_reasoning":
      return `Probe the candidate's reasoning, not just the surface approach. Pressure=${pressure}. ${issueStyle} Ask for one concrete example, invariant, or correctness argument. Trend context: ${trend}`;
    case "probe_tradeoff":
      return `Press on tradeoffs and algorithm choice. Pressure=${pressure}. ${issueStyle} Compare the current approach against a stronger alternative and ask what efficiency or simplicity tradeoff the candidate is making. Trend context: ${trend}`;
    case "probe_correctness":
      return `Probe correctness tightly. Pressure=${pressure}. ${issueStyle} Ask how the candidate knows the solution is correct on one example, branch, or invariant before moving on. Trend context: ${trend}`;
    case "ask_for_test_case":
      return `Ask explicitly for high-risk test cases or edge cases. Pressure=${pressure}. ${issueStyle} Do not drift back into a broad approach discussion. Trend context: ${trend}`;
    case "ask_for_complexity":
      return `Ask explicitly for final time complexity, space complexity, and tradeoffs. Pressure=${pressure}. ${issueStyle} Keep the follow-up precise and evaluative. Trend context: ${trend}`;
    case "ask_for_debug_plan":
      return `Localize the debugging discussion. Pressure=${pressure}. Force the candidate to identify one failing input, one branch, or one state transition to inspect next. Trend context: ${trend}`;
    case "give_hint":
      return `Provide only the level of hint requested by the decision engine. Pressure=${pressure}. Nudge the candidate without solving the problem outright. Trend context: ${trend}`;
    case "move_stage":
      return `Use a short transition to move the interview forward, then ask the required next question. Pressure=${pressure}. Trend context: ${trend}`;
    case "encourage_and_continue":
      return `Acknowledge briefly and let the candidate keep momentum. Pressure=${pressure}. Avoid over-talking; one concrete instruction is enough. Trend context: ${trend}`;
    case "ask_followup":
    default:
      return `Ask one focused follow-up that directly matches the decision target. Pressure=${pressure}. Avoid generic praise or broad prompts. Trend context: ${trend}`;
  }
}

export function buildFallbackReplyFromDecision(input: {
  decision: CandidateDecision;
  signals: CandidateSignalSnapshot;
  currentStage: CodingInterviewStage;
  previousAiTurn?: string;
}) {
  const { decision, signals, currentStage, previousAiTurn } = input;
  const pressure = decision.pressure ?? "neutral";
  const improving =
    signals.trendSummary &&
    /moved from (stuck|missing|partial) to (progressing|done|present|strong|moderate|deep)/i.test(
      signals.trendSummary,
    );
  const issueType = classifyIssueType(decision.specificIssue);
  const askLead = pressureLead(pressure, decision.action);

  switch (decision.action) {
    case "ask_for_clarification":
      return chooseVariation(
        `${askLead} Walk me through one tiny example and tell me the exact state or output you expect there.`,
        previousAiTurn,
        "Before I push further, restate the next step on one small example and tell me what you expect to happen.",
      );
    case "hold_and_listen":
      return chooseVariation(
        improving
          ? "This is getting sharper. Keep going, and just narrate the one invariant or branch you want me to track."
          : currentStage === "IMPLEMENTATION"
            ? "Keep coding. As you go, narrate the one branch or state update that is easiest to get wrong."
            : "Keep going. As you do, name the one invariant or state change that matters most.",
        previousAiTurn,
        "Continue from here, and keep me posted on the single state update or branch that matters most.",
      );
    case "ask_for_reasoning":
      return chooseVariation(
        improving
          ? `You are moving in a better direction now. ${decision.question}`
          : pressure === "surgical"
            ? `Be precise here. ${decision.question}`
            : decision.question,
        previousAiTurn,
        pressure === "soft"
          ? "Slow down and make the reasoning explicit on one concrete example. Why should this logic stay correct?"
          : "I want the exact reasoning step now. On one concrete example, why should this logic stay correct?",
      );
    case "probe_tradeoff":
      return chooseVariation(
        issueType === "constraint_justification"
          ? `${askLead} You have named the tradeoff already. Now justify it against the actual constraints for me. Why is that runtime or memory cost acceptable here?`
          : pressure === "surgical"
            ? `${askLead} Do not stop at Big-O. Compare this choice against one realistic alternative and justify the tradeoff.`
            : decision.question,
        previousAiTurn,
        issueType === "constraint_justification"
          ? "Do not stop at naming the tradeoff. Tell me why that tradeoff is worth it for this problem's constraints."
          : pressure === "challenging" || pressure === "surgical"
            ? "Be concrete on the tradeoff. What exactly do you gain with this approach, and what stronger alternative are you giving up?"
            : "Push on the tradeoff for me. What do you gain with this approach, and what stronger alternative are you giving up?",
      );
    case "probe_correctness":
      return chooseVariation(
        issueType === "proof_sketch"
          ? `${askLead} I hear the intuition. Now turn that into a proof sketch for me. Why is that argument actually sufficient to guarantee correctness?`
          : issueType === "invariant"
            ? `${askLead} Do not just describe the plan. State the invariant explicitly and tell me why it stays true after each step.`
            : pressure === "surgical"
              ? `${askLead} I need the exact invariant, branch, or state relationship that makes this correct.`
              : decision.question,
        previousAiTurn,
        issueType === "proof_sketch"
          ? "You have the right intuition, but I still need the proof sketch. What is the actual reason this logic must be correct?"
          : issueType === "invariant"
            ? "Before we move on, state the invariant cleanly and explain why each update preserves it."
            : "Before we move on, convince me the logic is correct on one concrete example or invariant.",
      );
    case "ask_for_test_case":
      return chooseVariation(
        issueType === "boundary_breadth"
          ? `${askLead} Make the boundary coverage concrete for me. Give me two exact boundary cases and the precise output you expect on each.`
          : issueType === "expected_output_precision"
            ? `${askLead} Do not just name the tests. Tell me the exact output each test case should produce.`
            : pressure === "surgical"
              ? `${askLead} Give me the highest-risk tests next, and for each one tell me the exact output you expect.`
              : decision.question,
        previousAiTurn,
        issueType === "boundary_breadth"
          ? "Your testing list is still too narrow. Which empty, minimal, or duplicate-heavy cases would you validate explicitly?"
          : issueType === "expected_output_precision"
            ? "Let's make validation explicit. For each test you named, what exact result should the code return?"
            : "Let's make validation explicit. Which edge cases would you test first, and what should happen on each one?",
      );
    case "ask_for_complexity":
      return chooseVariation(
        pressure === "surgical"
          ? `${askLead} Give me the final time complexity, space complexity, and the exact tradeoff you accepted.`
          : decision.question,
        previousAiTurn,
        pressure === "soft"
          ? "Now pin down the final time complexity, space complexity, and the main tradeoff behind this approach."
          : "Be precise now: final time complexity, final space complexity, and the tradeoff behind this approach.",
      );
    case "ask_for_debug_plan":
      return chooseVariation(
        pressure === "surgical"
          ? `${askLead} Localize the failure. Give me the exact failing input, the exact branch, and the next state you would inspect.`
          : decision.question,
        previousAiTurn,
        "Localize the bug for me. Pick one failing input, then name the first branch or state transition you would inspect.",
      );
    case "encourage_and_continue":
      return chooseVariation(
        improving ? `You are heading in a better direction now. ${decision.question}` : decision.question,
        previousAiTurn,
        "That direction is workable. Keep moving, and call out the one invariant or branch that matters most.",
      );
    case "move_stage":
    case "ask_followup":
      return chooseVariation(decision.question, previousAiTurn, decision.question);
    default:
      return null;
  }
}

function pressureLead(
  pressure: NonNullable<CandidateDecision["pressure"]>,
  action: CandidateDecision["action"],
) {
  switch (pressure) {
    case "soft":
      return action === "encourage_and_continue" ? "Good." : "Let's make this concrete.";
    case "challenging":
      return "Be specific.";
    case "surgical":
      return "Be precise.";
    case "neutral":
    default:
      return "Okay.";
  }
}

function chooseVariation(primary: string, previousAiTurn?: string, alternate?: string) {
  if (!previousAiTurn) {
    return primary;
  }

  const previous = previousAiTurn.trim().toLowerCase();
  if (previous === primary.trim().toLowerCase() && alternate) {
    return alternate;
  }

  return primary;
}

function classifyIssueType(issue?: string) {
  const normalized = issue?.toLowerCase() ?? "";

  if (!normalized) {
    return "generic";
  }
  if (normalized.includes("proof sketch") || normalized.includes("intuition")) {
    return "proof_sketch";
  }
  if (normalized.includes("invariant")) {
    return "invariant";
  }
  if (normalized.includes("boundary coverage")) {
    return "boundary_breadth";
  }
  if (normalized.includes("expected outputs") || normalized.includes("expected output")) {
    return "expected_output_precision";
  }
  if (normalized.includes("tradeoff") && normalized.includes("constraints")) {
    return "constraint_justification";
  }

  return "generic";
}

function describeIssueStyle(issue?: string) {
  switch (classifyIssueType(issue)) {
    case "proof_sketch":
      return "The candidate already gave some intuition, so push for a short proof sketch rather than repeating the same broad prompt.";
    case "invariant":
      return "Focus on forcing a crisp invariant and how each step preserves it.";
    case "boundary_breadth":
      return "Ask for exact boundary cases, not vague validation talk.";
    case "expected_output_precision":
      return "Require the candidate to name exact expected outputs, not just test categories.";
    case "constraint_justification":
      return "Do not stop at naming the tradeoff; make the candidate justify why it is acceptable under the actual constraints.";
    default:
      return "Keep the follow-up concrete and avoid generic praise.";
  }
}
