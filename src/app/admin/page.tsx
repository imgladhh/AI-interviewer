import Link from "next/link";
import { buildUnifiedOpsFeed, getAdminProfileDetail, listAdminProfiles, type OpsFeedScope } from "@/lib/admin/ops";

type AdminPageProps = {
  searchParams?: Promise<{
    profileId?: string;
    scope?: OpsFeedScope;
  }>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = (await searchParams) ?? {};
  const profiles = await listAdminProfiles(24);
  const activeProfileId = params.profileId ?? profiles[0]?.id;
  const scope: OpsFeedScope =
    params.scope === "persona" || params.scope === "session" ? params.scope : "all";

  const detail = activeProfileId ? await getAdminProfileDetail(activeProfileId) : null;
  const feed = buildUnifiedOpsFeed(detail, scope);

  return (
    <main style={{ minHeight: "100vh", padding: 24 }}>
      <div style={{ width: "min(1360px, 100%)", margin: "0 auto", display: "grid", gap: 18 }}>
        <header
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow)",
            padding: 24,
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <p style={{ margin: 0, color: "var(--accent-strong)", fontWeight: 700, letterSpacing: 1 }}>
              ADMIN DASHBOARD
            </p>
            <h1 style={{ margin: "6px 0 0" }}>Persona Jobs and Operations Feed</h1>
            <p style={{ margin: "8px 0 0", color: "var(--muted)", maxWidth: 760 }}>
              Inspect recent interviewer profiles, raw queue state, persona pipeline events, and related session
              lifecycle events in one place.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/setup" style={topLinkStyle}>
              Open Setup
            </Link>
            <Link href="/api/health" style={topLinkStyle}>
              Health JSON
            </Link>
          </div>
        </header>

        <section style={{ display: "grid", gap: 18, gridTemplateColumns: "320px 1fr" }}>
          <aside style={cardStyle}>
            <div style={{ padding: 20, display: "grid", gap: 14 }}>
              <div>
                <h2 style={{ margin: 0 }}>Recent Profiles</h2>
                <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                  Select a profile to inspect queue state and event history.
                </p>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {profiles.length === 0 ? (
                  <div style={emptyStyle}>No interviewer profiles yet.</div>
                ) : (
                  profiles.map((profile) => {
                    const active = profile.id === activeProfileId;
                    return (
                      <Link
                        key={profile.id}
                        href={`/admin?profileId=${profile.id}&scope=${scope}`}
                        style={{
                          padding: 14,
                          borderRadius: 14,
                          border: `1px solid ${active ? "rgba(24, 90, 219, 0.35)" : "var(--border)"}`,
                          background: active ? "rgba(24, 90, 219, 0.07)" : "#fff",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <strong style={{ wordBreak: "break-word" }}>{profile.sourceUrl}</strong>
                        <span style={{ color: "var(--muted)", fontSize: 14 }}>
                          {profile.status} / {profile.fetchStatus}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 13 }}>
                          Updated {new Date(profile.updatedAt).toLocaleString()}
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          <section style={{ display: "grid", gap: 18 }}>
            <section style={cardStyle}>
              <div style={{ padding: 20, display: "grid", gap: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ margin: 0 }}>Profile Detail</h2>
                    <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                      Queue state, raw JSON, and profile summary for the selected interviewer.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <ScopePill active={scope === "all"} href={`/admin?profileId=${activeProfileId}&scope=all`}>
                      All Events
                    </ScopePill>
                    <ScopePill active={scope === "persona"} href={`/admin?profileId=${activeProfileId}&scope=persona`}>
                      Persona Only
                    </ScopePill>
                    <ScopePill active={scope === "session"} href={`/admin?profileId=${activeProfileId}&scope=session`}>
                      Session Only
                    </ScopePill>
                  </div>
                </div>

                {detail ? (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gap: 16,
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      }}
                    >
                      <MetricCard label="Profile Status" value={`${detail.profile.status} / ${detail.profile.fetchStatus}`} />
                      <MetricCard label="Source Type" value={detail.profile.sourceType} />
                      <MetricCard label="Role Guess" value={[detail.profile.currentRole, detail.profile.currentCompany].filter(Boolean).join(" at ") || "Unknown"} />
                      <MetricCard label="Job State" value={detail.job?.state ?? "No active BullMQ job"} />
                    </div>

                    {detail.sessionSummary ? (
                      <div
                        style={{
                          display: "grid",
                          gap: 16,
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        }}
                      >
                        <MetricCard label="Latest Session Stage" value={detail.sessionSummary.currentStageLabel} />
                        <MetricCard label="Latest Code Run" value={detail.sessionSummary.latestCodeRunStatus ?? "No runs yet"} />
                        <MetricCard label="Hints Served" value={String(detail.sessionSummary.hintCount)} />
                        <MetricCard label="Failed Runs" value={String(detail.sessionSummary.failedRunCount)} />
                      </div>
                    ) : null}

                    <div style={panelStyle}>
                      <strong>Persona Summary</strong>
                      <p style={{ marginBottom: 0, color: "var(--muted)" }}>
                        {detail.profile.personaSummary ?? "No persona summary prepared yet."}
                      </p>
                    </div>

                    {detail.sessionSummary ? (
                      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                        <div style={panelStyle}>
                          <strong>Latest Candidate State</strong>
                          {detail.sessionSummary.latestSignals ? (
                            <dl style={definitionListStyle}>
                              {Object.entries(detail.sessionSummary.latestSignals).map(([key, value]) => (
                                <div key={key} style={definitionRowStyle}>
                                  <dt style={definitionTermStyle}>{formatLabel(key)}</dt>
                                  <dd style={definitionValueStyle}>
                                    {Array.isArray(value) ? value.join(", ") : String(value)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No signal snapshot recorded yet.</p>
                          )}
                        </div>

                        <div style={panelStyle}>
                          <strong>Latest Interviewer Decision</strong>
                          {detail.sessionSummary.latestDecision ? (
                            <dl style={definitionListStyle}>
                              {Object.entries(detail.sessionSummary.latestDecision).map(([key, value]) => (
                                <div key={key} style={definitionRowStyle}>
                                  <dt style={definitionTermStyle}>{formatLabel(key)}</dt>
                                  <dd style={definitionValueStyle}>
                                    {Array.isArray(value) ? value.join(", ") : String(value)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No decision snapshot recorded yet.</p>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {detail.sessionSummary ? (
                      <div style={panelStyle}>
                        <strong>Stage Journey</strong>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                          {detail.sessionSummary.stageJourney.length > 0 ? (
                            detail.sessionSummary.stageJourney.map((stage) => (
                              <Badge key={stage} tone="info">
                                {stage}
                              </Badge>
                            ))
                          ) : (
                            <span style={{ color: "var(--muted)" }}>No stage transitions recorded yet.</span>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {detail.sessionSummary ? (
                      <div style={panelStyle}>
                        <strong>Session State Timeline</strong>
                        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                          {detail.sessionSummary.timeline.length > 0 ? (
                            detail.sessionSummary.timeline.map((item) => (
                              <article key={item.id} style={miniTimelineCardStyle}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <Badge tone={item.kind === "signal" || item.kind === "decision" ? "info" : "neutral"}>
                                      {item.kind}
                                    </Badge>
                                    <strong>{item.title}</strong>
                                  </div>
                                  <span style={{ color: "var(--muted)", fontSize: 13 }}>
                                    {new Date(item.at).toLocaleString()}
                                  </span>
                                </div>
                                <div style={{ color: "var(--muted)" }}>{item.summary}</div>
                                <details>
                                  <summary style={{ cursor: "pointer", color: "var(--accent-strong)", fontWeight: 700 }}>
                                    View payload
                                  </summary>
                                  <pre style={miniPreStyle}>{JSON.stringify(item.payload, null, 2)}</pre>
                                </details>
                              </article>
                            ))
                          ) : (
                            <span style={{ color: "var(--muted)" }}>No state timeline items recorded yet.</span>
                          )}
                        </div>
                      </div>
                    ) : null}

                    <details style={panelStyle}>
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>View Raw Job Status JSON</summary>
                      <pre style={preStyle}>{JSON.stringify(detail.job, null, 2)}</pre>
                    </details>
                  </>
                ) : (
                  <div style={emptyStyle}>Select a profile to inspect its queue and event history.</div>
                )}
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ padding: 20, display: "grid", gap: 16 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Unified Operations Feed</h2>
                  <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                    Persona queue events and session lifecycle events rendered in a single timeline.
                  </p>
                </div>

                {feed.length === 0 ? (
                  <div style={emptyStyle}>No operations events available for this selection yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {feed.map((event) => (
                      <article key={`${event.source}-${event.id}`} style={timelineCardStyle}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <Badge tone={event.source === "persona" ? "info" : "neutral"}>
                                {event.source}
                              </Badge>
                              <strong>{event.title}</strong>
                            </div>
                            <span style={{ color: "var(--muted)" }}>{event.description}</span>
                          </div>
                          <span style={{ color: "var(--muted)", fontSize: 14 }}>
                            {new Date(event.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {event.sessionId ? <Badge tone="neutral">session {event.sessionId}</Badge> : null}
                          {event.interviewerProfileId ? <Badge tone="neutral">profile {event.interviewerProfileId}</Badge> : null}
                          <Badge tone="neutral">{event.eventType}</Badge>
                        </div>
                        <details>
                          <summary style={{ cursor: "pointer", color: "var(--accent-strong)", fontWeight: 700 }}>
                            View payload
                          </summary>
                          <pre style={preStyle}>{JSON.stringify(event.payloadJson, null, 2)}</pre>
                        </details>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </section>
        </section>
      </div>
    </main>
  );
}

function ScopePill({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        padding: "10px 14px",
        borderRadius: 999,
        border: `1px solid ${active ? "rgba(24, 90, 219, 0.35)" : "var(--border)"}`,
        background: active ? "rgba(24, 90, 219, 0.07)" : "#fff",
        fontWeight: 700,
      }}
    >
      {children}
    </Link>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={panelStyle}>
      <div style={{ color: "var(--muted)", fontSize: 14 }}>{label}</div>
      <strong style={{ display: "block", marginTop: 8 }}>{value}</strong>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "info" | "neutral";
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: tone === "info" ? "rgba(24, 90, 219, 0.08)" : "var(--surface-alt)",
        color: tone === "info" ? "var(--accent-strong)" : "var(--muted)",
        fontSize: 13,
      }}
    >
      {children}
    </span>
  );
}

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow)",
} as const;

const panelStyle = {
  padding: 16,
  borderRadius: 16,
  border: "1px solid var(--border)",
  background: "#fff",
} as const;

const timelineCardStyle = {
  padding: 16,
  borderRadius: 16,
  border: "1px solid var(--border)",
  background: "#fff",
  display: "grid",
  gap: 12,
} as const;

const miniTimelineCardStyle = {
  padding: 14,
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--surface-alt)",
  display: "grid",
  gap: 10,
} as const;

const preStyle = {
  margin: "12px 0 0",
  padding: 16,
  borderRadius: 12,
  background: "#1d2230",
  color: "#ebf0ff",
  overflowX: "auto" as const,
  fontSize: 13,
} as const;

const miniPreStyle = {
  ...preStyle,
  fontSize: 12,
  padding: 12,
} as const;

const emptyStyle = {
  padding: 18,
  borderRadius: 16,
  border: "1px dashed var(--border)",
  color: "var(--muted)",
  background: "rgba(255,255,255,0.65)",
} as const;

const definitionListStyle = {
  display: "grid",
  gap: 10,
  marginTop: 12,
} as const;

const definitionRowStyle = {
  display: "grid",
  gap: 4,
  paddingBottom: 10,
  borderBottom: "1px solid var(--border)",
} as const;

const definitionTermStyle = {
  fontSize: 13,
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: 0.4,
} as const;

const definitionValueStyle = {
  margin: 0,
  color: "var(--text)",
  whiteSpace: "pre-wrap" as const,
} as const;

const topLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 16px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "#fff",
  fontWeight: 700,
} as const;

function formatLabel(value: string) {
  return value.replace(/([A-Z])/g, " $1").replaceAll("_", " ").trim();
}
