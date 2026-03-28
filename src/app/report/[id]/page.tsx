import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

type ReportPageProps = {
  params: Promise<{ id: string }>;
};

type Dimension = {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  evidence: string;
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
};

type ReplayItem = {
  id: string;
  time: string;
  sortTime: number;
  title: string;
  description: string;
  tone: "neutral" | "success" | "warning" | "info";
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
  const dimensions = normalizeDimensions(reportJson.dimensions, session.evaluation?.dimensionScores ?? []);
  const replayItems = buildReplayItems({
    events: session.events,
    transcripts: session.transcripts,
    executionRuns: session.executionRuns,
    reportJson,
  });

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
            <h2 style={sectionTitleStyle}>Stage Journey</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {(reportJson.stageJourney ?? []).length === 0 ? (
                <p style={mutedParagraphStyle}>No stage transitions were captured for this session.</p>
              ) : (
                (reportJson.stageJourney ?? []).map((stage) => (
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
                label="Turns"
                value={`${reportJson.transcriptSummary?.userTurns ?? 0} user / ${reportJson.transcriptSummary?.aiTurns ?? 0} AI`}
              />
              <MetricRow label="Current Stage" value={reportJson.currentStage ?? "Unknown"} />
            </div>
          </article>
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
                <p style={mutedParagraphStyle}>{dimension.evidence}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={sectionTitleStyle}>Session Replay</h2>
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
) {
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

function prettifyKey(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
