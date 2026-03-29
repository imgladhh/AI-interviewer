import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

type SessionEventLike = {
  eventType: string;
  payloadJson?: unknown;
};

type ExecutionRunLike = {
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout?: string | null;
  stderr?: string | null;
};

type PersistentWeakness = "reasoning" | "testing" | "complexity" | null;

export type MemoryLedger = {
  recentlyProbedTargets: string[];
  recentlyProbedIssues: string[];
  answeredTargets: string[];
  unresolvedIssues: string[];
  resolvedIssues: string[];
  collectedEvidence: string[];
  missingEvidence: string[];
  recentProofStyleProbeCount: number;
  repeatedFailurePattern?: "timeout" | "index" | "null" | "wrong_answer" | "generic";
  persistentWeakness: PersistentWeakness;
  recentHints: number;
  recentFailedRuns: number;
  shouldAvoidTarget: (...targets: string[]) => boolean;
  summary: string[];
};

export function buildMemoryLedger(input: {
  currentStage: CodingInterviewStage;
  recentEvents?: SessionEventLike[];
  signals: CandidateSignalSnapshot;
  latestExecutionRun?: ExecutionRunLike | null;
}): MemoryLedger {
  const recentEvents = input.recentEvents ?? [];
  const recentDecisions = recentEvents
    .filter((event) => event.eventType === "DECISION_RECORDED")
    .slice(-5)
    .map(readDecisionPayload)
    .filter((decision) => decision.target || decision.specificIssue);
  const priorSignals = recentEvents
    .filter((event) => event.eventType === "SIGNAL_SNAPSHOT_RECORDED")
    .slice(-4)
    .map(readSignalPayload)
    .filter((snapshot): snapshot is Partial<CandidateSignalSnapshot> => snapshot !== null);
  const recentStructuredIssues = priorSignals.flatMap((snapshot) =>
    Array.isArray(snapshot.structuredEvidence) ? snapshot.structuredEvidence : [],
  );

  const currentIssueKeys = input.signals.structuredEvidence.map((item) => normalizeIssueKey(item.issue));
  const recentlyProbedTargets = recentDecisions.map((decision) => decision.target).filter(Boolean);
  const recentlyProbedIssues = recentDecisions
    .map((decision) => normalizeIssueKey(decision.specificIssue))
    .filter(Boolean);
  const recentProofStyleProbeCount = recentDecisions.filter((decision) => {
    const issue = normalizeIssueKey(decision.specificIssue);
    return (
      decision.action === "ask_for_reasoning" ||
      decision.action === "probe_correctness" ||
      decision.target === "reasoning" ||
      decision.target === "correctness" ||
      issue.includes("proof sketch") ||
      issue.includes("invariant")
    );
  }).length;

  const unresolvedIssues = dedupeStrings(
    currentIssueKeys.filter((issueKey) => issueKey && !recentlyProbedIssues.includes(issueKey)),
  );
  const resolvedIssues = dedupeStrings(
    recentStructuredIssues
      .map((item) => normalizeIssueKey(item?.issue))
      .filter((issueKey) => issueKey && !currentIssueKeys.includes(issueKey)),
  );

  const collectedEvidence = inferCollectedEvidence(input.signals, input.currentStage);
  const answeredTargets = inferAnsweredTargets({
    recentDecisions,
    collectedEvidence,
    signals: input.signals,
    latestExecutionRun: input.latestExecutionRun,
  });
  const missingEvidence = inferMissingEvidence(input.signals, input.currentStage);
  const repeatedFailurePattern = classifyRepeatedFailurePattern(recentEvents, input.latestExecutionRun);
  const persistentWeakness = resolvePersistentWeakness(priorSignals, input.signals);
  const recentHints = recentEvents.filter(
    (event) => event.eventType === "HINT_REQUESTED" || event.eventType === "HINT_SERVED",
  ).length;
  const recentFailedRuns = recentEvents.filter((event) => {
    if (event.eventType !== "CODE_RUN_COMPLETED") {
      return false;
    }

    const payload =
      typeof event.payloadJson === "object" && event.payloadJson !== null
        ? (event.payloadJson as Record<string, unknown>)
        : {};
    return payload.status === "FAILED" || payload.status === "ERROR" || payload.status === "TIMEOUT";
  }).length;

  const summary = buildLedgerSummary({
    answeredTargets,
    collectedEvidence,
    unresolvedIssues,
    resolvedIssues,
    missingEvidence,
    repeatedFailurePattern,
    persistentWeakness,
  });

  return {
    recentlyProbedTargets,
    recentlyProbedIssues,
    answeredTargets,
    unresolvedIssues,
    resolvedIssues,
    collectedEvidence,
    missingEvidence,
    recentProofStyleProbeCount,
    repeatedFailurePattern,
    persistentWeakness,
    recentHints,
    recentFailedRuns,
    shouldAvoidTarget: (...targets: string[]) => {
      const hits = recentDecisions.filter((decision) => {
        const normalizedIssue = normalizeIssueKey(decision.specificIssue);
        return (
          targets.includes(decision.target) ||
          targets.some((target) => normalizedIssue.includes(target.toLowerCase()))
        );
      });
      return hits.length >= 2;
    },
    summary,
  };
}

function readDecisionPayload(event: SessionEventLike) {
  const payload =
    typeof event.payloadJson === "object" && event.payloadJson !== null
      ? (event.payloadJson as Record<string, unknown>)
      : {};
  const decision =
    typeof payload.decision === "object" && payload.decision !== null
      ? (payload.decision as Record<string, unknown>)
      : {};

  return {
    target: typeof decision.target === "string" ? decision.target : "",
    action: typeof decision.action === "string" ? decision.action : "",
    specificIssue: typeof decision.specificIssue === "string" ? decision.specificIssue : "",
  };
}

function readSignalPayload(event: SessionEventLike) {
  const payload =
    typeof event.payloadJson === "object" && event.payloadJson !== null
      ? (event.payloadJson as Record<string, unknown>)
      : {};
  return typeof payload.signals === "object" && payload.signals !== null
    ? (payload.signals as Partial<CandidateSignalSnapshot>)
    : null;
}

function inferMissingEvidence(
  signals: CandidateSignalSnapshot,
  currentStage: CodingInterviewStage,
) {
  const evidence: string[] = [];

  if (signals.reasoningDepth === "thin") {
    evidence.push("correctness_proof");
  }
  if (signals.testingDiscipline !== "strong") {
    evidence.push("exact_test_outputs");
  }
  if (signals.edgeCaseAwareness !== "present") {
    evidence.push("boundary_coverage");
  }
  if (signals.complexityRigor !== "strong") {
    evidence.push("constraint_tradeoff");
  }
  if (currentStage === "WRAP_UP" && signals.progress !== "done") {
    evidence.push("completion_signal");
  }

  for (const item of signals.structuredEvidence) {
    const issue = item.issue.toLowerCase();
    if (issue.includes("proof sketch") || issue.includes("invariant")) {
      evidence.push("correctness_proof");
    }
    if (issue.includes("expected output")) {
      evidence.push("exact_test_outputs");
    }
    if (issue.includes("boundary coverage")) {
      evidence.push("boundary_coverage");
    }
    if (issue.includes("tradeoff") && issue.includes("constraints")) {
      evidence.push("constraint_tradeoff");
    }
  }

  return dedupeStrings(evidence);
}

function inferCollectedEvidence(
  signals: CandidateSignalSnapshot,
  currentStage: CodingInterviewStage,
) {
  const evidence: string[] = [];

  if (signals.readyToCode || currentStage === "IMPLEMENTATION") {
    evidence.push("implementation_plan");
  }
  if (signals.reasoningDepth !== "thin") {
    evidence.push("correctness_proof");
  }
  if (signals.edgeCaseAwareness !== "missing") {
    evidence.push("boundary_coverage");
    evidence.push("test_cases");
  }
  if (signals.testingDiscipline === "strong") {
    evidence.push("exact_test_outputs");
  }
  if (signals.complexityRigor !== "missing") {
    evidence.push("complexity_tradeoff");
  }

  for (const item of signals.structuredEvidence) {
    const issue = item.issue.toLowerCase();
    if (issue.includes("proof sketch") || issue.includes("invariant")) {
      continue;
    }
    if (issue.includes("expected output")) {
      continue;
    }
    if (issue.includes("boundary coverage")) {
      continue;
    }
    if (issue.includes("tradeoff") && issue.includes("constraints")) {
      continue;
    }

    if (item.area === "correctness") {
      evidence.push("correctness_proof");
    }
    if (item.area === "testing" || item.area === "edge_case") {
      evidence.push("test_cases");
    }
    if (item.area === "complexity") {
      evidence.push("complexity_tradeoff");
    }
  }

  return dedupeStrings(evidence);
}

function inferAnsweredTargets(input: {
  recentDecisions: Array<{ target: string; action: string; specificIssue: string }>;
  collectedEvidence: string[];
  signals: CandidateSignalSnapshot;
  latestExecutionRun?: ExecutionRunLike | null;
}) {
  const answered = new Set<string>();
  const hasEvidence = (name: string) => input.collectedEvidence.includes(name);

  for (const decision of input.recentDecisions) {
    const target = decision.target;

    if ((target === "reasoning" || target === "correctness") && hasEvidence("correctness_proof")) {
      answered.add("reasoning");
      answered.add("correctness");
    }

    if ((target === "testing" || target === "edge_case") && hasEvidence("test_cases")) {
      answered.add("testing");
      answered.add("edge_case");
      if (hasEvidence("exact_test_outputs")) {
        answered.add("testing_precision");
      }
    }

    if ((target === "complexity" || target === "tradeoff") && hasEvidence("complexity_tradeoff")) {
      answered.add("complexity");
      answered.add("tradeoff");
    }

    if ((target === "implementation" || target === "approach") && hasEvidence("implementation_plan")) {
      answered.add("implementation");
      answered.add("approach");
    }
  }

  if (input.latestExecutionRun?.status === "PASSED") {
    answered.add("implementation");
  }

  if (input.signals.progress === "done") {
    answered.add("summary");
  }

  return [...answered];
}

function classifyRepeatedFailurePattern(
  recentEvents: SessionEventLike[],
  latestExecutionRun?: ExecutionRunLike | null,
) {
  const statuses = recentEvents
    .filter((event) => event.eventType === "CODE_RUN_COMPLETED")
    .slice(-3)
    .map((event) => {
      const payload =
        typeof event.payloadJson === "object" && event.payloadJson !== null
          ? (event.payloadJson as Record<string, unknown>)
          : {};
      return {
        status: typeof payload.status === "string" ? payload.status : "",
        stderr: typeof payload.stderr === "string" ? payload.stderr.toLowerCase() : "",
        stdout: typeof payload.stdout === "string" ? payload.stdout.toLowerCase() : "",
      };
    });

  const lastErrorText = `${latestExecutionRun?.stderr ?? ""} ${latestExecutionRun?.stdout ?? ""}`.toLowerCase();
  const corpus = [...statuses.map((item) => `${item.status} ${item.stderr} ${item.stdout}`), lastErrorText].join(" ");

  if (/timeout|timed out/.test(corpus)) {
    return "timeout" as const;
  }
  if (/indexerror|out of range|out of bounds/.test(corpus)) {
    return "index" as const;
  }
  if (/null|none|undefined|attributeerror|typeerror/.test(corpus)) {
    return "null" as const;
  }
  if (/wrong answer|expected|mismatch|assert/.test(corpus)) {
    return "wrong_answer" as const;
  }
  if (statuses.some((item) => item.status === "FAILED" || item.status === "ERROR" || item.status === "TIMEOUT")) {
    return "generic" as const;
  }

  return undefined;
}

function resolvePersistentWeakness(
  priorSignals: Array<Partial<CandidateSignalSnapshot>>,
  signals: CandidateSignalSnapshot,
): PersistentWeakness {
  const reasoningSnapshots = [...priorSignals.map((item) => item.reasoningDepth), signals.reasoningDepth];
  if (reasoningSnapshots.filter((item) => item === "thin").length >= 2) {
    return "reasoning";
  }

  const testingSnapshots = [...priorSignals.map((item) => item.testingDiscipline), signals.testingDiscipline];
  if (testingSnapshots.filter((item) => item === "missing" || item === "partial").length >= 3) {
    return "testing";
  }

  const complexitySnapshots = [...priorSignals.map((item) => item.complexityRigor), signals.complexityRigor];
  if (complexitySnapshots.filter((item) => item === "missing" || item === "partial").length >= 3) {
    return "complexity";
  }

  return null;
}

function buildLedgerSummary(input: {
  answeredTargets: string[];
  collectedEvidence: string[];
  unresolvedIssues: string[];
  resolvedIssues: string[];
  missingEvidence: string[];
  repeatedFailurePattern?: string;
  persistentWeakness: PersistentWeakness;
}) {
  const summary: string[] = [];

  if (input.answeredTargets.length > 0) {
    summary.push(`Answered targets: ${input.answeredTargets.slice(0, 4).join(", ")}`);
  }
  if (input.collectedEvidence.length > 0) {
    summary.push(`Collected evidence: ${input.collectedEvidence.slice(0, 4).join(", ")}`);
  }
  if (input.unresolvedIssues.length > 0) {
    summary.push(`Unresolved issues: ${input.unresolvedIssues.slice(0, 3).join("; ")}`);
  }
  if (input.resolvedIssues.length > 0) {
    summary.push(`Recently resolved: ${input.resolvedIssues.slice(0, 2).join("; ")}`);
  }
  if (input.missingEvidence.length > 0) {
    summary.push(`Missing evidence: ${input.missingEvidence.slice(0, 3).join(", ")}`);
  }
  if (input.repeatedFailurePattern) {
    summary.push(`Repeated failure pattern: ${input.repeatedFailurePattern}`);
  }
  if (input.persistentWeakness) {
    summary.push(`Persistent weakness: ${input.persistentWeakness}`);
  }

  return summary;
}

function normalizeIssueKey(issue?: string) {
  return (issue ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeStrings(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}
