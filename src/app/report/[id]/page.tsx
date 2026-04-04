import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMemoryLedger } from "@/lib/assistant/memory_ledger";
import { summarizeSessionCritic, type SessionCriticSummary } from "@/lib/assistant/session_critic";
import { buildSessionSnapshotState } from "@/lib/session/state";
import {
  readCandidateStateSnapshots,
  readInterviewerDecisionSnapshots,
  readIntentSnapshots,
  readTrajectorySnapshots,
} from "@/lib/session/snapshots";
import { isCodingInterviewStage } from "@/lib/assistant/stages";
import { prisma } from "@/lib/db";

type ReportPageProps = {
  params: Promise<{ id: string }>;
};

type Dimension = {
  key: string;
  label: string;
  issue?: string;
  score: number;
  maxScore: number;
  evidence: string;
  impact?: string;
  improvement?: string[];
};

type CandidateState = {
  understanding?: string;
  progress?: string;
  communication?: string;
  codeQuality?: string;
  algorithmChoice?: string;
  edgeCaseAwareness?: string;
  behavior?: string;
  reasoningDepth?: string;
  testingDiscipline?: string;
  complexityRigor?: string;
  confidence?: number;
  evidence?: string[];
  structuredEvidence?: Array<{
    area?: string;
    issue?: string;
    behavior?: string;
    evidence?: string;
    impact?: string;
    fix?: string;
  }>;
  summary?: string;
  trendSummary?: string;
};

type LatestDecision = {
  action?: string;
  target?: string;
  pressure?: string;
  urgency?: string;
  interruptionCost?: string;
  batchGroup?: string;
  question?: string;
  reason?: string;
  confidence?: number;
  targetCodeLine?: string;
  specificIssue?: string;
  expectedAnswer?: string;
  suggestedStage?: string;
  hintStyle?: string;
  hintLevel?: string;
  policyAction?: string;
};

type StageReplayGroup = {
  stage: string;
  label: string;
  evidence?: string[];
  signalSnapshots?: CandidateState[];
  decisions?: LatestDecision[];
  turns?: Array<{ speaker: string; text: string }>;
};

type StageReplaySection = {
  key?: string;
  label?: string;
  stages?: string[];
  evidence?: string[];
  signalSnapshots?: CandidateState[];
  decisions?: LatestDecision[];
  turns?: Array<{ speaker: string; text: string }>;
};

type ReportJson = {
  generatedAt?: string;
  questionTitle?: string;
  targetLevel?: string | null;
  selectedLanguage?: string | null;
  currentStage?: string;
  stageJourney?: string[];
  codeRunSummary?: {
    totalRuns?: number;
    passedRuns?: number;
    failedRuns?: number;
  };
  hintSummary?: {
    requested?: number;
    served?: number;
    totalHintCost?: number;
    averageHintCost?: number;
    strongestHintLevel?: string | null;
    strongestHintTier?: string | null;
    byGranularity?: Record<string, number>;
    byRescueMode?: Record<string, number>;
    byInitiator?: Record<string, number>;
    byRequestTiming?: Record<string, number>;
    byMomentumAtHint?: Record<string, number>;
    penaltyApplied?: number;
    efficiencyScore?: number;
    coachability?: {
      score?: number;
      label?: string;
      rationale?: string;
    };
  };
  transcriptSummary?: {
    userTurns?: number;
    aiTurns?: number;
  };
  dimensions?: Dimension[];
  strengths?: string[];
  weaknesses?: string[];
  missedSignals?: string[];
  improvementPlan?: string[];
  overallScore?: number;
  recommendation?: string;
  overallSummary?: string;
  candidateState?: CandidateState | null;
  latestDecision?: LatestDecision | null;
  latestIntent?: Record<string, unknown> | null;
  latestTrajectory?: Record<string, unknown> | null;
  sessionCritic?: SessionCriticSummary | null;
  stageReplay?: StageReplayGroup[];
  intentTimeline?: Array<{ createdAt?: string; stage?: string | null; payload?: Record<string, unknown> }>;
  trajectoryTimeline?: Array<{ createdAt?: string; stage?: string | null; payload?: Record<string, unknown> }>;
  candidateDna?: {
    headline?: string;
    traits?: string[];
    strengths?: string[];
    watchouts?: string[];
    growthEdge?: string;
  };
  momentsOfTruth?: Array<{
    title?: string;
    detail?: string;
    evidence?: string[];
    importance?: string;
  }>;
  rubricSummary?: Array<{
    key?: string;
    dimension?: string;
    score?: number;
    maxScore?: number;
    verdict?: string;
    rationale?: string;
    basis?: string;
    evidence?: string[];
  }>;
  stageSections?: StageReplaySection[];
};

type ReplayItem = {
  id: string;
  time: string;
  sortTime: number;
  title: string;
  description: string;
  tone: "neutral" | "success" | "warning" | "info";
};

type CandidateStateTimelineItem = {
  id: string;
  kind: "stage" | "signal" | "decision" | "intent" | "trajectory" | "hint" | "code_run";
  time: string;
  sortTime: number;
  title: string;
  summary: string;
  timingVerdict?: string | null;
  urgency?: string | null;
  interruptionCost?: string | null;
  batchGroup?: string | null;
  answeredTargets?: string[];
  collectedEvidence?: string[];
  unresolvedIssues?: string[];
  missingEvidence?: string[];
  evidenceFocus?: string | null;
  intent?: string | null;
  intentTargetSignal?: string | null;
  expectedOutcome?: string | null;
  candidateTrajectory?: string | null;
  expectedWithNoIntervention?: string | null;
  interventionValue?: string | null;
  bestIntervention?: string | null;
  expectedEvidenceGain?: string | null;
  payload: Record<string, unknown>;
};

export default async function SessionReportPage({ params }: ReportPageProps) {
  const { id } = await params;

  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
      question: true,
      feedbackReport: true,
      evaluation: {
        include: {
          dimensionScores: true,
        },
      },
      transcripts: {
        orderBy: { segmentIndex: "asc" },
      },
      events: {
        orderBy: { eventTime: "asc" },
      },
      executionRuns: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    notFound();
  }

  const [candidateStateSnapshots, interviewerDecisionSnapshots, intentSnapshots, trajectorySnapshots] = await Promise.all([
    readCandidateStateSnapshots(session.id),
    readInterviewerDecisionSnapshots(session.id),
    readIntentSnapshots(session.id),
    readTrajectorySnapshots(session.id),
  ]);

  if (!session.feedbackReport) {
    return (
      <main style={pageStyle}>
        <div style={containerStyle}>
          <BackLinks sessionId={session.id} />
          <section style={heroCardStyle}>
            <p style={eyebrowStyle}>Feedback Report</p>
            <h1 style={{ margin: 0 }}>No report yet</h1>
            <p style={mutedParagraphStyle}>
              This session does not have a generated report yet. Go back to the interview room and generate one from
              the current session signals.
            </p>
            <Link href={`/interview/${session.id}`} style={primaryLinkStyle}>
              Return to Interview Room
            </Link>
          </section>
        </div>
      </main>
    );
  }

  const reportJson = asReportJson(session.feedbackReport.reportJson);
  const snapshotState = buildSessionSnapshotState({
    currentStage: typeof reportJson.currentStage === "string" ? reportJson.currentStage : null,
    events: session.events,
    candidateStateSnapshots: candidateStateSnapshots,
    interviewerDecisionSnapshots: interviewerDecisionSnapshots,
    intentSnapshots,
    trajectorySnapshots,
    executionRuns: session.executionRuns,
  });
  if (!reportJson.candidateState && snapshotState.latestSignals) {
    reportJson.candidateState = snapshotState.latestSignals as CandidateState;
  }
  if (!reportJson.latestDecision && snapshotState.latestDecision) {
    reportJson.latestDecision = snapshotState.latestDecision as LatestDecision;
  }
  if (!reportJson.latestIntent && snapshotState.latestIntent) {
    reportJson.latestIntent = snapshotState.latestIntent;
  }
  if (!reportJson.latestTrajectory && snapshotState.latestTrajectory) {
    reportJson.latestTrajectory = snapshotState.latestTrajectory;
  }
  if (!reportJson.intentTimeline && snapshotState.intentSnapshots.length > 0) {
    reportJson.intentTimeline = snapshotState.intentSnapshots.map((item) => ({
      createdAt: item.createdAt,
      stage: item.stage,
      payload: item.intent,
    }));
  }
  if (!reportJson.trajectoryTimeline && snapshotState.trajectorySnapshots.length > 0) {
    reportJson.trajectoryTimeline = snapshotState.trajectorySnapshots.map((item) => ({
      createdAt: item.createdAt,
      stage: item.stage,
      payload: item.trajectory,
    }));
  }
  const reportCurrentStage = reportJson.currentStage ?? snapshotState.currentStageLabel;
  const reportStageJourney =
    Array.isArray(reportJson.stageJourney) && reportJson.stageJourney.length > 0
      ? reportJson.stageJourney
      : snapshotState.stageJourney;
  const stageReplaySections = reportJson.stageSections ?? [];
  const dimensions = normalizeDimensions(reportJson.dimensions, session.evaluation?.dimensionScores ?? []);
  const replayItems = buildReplayItems({
    events: session.events,
    transcripts: session.transcripts,
    executionRuns: session.executionRuns,
    reportJson,
  });
  const candidateStateTimeline = buildCandidateStateTimeline(session.events);
  const latestCriticEvent = [...session.events]
    .reverse()
    .find((event) => event.eventType === 'CRITIC_VERDICT_RECORDED');
  const latestCritic = latestCriticEvent ? asRecord(asRecord(latestCriticEvent.payloadJson).criticVerdict) : null;
  const sessionCritic =
    reportJson.sessionCritic ??
    summarizeSessionCritic({
      events: session.events.map((event) => ({ eventType: event.eventType, payloadJson: event.payloadJson })),
      latestSignals: reportJson.candidateState ?? snapshotState.latestSignals,
    });
  const reportLedger =
    snapshotState.ledger ??
    (reportJson.candidateState
      ? buildMemoryLedger({
          currentStage:
            typeof reportJson.currentStage === "string" && isCodingInterviewStage(reportJson.currentStage)
              ? reportJson.currentStage
              : "PROBLEM_UNDERSTANDING",
          recentEvents: session.events.map((event) => ({ eventType: event.eventType, payloadJson: event.payloadJson })),
          signals: reportJson.candidateState as never,
          latestExecutionRun: session.executionRuns.at(-1)
            ? ({
                status: session.executionRuns.at(-1)!.status,
                stdout: session.executionRuns.at(-1)!.stdout,
                stderr: session.executionRuns.at(-1)!.stderr,
              } as const)
            : null,
        })
      : null);

  return (
    <main style={pageStyle}>
      <div style={containerStyle}>
        <BackLinks sessionId={session.id} />

        <section style={heroCardStyle}>
          <div style={{ display: "grid", gap: 10 }}>
            <p style={eyebrowStyle}>Feedback Report v{session.feedbackReport.reportVersion.replace(/^v/i, "")}</p>
            <h1 style={{ margin: 0 }}>{reportJson.questionTitle ?? session.question?.title ?? "Interview Report"}</h1>
            <p style={mutedParagraphStyle}>
              {reportJson.overallSummary ?? session.evaluation?.overallSummary ?? "Structured feedback from the coding interview session."}
            </p>
          </div>
          <div style={heroMetaRowStyle}>
            <Metric label="Recommendation" value={reportJson.recommendation ?? session.evaluation?.recommendation ?? "BORDERLINE"} />
            <Metric label="Overall Score" value={`${reportJson.overallScore ?? session.evaluation?.overallScore ?? 0}/100`} />
            <Metric label="Level" value={reportJson.targetLevel ?? session.targetLevel ?? "Unspecified"} />
            <Metric label="Language" value={reportJson.selectedLanguage ?? session.selectedLanguage ?? "Unspecified"} />
          </div>
        </section>

        <section style={gridStyle}>
          <article style={panelStyle}>
            <h2 style={sectionTitleStyle}>Candidate DNA</h2>
            {reportJson.candidateDna ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={listItemStyle}>
                  <strong>{reportJson.candidateDna.headline ?? "Candidate profile"}</strong>
                  {Array.isArray(reportJson.candidateDna.traits) && reportJson.candidateDna.traits.length > 0 ? (
                    <div style={{ ...pillRowStyle, marginTop: 8 }}>
                      {reportJson.candidateDna.traits.map((trait) => (
                        <span key={`dna-trait-${trait}`} style={stagePillStyle}>{trait}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {Array.isArray(reportJson.candidateDna.strengths) && reportJson.candidateDna.strengths.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <strong>Natural strengths</strong>
                    {reportJson.candidateDna.strengths.map((item) => (
                      <div key={`dna-strength-${item}`} style={listItemStyle}>{item}</div>
                    ))}
                  </div>
                ) : null}
                {Array.isArray(reportJson.candidateDna.watchouts) && reportJson.candidateDna.watchouts.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <strong>Watchouts</strong>
                    {reportJson.candidateDna.watchouts.map((item) => (
                      <div key={`dna-watchout-${item}`} style={listItemStyle}>{item}</div>
                    ))}
                  </div>
                ) : null}
                {reportJson.candidateDna.growthEdge ? (
                  <div style={listItemStyle}>
                    <strong>Growth edge</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{reportJson.candidateDna.growthEdge}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p style={mutedParagraphStyle}>No candidate profile was generated yet.</p>
            )}
          </article>

          <article style={panelStyle}>
            <h2 style={sectionTitleStyle}>Rubric Scorecard</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {(reportJson.rubricSummary ?? []).length === 0 ? (
                <p style={mutedParagraphStyle}>No rubric scorecard is available yet.</p>
              ) : (
                (reportJson.rubricSummary ?? []).map((item, index) => (
                  <div key={`rubric-summary-${index}`} style={listItemStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <strong>{item.dimension ?? "Dimension"}</strong>
                      <span style={stagePillStyle}>
                        {item.score ?? "?"}/{item.maxScore ?? 5}
                      </span>
                    </div>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>
                      <strong>Verdict:</strong> {item.verdict ?? "mixed"}
                    </p>
                    {item.rationale ? (
                      <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{item.rationale}</p>
                    ) : null}
                    {item.basis ? (
                      <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>
                        <strong>Basis:</strong> {item.basis}
                      </p>
                    ) : null}
                    {Array.isArray(item.evidence) && item.evidence.length > 0 ? (
                      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        {item.evidence.map((point, pointIndex) => (
                          <div key={`rubric-summary-${index}-${pointIndex}`} style={listItemStyle}>
                            {point}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Moments of Truth</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {(reportJson.momentsOfTruth ?? []).length === 0 ? (
              <p style={mutedParagraphStyle}>No pivotal moments were captured for this report yet.</p>
            ) : (
              (reportJson.momentsOfTruth ?? []).map((item, index) => (
                <div key={`moment-of-truth-${index}`} style={listItemStyle}>
                  <strong>{item.title ?? "Moment of truth"}</strong>
                  {item.importance ? (
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}><strong>Importance:</strong> {item.importance}</p>
                  ) : null}
                  {item.detail ? (
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{item.detail}</p>
                  ) : null}
                  {Array.isArray(item.evidence) && item.evidence.length > 0 ? (
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {item.evidence.map((point, pointIndex) => (
                        <div key={`moment-of-truth-${index}-${pointIndex}`} style={listItemStyle}>{point}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
        <section style={gridStyle}>
          <article style={panelStyle}>
            <h2 style={sectionTitleStyle}>Stage Journey</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {reportStageJourney.length === 0 ? (
                <p style={mutedParagraphStyle}>No stage transitions were captured for this session.</p>
              ) : (
                reportStageJourney.map((stage) => (
                  <div key={stage} style={pillRowStyle}>
                    <span style={stagePillStyle}>{stage}</span>
                  </div>
                ))
              )}
            </div>
          </article>

          <article style={panelStyle}>
            <h2 style={sectionTitleStyle}>Session Signals</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <MetricRow
                label="Code Runs"
                value={`${reportJson.codeRunSummary?.totalRuns ?? 0} total / ${reportJson.codeRunSummary?.passedRuns ?? 0} passing`}
              />
              <MetricRow
                label="Hints"
                value={`${reportJson.hintSummary?.requested ?? 0} requested / ${reportJson.hintSummary?.served ?? 0} served`}
              />
              <MetricRow
                label="Hint Cost"
                value={`${reportJson.hintSummary?.totalHintCost ?? 0} total / ${reportJson.hintSummary?.averageHintCost ?? 0} avg`}
              />
              <MetricRow
                label="Hint Penalty"
                value={`${reportJson.hintSummary?.penaltyApplied ?? 0} pts`}
              />
              <MetricRow
                label="Strongest Hint"
                value={reportJson.hintSummary?.strongestHintLevel ?? "none"}
              />
              <MetricRow
                label="Turns"
                value={`${reportJson.transcriptSummary?.userTurns ?? 0} user / ${reportJson.transcriptSummary?.aiTurns ?? 0} AI`}
              />
              <MetricRow label="Current Stage" value={reportCurrentStage ?? "Unknown"} />
            </div>
          </article>
        </section>

        <section style={gridStyle}>
          <article style={panelStyle}>
            <h2 style={sectionTitleStyle}>Latest Candidate State</h2>
            {reportJson.candidateState ? (
              <div style={{ display: "grid", gap: 10 }}>
                <MetricRow label="Understanding" value={reportJson.candidateState.understanding ?? "unknown"} />
                <MetricRow label="Progress" value={reportJson.candidateState.progress ?? "unknown"} />
                <MetricRow label="Communication" value={reportJson.candidateState.communication ?? "unknown"} />
                <MetricRow label="Code Quality" value={reportJson.candidateState.codeQuality ?? "unknown"} />
                <MetricRow label="Algorithm Choice" value={reportJson.candidateState.algorithmChoice ?? "unknown"} />
                <MetricRow label="Edge Cases" value={reportJson.candidateState.edgeCaseAwareness ?? "unknown"} />
                <MetricRow label="Behavior" value={reportJson.candidateState.behavior ?? "unknown"} />
                <MetricRow label="Reasoning Depth" value={reportJson.candidateState.reasoningDepth ?? "unknown"} />
                <MetricRow label="Testing Discipline" value={reportJson.candidateState.testingDiscipline ?? "unknown"} />
                <MetricRow label="Complexity Rigor" value={reportJson.candidateState.complexityRigor ?? "unknown"} />
                <MetricRow
                  label="Signal Confidence"
                  value={
                    typeof reportJson.candidateState.confidence === "number"
                      ? `${Math.round(reportJson.candidateState.confidence * 100)}%`
                      : "unknown"
                  }
                />
                {reportJson.candidateState.trendSummary ? (
                  <div style={listItemStyle}>
                    <strong>Trend</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{reportJson.candidateState.trendSummary}</p>
                  </div>
                ) : null}
                {Array.isArray(reportJson.candidateState.evidence) && reportJson.candidateState.evidence.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <strong>Evidence</strong>
                    {reportJson.candidateState.evidence.map((item) => (
                      <div key={`candidate-evidence-${item}`} style={listItemStyle}>
                        {item}
                      </div>
                    ))}
                  </div>
                ) : null}
                {Array.isArray(reportJson.candidateState.structuredEvidence) && reportJson.candidateState.structuredEvidence.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <strong>Observed Issues</strong>
                    {groupStructuredEvidence(reportJson.candidateState.structuredEvidence).map((group) => (
                      <div key={`candidate-structured-group-${group.label}`} style={{ display: "grid", gap: 10 }}>
                        <strong>{group.label}</strong>
                        {group.items.map((item, index) => (
                          <div key={`candidate-structured-evidence-${group.label}-${index}`} style={listItemStyle}>
                            <strong>{item.issue ?? "Observed issue"}</strong>
                            <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>
                              {item.evidence ?? item.behavior ?? "No concrete evidence captured."}
                            </p>
                            {item.impact ? (
                              <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>
                                <strong>Impact:</strong> {item.impact}
                              </p>
                            ) : null}
                            {item.fix ? (
                              <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>
                                <strong>Fix:</strong> {item.fix}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p style={mutedParagraphStyle}>No candidate-state snapshot was captured for this session.</p>
            )}
          </article>

          <article style={panelStyle}>
            <h2 style={sectionTitleStyle}>Latest Interviewer Decision</h2>
            {reportJson.latestDecision ? (
              <div style={{ display: "grid", gap: 10 }}>
                <MetricRow label="Action" value={reportJson.latestDecision.action ?? "unknown"} />
                <MetricRow label="Target" value={reportJson.latestDecision.target ?? "unknown"} />
                <MetricRow label="Policy Action" value={reportJson.latestDecision.policyAction ?? "unknown"} />
                <MetricRow
                  label="Decision Confidence"
                  value={
                    typeof reportJson.latestDecision.confidence === "number"
                      ? `${Math.round(reportJson.latestDecision.confidence * 100)}%`
                      : "unknown"
                  }
                />
                <MetricRow label="Pressure" value={String(reportJson.latestDecision.pressure ?? "unknown")} />
                <MetricRow
                  label="Worth Asking"
                  value={
                    typeof latestCritic?.questionWorthAsking === "boolean"
                      ? latestCritic.questionWorthAsking
                        ? "Yes"
                        : "No"
                      : "unknown"
                  }
                />
                <MetricRow label="Timing Verdict" value={String(latestCritic?.timingVerdict ?? "unknown")} />
                <MetricRow label="Urgency" value={String(latestCritic?.urgency ?? reportJson.latestDecision.urgency ?? "unknown")} />
                <MetricRow
                  label="Interruption Cost"
                  value={String(latestCritic?.interruptionCost ?? reportJson.latestDecision.interruptionCost ?? "unknown")}
                />
                <div style={listItemStyle}>
                  <strong>Question</strong>
                  <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{reportJson.latestDecision.question ?? "No question captured."}</p>
                </div>
                <div style={listItemStyle}>
                  <strong>Reason</strong>
                  <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{reportJson.latestDecision.reason ?? "No decision reason captured."}</p>
                </div>
                {reportJson.latestDecision.specificIssue ? (
                  <div style={listItemStyle}>
                    <strong>Specific issue</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{reportJson.latestDecision.specificIssue}</p>
                  </div>
                ) : null}
                {reportJson.latestDecision.targetCodeLine ? (
                  <div style={listItemStyle}>
                    <strong>Target code line</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{reportJson.latestDecision.targetCodeLine}</p>
                  </div>
                ) : null}
                {reportJson.latestDecision.expectedAnswer ? (
                  <div style={listItemStyle}>
                    <strong>Expected answer</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{reportJson.latestDecision.expectedAnswer}</p>
                  </div>
                ) : null}
                {latestCritic?.worthReason ? (
                  <div style={listItemStyle}>
                    <strong>Worth reason</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{String(latestCritic.worthReason)}</p>
                  </div>
                ) : null}
                {latestCritic?.batchGroup ? (
                  <div style={listItemStyle}>
                    <strong>Deferred batch group</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>{String(latestCritic.batchGroup)}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p style={mutedParagraphStyle}>No interviewer decision snapshot was captured for this session.</p>
            )}
          </article>
        </section>

        <section style={gridStyle}>
          <article style={panelStyle}>
            <h2 style={sectionTitleStyle}>Latest Intent</h2>
            {reportJson.latestIntent ? (
              <div style={{ display: "grid", gap: 10 }}>
                <MetricRow label="Intent" value={stringValue(reportJson.latestIntent.intent) ?? "unknown"} />
                <MetricRow
                  label="Target Signal"
                  value={stringValue(reportJson.latestIntent.targetSignal) ?? "unknown"}
                />
                <MetricRow
                  label="Expected Outcome"
                  value={stringValue(reportJson.latestIntent.expectedOutcome) ?? "unknown"}
                />
                <MetricRow label="Urgency" value={stringValue(reportJson.latestIntent.urgency) ?? "unknown"} />
                <MetricRow
                  label="Can Defer"
                  value={
                    typeof reportJson.latestIntent.canDefer === "boolean"
                      ? reportJson.latestIntent.canDefer
                        ? "Yes"
                        : "No"
                      : "unknown"
                  }
                />
                {stringValue(reportJson.latestIntent.reason) ? (
                  <div style={listItemStyle}>
                    <strong>Reason</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>
                      {stringValue(reportJson.latestIntent.reason)}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p style={mutedParagraphStyle}>No intent snapshot recorded yet.</p>
            )}
          </article>

          <article style={panelStyle}>
            <h2 style={sectionTitleStyle}>Latest Trajectory</h2>
            {reportJson.latestTrajectory ? (
              <div style={{ display: "grid", gap: 10 }}>
                <MetricRow
                  label="Candidate Trajectory"
                  value={stringValue(reportJson.latestTrajectory.candidateTrajectory) ?? "unknown"}
                />
                <MetricRow
                  label="Expected Without Intervention"
                  value={stringValue(reportJson.latestTrajectory.expectedWithNoIntervention) ?? "unknown"}
                />
                <MetricRow
                  label="Intervention Value"
                  value={stringValue(reportJson.latestTrajectory.interventionValue) ?? "unknown"}
                />
                <MetricRow
                  label="Best Intervention"
                  value={stringValue(reportJson.latestTrajectory.bestIntervention) ?? "unknown"}
                />
                <MetricRow
                  label="Interruption Cost"
                  value={stringValue(reportJson.latestTrajectory.interruptionCost) ?? "unknown"}
                />
                <MetricRow
                  label="Evidence Gain If Ask Now"
                  value={stringValue(reportJson.latestTrajectory.evidenceGainIfAskNow) ?? "unknown"}
                />
                <MetricRow
                  label="Confidence"
                  value={
                    typeof reportJson.latestTrajectory.confidence === "number"
                      ? `${Math.round(reportJson.latestTrajectory.confidence * 100)}%`
                      : "unknown"
                  }
                />
              </div>
            ) : (
              <p style={mutedParagraphStyle}>No trajectory snapshot recorded yet.</p>
            )}
          </article>
        </section>

        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Session Critic</h2>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <Metric label="Redundancy" value={`${sessionCritic.redundancyScore}/100`} />
              <Metric label="Interruptions" value={`${sessionCritic.interruptionScore}/100`} />
              <Metric label="Pressure Balance" value={sessionCritic.pressureBalance} />
              <Metric label="Flow Preservation" value={sessionCritic.flowPreservation} />
              <Metric label="Timing Quality" value={sessionCritic.timingQuality} />
              <Metric label="Closure Quality" value={sessionCritic.closureQuality} />
            </div>
            {sessionCritic.notes.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                <strong>Session Notes</strong>
                {sessionCritic.notes.map((note, index) => (
                  <div key={`session-critic-note-${index}`} style={listItemStyle}>
                    {note}
                  </div>
                ))}
              </div>
            ) : (
              <p style={mutedParagraphStyle}>No session-level critic notes yet.</p>
            )}
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Memory Ledger</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {reportLedger ? (
              <>
                {reportLedger.unresolvedIssues.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <strong>Unresolved Issues</strong>
                    {reportLedger.unresolvedIssues.map((item) => (
                      <div key={`report-ledger-unresolved-${item}`} style={listItemStyle}>{item}</div>
                    ))}
                  </div>
                ) : null}
                {reportLedger.answeredTargets.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <strong>Answered Targets</strong>
                    {reportLedger.answeredTargets.map((item) => (
                      <div key={`report-ledger-answered-${item}`} style={listItemStyle}>{item}</div>
                    ))}
                  </div>
                ) : null}
                {reportLedger.collectedEvidence.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <strong>Collected Evidence</strong>
                    {reportLedger.collectedEvidence.map((item) => (
                      <div key={`report-ledger-collected-${item}`} style={listItemStyle}>{item}</div>
                    ))}
                  </div>
                ) : null}
                {reportLedger.missingEvidence.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <strong>Missing Evidence</strong>
                    {reportLedger.missingEvidence.map((item) => (
                      <div key={`report-ledger-missing-${item}`} style={listItemStyle}>{item}</div>
                    ))}
                  </div>
                ) : null}
                {reportJson.latestDecision?.specificIssue || reportJson.latestDecision?.target ? (
                  <div style={listItemStyle}>
                    <strong>Evidence Focus This Turn</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 8 }}>
                      {reportJson.latestDecision?.specificIssue ?? reportJson.latestDecision?.target}
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <p style={mutedParagraphStyle}>No memory-ledger snapshot is available for this report yet.</p>
            )}
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Dimension Scores</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {dimensions.map((dimension) => (
              <div key={dimension.key} style={dimensionCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <strong>{dimension.label}</strong>
                  <span style={{ color: "var(--muted)" }}>
                    {dimension.score}/{dimension.maxScore}
                  </span>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {dimension.issue ? (
                    <div>
                      <strong>Issue</strong>
                      <p style={{ ...mutedParagraphStyle, marginTop: 6 }}>{dimension.issue}</p>
                    </div>
                  ) : null}
                  <div>
                    <strong>Evidence</strong>
                    <p style={{ ...mutedParagraphStyle, marginTop: 6 }}>{dimension.evidence}</p>
                  </div>
                  {dimension.impact ? (
                    <div>
                      <strong>Impact</strong>
                      <p style={{ ...mutedParagraphStyle, marginTop: 6 }}>{dimension.impact}</p>
                    </div>
                  ) : null}
                  {dimension.improvement && dimension.improvement.length > 0 ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <strong>How to improve</strong>
                      {dimension.improvement.map((item) => (
                        <div key={`${dimension.key}-${item}`} style={listItemStyle}>
                          {item}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Stage Replay</h2>
          <div style={{ display: "grid", gap: 16 }}>
            {stageReplaySections.length === 0 ? (
              <p style={mutedParagraphStyle}>No stage-grouped replay markers were captured for this session.</p>
            ) : (
              stageReplaySections.map((group, index) => (
                <details key={group.key ?? group.label ?? `section-${index}`} style={accordionStyle} open={index === 0}>
                  <summary style={accordionSummaryStyle}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <strong>{group.label ?? "Stage section"}</strong>
                      <span style={{ color: "var(--muted)", fontSize: 13 }}>
                        {(group.stages ?? []).join(" • ")}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <span style={stagePillStyle}>{summarizeStageCount(group.signalSnapshots?.length, "signal")}</span>
                      <span style={stagePillStyle}>{summarizeStageCount(group.decisions?.length, "decision")}</span>
                      <span style={stagePillStyle}>{summarizeStageCount(group.turns?.length, "turn")}</span>
                      <span style={stagePillStyle}>{summarizeStageCount(group.evidence?.length, "evidence")}</span>
                    </div>
                  </summary>
                  <div style={{ display: "grid", gap: 12 }}>
                    {Array.isArray(group.evidence) && group.evidence.length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <strong>Evidence trail</strong>
                        {group.evidence.map((item, evidenceIndex) => (
                          <div key={`${group.key ?? group.label}-evidence-${evidenceIndex}`} style={listItemStyle}>
                            {item}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {Array.isArray(group.signalSnapshots) && group.signalSnapshots.length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <strong>Candidate state checkpoints</strong>
                        {group.signalSnapshots.map((signal, signalIndex) => (
                          <div key={`${group.key ?? group.label}-signal-${signalIndex}`} style={listItemStyle}>
                            <strong>
                              {signal.progress ?? "unknown progress"} / {signal.reasoningDepth ?? "unknown reasoning"}
                            </strong>
                            <p style={{ ...mutedParagraphStyle, marginTop: 6 }}>
                              {signal.summary ?? signal.trendSummary ?? "Candidate snapshot recorded for this stage."}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {Array.isArray(group.decisions) && group.decisions.length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <strong>Interviewer decisions</strong>
                        {group.decisions.map((decision, decisionIndex) => (
                          <div key={`${group.key ?? group.label}-decision-${decisionIndex}`} style={listItemStyle}>
                            <strong>{decision.action ?? "decision"}</strong>
                            <p style={{ ...mutedParagraphStyle, marginTop: 6 }}>
                              {decision.question ?? decision.reason ?? "No detail captured."}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {Array.isArray(group.turns) && group.turns.length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <strong>Representative turns</strong>
                        {group.turns.map((turn, turnIndex) => (
                          <div key={`${group.key ?? group.label}-turn-${turnIndex}`} style={listItemStyle}>
                            <strong>{turn.speaker}</strong>
                            <p style={{ ...mutedParagraphStyle, marginTop: 6 }}>{turn.text}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </details>
              ))
            )}
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Candidate-State Timeline</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {candidateStateTimeline.length === 0 ? (
              <p style={mutedParagraphStyle}>No candidate-state timeline markers were captured for this session.</p>
            ) : (
              candidateStateTimeline.map((item) => (
                <div key={item.id} style={replayCardStyle(item.kind === "signal" || item.kind === "decision" ? "info" : item.kind === "code_run" ? "warning" : "neutral")}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={stagePillStyle}>{item.kind}</span>
                      <strong>{item.title}</strong>
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>{item.time}</span>
                  </div>
                  <p style={mutedParagraphStyle}>{item.summary}</p>
                  {item.evidenceFocus ? (
                    <p style={mutedParagraphStyle}>
                      <strong>Evidence focus:</strong> {item.evidenceFocus}
                    </p>
                  ) : null}
                  {item.intent || item.intentTargetSignal || item.expectedOutcome ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.intent ? <span style={stagePillStyle}>intent: {item.intent}</span> : null}
                      {item.intentTargetSignal ? (
                        <span style={stagePillStyle}>target signal: {item.intentTargetSignal}</span>
                      ) : null}
                      {item.expectedOutcome ? (
                        <span style={stagePillStyle}>outcome: {item.expectedOutcome}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {item.candidateTrajectory || item.expectedWithNoIntervention || item.bestIntervention ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.candidateTrajectory ? (
                        <span style={stagePillStyle}>trajectory: {item.candidateTrajectory}</span>
                      ) : null}
                      {item.expectedWithNoIntervention ? (
                        <span style={stagePillStyle}>no-intervention: {item.expectedWithNoIntervention}</span>
                      ) : null}
                      {item.bestIntervention ? (
                        <span style={stagePillStyle}>best move: {item.bestIntervention}</span>
                      ) : null}
                      {item.interventionValue ? (
                        <span style={stagePillStyle}>value: {item.interventionValue}</span>
                      ) : null}
                      {item.expectedEvidenceGain ? (
                        <span style={stagePillStyle}>evidence gain: {item.expectedEvidenceGain}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {item.timingVerdict || item.urgency || item.interruptionCost ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.timingVerdict ? <span style={stagePillStyle}>timing: {item.timingVerdict}</span> : null}
                      {item.urgency ? <span style={stagePillStyle}>urgency: {item.urgency}</span> : null}
                      {item.interruptionCost ? <span style={stagePillStyle}>interrupt: {item.interruptionCost}</span> : null}
                      {item.batchGroup ? <span style={stagePillStyle}>batch: {item.batchGroup}</span> : null}
                    </div>
                  ) : null}
                  {item.answeredTargets && item.answeredTargets.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.answeredTargets.slice(0, 4).map((target) => (
                        <span key={`${item.id}-answered-${target}`} style={stagePillStyle}>
                          answered: {target}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.collectedEvidence && item.collectedEvidence.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.collectedEvidence.slice(0, 4).map((evidence) => (
                        <span key={`${item.id}-collected-${evidence}`} style={stagePillStyle}>
                          collected: {evidence}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.unresolvedIssues && item.unresolvedIssues.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.unresolvedIssues.slice(0, 3).map((issue) => (
                        <span key={`${item.id}-unresolved-${issue}`} style={stagePillStyle}>
                          unresolved: {issue}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.missingEvidence && item.missingEvidence.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.missingEvidence.slice(0, 3).map((evidence) => (
                        <span key={`${item.id}-missing-${evidence}`} style={stagePillStyle}>
                          missing: {evidence}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <details>
                    <summary style={{ cursor: "pointer", color: "var(--accent-strong)", fontWeight: 700 }}>
                      View payload
                    </summary>
                    <pre style={miniPreStyle}>{JSON.stringify(item.payload, null, 2)}</pre>
                  </details>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Session Replay Timeline</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {replayItems.length === 0 ? (
              <p style={mutedParagraphStyle}>No replay markers were captured for this session.</p>
            ) : (
              replayItems.map((item) => (
                <div key={item.id} style={replayCardStyle(item.tone)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                    <strong>{item.title}</strong>
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>{item.time}</span>
                  </div>
                  <p style={mutedParagraphStyle}>{item.description}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={gridStyle}>
          <ListPanel title="Strengths" items={reportJson.strengths ?? []} />
          <ListPanel title="Areas to Improve" items={reportJson.weaknesses ?? []} />
          <ListPanel title="Missed Signals" items={reportJson.missedSignals ?? []} />
          <ListPanel title="Next Steps" items={reportJson.improvementPlan ?? []} />
        </section>
      </div>
    </main>
  );
}

function BackLinks({ sessionId }: { sessionId: string }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Link href={`/interview/${sessionId}`} style={subtleLinkStyle}>
        Back to Interview Room
      </Link>
      <Link href="/admin" style={subtleLinkStyle}>
        Open Admin
      </Link>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricCardStyle}>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{label}</span>
      <strong style={{ fontSize: 18 }}>{value}</strong>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ListPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <article style={panelStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {items.length === 0 ? (
          <p style={mutedParagraphStyle}>No items available yet.</p>
        ) : (
          items.map((item) => (
            <div key={`${title}-${item}`} style={listItemStyle}>
              {item}
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function asReportJson(value: unknown): ReportJson {
  return typeof value === "object" && value !== null ? (value as ReportJson) : {};
}

function normalizeDimensions(
  reportDimensions: ReportJson["dimensions"],
  evaluationDimensions: Array<{
    dimensionKey: string;
    score: number;
    maxScore: number;
    evidence: string | null;
  }>,
): Dimension[] {
  if (Array.isArray(reportDimensions) && reportDimensions.length > 0) {
    return reportDimensions;
  }

  return evaluationDimensions.map((dimension) => ({
    key: dimension.dimensionKey,
    label: prettifyKey(dimension.dimensionKey),
    score: dimension.score,
    maxScore: dimension.maxScore,
    evidence: dimension.evidence ?? "No evidence captured.",
  }));
}

function buildReplayItems(input: {
  events: Array<{ id: string; eventType: string; eventTime: Date; payloadJson: unknown }>;
  transcripts: Array<{ id: string; speaker: "USER" | "AI" | "SYSTEM"; text: string; createdAt: Date }>;
  executionRuns: Array<{ id: string; status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT"; stdout: string | null; stderr: string | null; createdAt: Date }>;
  reportJson: ReportJson;
}): ReplayItem[] {
  const items: ReplayItem[] = [];

  for (const event of input.events) {
    const payload = asRecord(event.payloadJson);

    if (event.eventType === "STAGE_ADVANCED") {
      items.push({
        id: event.id,
        time: event.eventTime.toLocaleTimeString(),
        sortTime: event.eventTime.getTime(),
        title: "Stage Transition",
        description: `${stringValue(payload.previousStage) ?? "Earlier stage"} -> ${stringValue(payload.stage) ?? "Unknown stage"}${stringValue(payload.reason) ? `: ${stringValue(payload.reason)}` : ""}`,
        tone: "info",
      });
    }

    if (event.eventType === "SIGNAL_SNAPSHOT_RECORDED") {
      const signals = asRecord(payload.signals);
      const structuredEvidence = Array.isArray(signals.structuredEvidence) ? signals.structuredEvidence : [];
      const primaryIssue = structuredEvidence.find((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).issue === "string") as Record<string, unknown> | undefined;
      items.push({
        id: event.id,
        time: event.eventTime.toLocaleTimeString(),
        sortTime: event.eventTime.getTime(),
        title: "Candidate State Updated",
        description: primaryIssue?.issue ? `Observed issue: ${String(primaryIssue.issue)}` : stringValue(signals.summary) ?? "Candidate state snapshot recorded.",
        tone: "neutral",
      });
    }

    if (event.eventType === "DECISION_RECORDED") {
      const decision = asRecord(payload.decision);
      items.push({
        id: event.id,
        time: event.eventTime.toLocaleTimeString(),
        sortTime: event.eventTime.getTime(),
        title: "Interviewer Decision",
        description: `${stringValue(decision.action) ?? "decision"} -> ${stringValue(decision.target) ?? "unknown target"}${stringValue(decision.reason) ? `: ${stringValue(decision.reason)}` : ""}`,
        tone: "info",
      });
    }

    if (event.eventType === "CRITIC_VERDICT_RECORDED") {
      const criticVerdict = asRecord(payload.criticVerdict);
      const timingBits = [
        stringValue(criticVerdict.timingVerdict) ? `timing=${stringValue(criticVerdict.timingVerdict)}` : null,
        stringValue(criticVerdict.urgency) ? `urgency=${stringValue(criticVerdict.urgency)}` : null,
        stringValue(criticVerdict.interruptionCost) ? `interrupt=${stringValue(criticVerdict.interruptionCost)}` : null,
        stringValue(criticVerdict.batchGroup) ? `batch=${stringValue(criticVerdict.batchGroup)}` : null,
      ].filter(Boolean).join(", ");
      items.push({
        id: event.id,
        time: event.eventTime.toLocaleTimeString(),
        sortTime: event.eventTime.getTime(),
        title: "Critic Verdict",
        description: `${stringValue(criticVerdict.verdict) ?? "verdict"} / ${stringValue(criticVerdict.reason) ?? "unknown reason"}${timingBits ? ` (${timingBits})` : ""}${stringValue(criticVerdict.explanation) ? `: ${stringValue(criticVerdict.explanation)}` : ""}`,
        tone: "warning",
      });
    }

    if (event.eventType === "HINT_SERVED") {
      items.push({
        id: event.id,
        time: event.eventTime.toLocaleTimeString(),
        sortTime: event.eventTime.getTime(),
        title: "Hint Served",
        description: `${stringValue(payload.hintLevel) ?? "LIGHT"} ${stringValue(payload.hintStyle) ?? "generic"} hint during ${stringValue(payload.stage) ?? "current stage"}${stringValue(payload.escalationReason) ? ` because ${stringValue(payload.escalationReason)?.replaceAll("_", " ")}` : ""}.`,
        tone: "warning",
      });
    }

    if (event.eventType === "REPORT_GENERATED") {
      items.push({
        id: event.id,
        time: event.eventTime.toLocaleTimeString(),
        sortTime: event.eventTime.getTime(),
        title: "Final Feedback Generated",
        description: `Recommendation ${stringValue(payload.recommendation) ?? input.reportJson.recommendation ?? "unknown"} with overall score ${stringValue(payload.overallScore) ?? String(input.reportJson.overallScore ?? "unknown")}.`,
        tone: "success",
      });
    }
  }

  for (const run of input.executionRuns) {
    items.push({
      id: `run-${run.id}`,
      time: run.createdAt.toLocaleTimeString(),
      sortTime: run.createdAt.getTime(),
      title: "Code Run",
      description:
        run.status === "PASSED"
          ? "A passing execution run was recorded."
          : `Execution finished with ${run.status}. ${run.stderr?.trim() ? `Key failure signal: ${truncate(run.stderr, 120)}` : "The candidate likely needed debugging."}`,
      tone: run.status === "PASSED" ? "success" : "warning",
    });
  }

  const importantTurns = input.transcripts.filter((segment) => segment.speaker !== "SYSTEM" && segment.text.trim().length >= 36);

  for (const segment of importantTurns.slice(-4)) {
    items.push({
      id: `turn-${segment.id}`,
      time: segment.createdAt.toLocaleTimeString(),
      sortTime: segment.createdAt.getTime(),
      title: segment.speaker === "AI" ? "Interviewer Follow-up" : "Candidate Explanation",
      description: truncate(segment.text, 180),
      tone: segment.speaker === "AI" ? "info" : "neutral",
    });
  }

  return items.sort((left, right) => right.sortTime - left.sortTime);
}

function buildCandidateStateTimeline(
  events: Array<{ id: string; eventType: string; eventTime: Date; payloadJson: unknown }>,
): CandidateStateTimelineItem[] {
  return events
    .filter((event) =>
      [
        "STAGE_ADVANCED",
        "SIGNAL_SNAPSHOT_RECORDED",
        "DECISION_RECORDED",
        "INTENT_SNAPSHOT_RECORDED",
        "TRAJECTORY_SNAPSHOT_RECORDED",
        "CRITIC_VERDICT_RECORDED",
        "HINT_SERVED",
        "CODE_RUN_COMPLETED",
      ].includes(event.eventType),
    )
    .map((event) => {
      const payload = asRecord(event.payloadJson);

      if (event.eventType === "STAGE_ADVANCED") {
        return {
          id: event.id,
          kind: "stage" as const,
          time: event.eventTime.toLocaleTimeString(),
          sortTime: event.eventTime.getTime(),
          title: "Stage advanced",
          summary: `${stringValue(payload.previousStage) ?? "Earlier stage"} -> ${stringValue(payload.stage) ?? "Unknown stage"}`,
          payload,
        };
      }

      if (event.eventType === "SIGNAL_SNAPSHOT_RECORDED") {
        const signals = asRecord(payload.signals);
        const structuredEvidence = Array.isArray(signals.structuredEvidence) ? signals.structuredEvidence : [];
        const primaryIssue = structuredEvidence.find((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).issue === "string") as Record<string, unknown> | undefined;
        const signalLedger = buildMemoryLedger({
          currentStage: "PROBLEM_UNDERSTANDING",
          recentEvents: events
            .filter((candidate) => candidate.eventTime.getTime() <= event.eventTime.getTime())
            .map((candidate) => ({ eventType: candidate.eventType, payloadJson: candidate.payloadJson })),
          signals: signals as never,
          latestExecutionRun: null,
        });
        return {
          id: event.id,
          kind: "signal" as const,
          time: event.eventTime.toLocaleTimeString(),
          sortTime: event.eventTime.getTime(),
          title: "Candidate state snapshot",
          summary:
            primaryIssue?.issue ? `Observed issue: ${String(primaryIssue.issue)}` :
            stringValue(signals.summary) ??
            `understanding=${stringValue(signals.understanding) ?? "unknown"}, progress=${stringValue(signals.progress) ?? "unknown"}`,
          unresolvedIssues: signalLedger.unresolvedIssues,
          missingEvidence: signalLedger.missingEvidence,
          answeredTargets: signalLedger.answeredTargets,
          collectedEvidence: signalLedger.collectedEvidence,
          payload,
        };
      }

      if (event.eventType === "DECISION_RECORDED") {
        const decision = asRecord(payload.decision);
        return {
          id: event.id,
          kind: "decision" as const,
          time: event.eventTime.toLocaleTimeString(),
          sortTime: event.eventTime.getTime(),
          title: "Interviewer decision",
          summary: `${stringValue(decision.action) ?? "decision"} -> ${stringValue(decision.target) ?? "unknown target"}`,
          evidenceFocus: stringValue(decision.specificIssue) ?? stringValue(decision.target),
          answeredTargets: [],
          collectedEvidence: [],
          payload,
        };
      }

      if (event.eventType === "INTENT_SNAPSHOT_RECORDED") {
        const intent = asRecord(payload.intent);
        return {
          id: event.id,
          kind: "intent" as const,
          time: event.eventTime.toLocaleTimeString(),
          sortTime: event.eventTime.getTime(),
          title: "Interviewer intent",
          summary: `${stringValue(intent.intent) ?? "intent"} -> ${stringValue(intent.expectedOutcome) ?? "unknown outcome"}`,
          urgency: stringValue(intent.urgency),
          intent: stringValue(intent.intent),
          intentTargetSignal: stringValue(intent.targetSignal),
          expectedOutcome: stringValue(intent.expectedOutcome),
          payload,
        };
      }

      if (event.eventType === "TRAJECTORY_SNAPSHOT_RECORDED") {
        const trajectory = asRecord(payload.trajectory);
        return {
          id: event.id,
          kind: "trajectory" as const,
          time: event.eventTime.toLocaleTimeString(),
          sortTime: event.eventTime.getTime(),
          title: "Trajectory estimate",
          summary: `${stringValue(trajectory.candidateTrajectory) ?? "trajectory"} / ${stringValue(trajectory.bestIntervention) ?? "unknown intervention"}`,
          interruptionCost: stringValue(trajectory.interruptionCost),
          candidateTrajectory: stringValue(trajectory.candidateTrajectory),
          expectedWithNoIntervention: stringValue(trajectory.expectedWithNoIntervention),
          interventionValue: stringValue(trajectory.interventionValue),
          bestIntervention: stringValue(trajectory.bestIntervention),
          expectedEvidenceGain: stringValue(trajectory.evidenceGainIfAskNow),
          payload,
        };
      }

      if (event.eventType === "CRITIC_VERDICT_RECORDED") {
        const criticVerdict = asRecord(payload.criticVerdict);
        return {
          id: event.id,
          kind: "decision" as const,
          time: event.eventTime.toLocaleTimeString(),
          sortTime: event.eventTime.getTime(),
          title: "Critic verdict",
          summary: `${stringValue(criticVerdict.verdict) ?? "verdict"} / ${stringValue(criticVerdict.reason) ?? "unknown reason"}${typeof criticVerdict.questionWorthAsking === "boolean" ? ` / worth=${criticVerdict.questionWorthAsking ? "yes" : "no"}` : ""}`,
          timingVerdict: stringValue(criticVerdict.timingVerdict),
          urgency: stringValue(criticVerdict.urgency),
          interruptionCost: stringValue(criticVerdict.interruptionCost),
          batchGroup: stringValue(criticVerdict.batchGroup),
          evidenceFocus: stringValue(criticVerdict.focus) ?? stringValue(criticVerdict.reason),
          answeredTargets: [],
          collectedEvidence: [],
          payload,
        };
      }

      if (event.eventType === "HINT_SERVED") {
        return {
          id: event.id,
          kind: "hint" as const,
          time: event.eventTime.toLocaleTimeString(),
          sortTime: event.eventTime.getTime(),
          title: "Hint served",
          summary: `${stringValue(payload.hintLevel) ?? "LIGHT"} ${stringValue(payload.hintStyle) ?? "hint"}`,
          payload,
        };
      }

      return {
        id: event.id,
        kind: "code_run" as const,
        time: event.eventTime.toLocaleTimeString(),
        sortTime: event.eventTime.getTime(),
        title: "Code run completed",
        summary: stringValue(payload.status) ?? "unknown",
        payload,
      };
    })
    .sort((left, right) => right.sortTime - left.sortTime);
}

function groupStructuredEvidence(
  evidence: NonNullable<CandidateState["structuredEvidence"]>,
) {
  const groups = new Map<string, NonNullable<CandidateState["structuredEvidence"]>>();

  for (const item of evidence) {
    const label = evidenceAreaLabel(item.area);
    const current = groups.get(label) ?? [];
    current.push(item);
    groups.set(label, current);
  }

  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function evidenceAreaLabel(area?: string) {
  switch (area) {
    case "correctness":
    case "reasoning":
      return "Correctness";
    case "testing":
    case "edge_case":
      return "Testing";
    case "complexity":
      return "Complexity";
    case "debugging":
      return "Debugging";
    default:
      return "Other";
  }
}
function prettifyKey(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeStageCount(count: number | undefined, label: string) {
  const safeCount = count ?? 0;
  return `${safeCount} ${label}${safeCount === 1 ? "" : "s"}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

const pageStyle = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #f7f2e7 0%, #f3ede1 45%, #fbf8f2 100%)",
  padding: "40px 20px 72px",
} as const;

const containerStyle = {
  width: "min(1120px, 100%)",
  margin: "0 auto",
  display: "grid",
  gap: 22,
} as const;

const heroCardStyle = {
  borderRadius: 24,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.84)",
  boxShadow: "var(--shadow)",
  padding: 28,
  display: "grid",
  gap: 18,
} as const;

const panelStyle = {
  borderRadius: 20,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.92)",
  boxShadow: "var(--shadow)",
  padding: 20,
  display: "grid",
  gap: 14,
} as const;

const accordionStyle = {
  ...replayCardStyle("info"),
  padding: 0,
  overflow: "hidden",
} as const;

const accordionSummaryStyle = {
  cursor: "pointer",
  listStyle: "none",
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  alignItems: "center",
  padding: 18,
} as const;

const heroMetaRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
} as const;

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 18,
} as const;

const metricCardStyle = {
  borderRadius: 16,
  border: "1px solid var(--border)",
  background: "var(--surface-alt)",
  padding: 14,
  display: "grid",
  gap: 6,
} as const;

const dimensionCardStyle = {
  borderRadius: 16,
  border: "1px solid var(--border)",
  background: "var(--surface-alt)",
  padding: 14,
  display: "grid",
  gap: 8,
} as const;

const listItemStyle = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--surface-alt)",
} as const;

function replayCardStyle(tone: ReplayItem["tone"]) {
  const background =
    tone === "success"
      ? "rgba(13, 122, 82, 0.08)"
      : tone === "warning"
        ? "rgba(184, 110, 0, 0.10)"
        : tone === "info"
          ? "rgba(24, 90, 219, 0.08)"
          : "var(--surface-alt)";

  return {
    borderRadius: 16,
    border: "1px solid var(--border)",
    background,
    padding: 14,
    display: "grid",
    gap: 8,
  } as const;
}

const subtleLinkStyle = {
  color: "var(--accent-strong)",
  textDecoration: "none",
  fontWeight: 700,
} as const;

const primaryLinkStyle = {
  color: "#fff",
  background: "var(--accent-strong)",
  padding: "12px 16px",
  borderRadius: 12,
  textDecoration: "none",
  width: "fit-content",
  fontWeight: 700,
} as const;

const eyebrowStyle = {
  margin: 0,
  color: "var(--accent-strong)",
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
} as const;

const sectionTitleStyle = {
  margin: 0,
} as const;

const mutedParagraphStyle = {
  margin: 0,
  color: "var(--muted)",
  lineHeight: 1.6,
} as const;

const pillRowStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: 10,
} as const;

const stagePillStyle = {
  borderRadius: 999,
  border: "1px solid var(--border)",
  padding: "8px 12px",
  background: "var(--surface-alt)",
  fontWeight: 700,
} as const;

const miniPreStyle = {
  margin: "12px 0 0",
  padding: 12,
  borderRadius: 12,
  background: "#1d2230",
  color: "#ebf0ff",
  overflowX: "auto" as const,
  fontSize: 12,
} as const;













































