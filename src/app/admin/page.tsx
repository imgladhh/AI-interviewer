import Link from "next/link";
import { buildUnifiedOpsFeed, getAdminProfileDetail, listAdminProfiles, type OpsFeedScope } from "@/lib/admin/ops";
import { derivePolicyTuningSuggestions, runPolicyRegressionLab } from "@/lib/assistant/policy-regression";

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
  const policyLab = runPolicyRegressionLab();
  const tuningSuggestions = derivePolicyTuningSuggestions(policyLab);

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
                      <section style={panelStyle}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <strong>Executive Summary</strong>
                          <p style={{ margin: 0, color: "var(--muted)" }}>
                            Start here for the current operating picture: stage, latest move, policy posture, and whether an invariant overrode the default path.
                          </p>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gap: 12,
                            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                            marginTop: 14,
                          }}
                        >
                          <MetricCard label="Current Stage" value={detail.sessionSummary.currentStageLabel} />
                          <MetricCard
                            label="Latest Decision"
                            value={String(detail.sessionSummary.latestDecision?.action ?? "No decision yet")}
                          />
                          <MetricCard
                            label="Policy Archetype"
                            value={String(detail.sessionSummary.latestDecision?.policyArchetype ?? "unknown")}
                          />
                          <MetricCard
                            label="Invariant Override"
                            value={String(detail.sessionSummary.latestDecision?.blockedByInvariant ?? "none")}
                          />
                          <MetricCard
                            label="Latest Intent"
                            value={String(detail.sessionSummary.latestIntent?.intent ?? "unknown")}
                          />
                          <MetricCard
                            label="Trajectory"
                            value={String(detail.sessionSummary.latestTrajectory?.candidateTrajectory ?? "unknown")}
                          />
                          <MetricCard
                            label="DNA Mode"
                            value={String(detail.sessionSummary.latestCandidateDna?.recommendedMode ?? "unknown")}
                          />
                          <MetricCard
                            label="Shadow Policy"
                            value={String(detail.sessionSummary.latestShadowPolicy?.archetype ?? "unknown")}
                          />
                          <MetricCard
                            label="Timing Quality"
                            value={String(detail.sessionSummary.sessionCritic?.timingQuality ?? "unknown")}
                          />
                          <MetricCard
                            label="Closure Quality"
                            value={String(detail.sessionSummary.sessionCritic?.closureQuality ?? "unknown")}
                          />
                          <MetricCard
                            label="Transcript Truth"
                            value={
                              detail.sessionSummary.transcriptTruth
                                ? `${detail.sessionSummary.transcriptTruth.activeCommittedCount} active / ${detail.sessionSummary.transcriptTruth.supersededCount} superseded`
                                : "unknown"
                            }
                          />
                        </div>
                      </section>
                    ) : null}

                    {detail.sessionSummary ? (
                      <section style={panelStyle}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <strong>Transcript Truth</strong>
                          <p style={{ margin: 0, color: "var(--muted)" }}>
                            Truth Engine audit summary for the latest session. Active committed turns are the only turns that should influence decision, report, and replay.
                          </p>
                        </div>
                        {detail.sessionSummary.transcriptTruth ? (
                          <div
                            style={{
                              display: "grid",
                              gap: 12,
                              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                              marginTop: 14,
                            }}
                          >
                            <MetricCard label="Total Segments" value={String(detail.sessionSummary.transcriptTruth.totalSegments)} />
                            <MetricCard label="Pending" value={String(detail.sessionSummary.transcriptTruth.pendingCount)} />
                            <MetricCard label="Committed" value={String(detail.sessionSummary.transcriptTruth.committedCount)} />
                            <MetricCard label="Active Committed" value={String(detail.sessionSummary.transcriptTruth.activeCommittedCount)} />
                            <MetricCard label="Superseded" value={String(detail.sessionSummary.transcriptTruth.supersededCount)} />
                            <MetricCard label="Versioned" value={String(detail.sessionSummary.transcriptTruth.versionedCount)} />
                          </div>
                        ) : (
                          <p style={{ margin: "12px 0 0", color: "var(--muted)" }}>No transcript audit state available yet.</p>
                        )}
                      </section>
                    ) : null}

                    {detail.sessionSummary ? (
                      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                        <div style={panelStyle}>
                          <strong>Latest Candidate State</strong>
                          {detail.sessionSummary.latestSignals ? (
                            <>
                              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 12, marginBottom: 12 }}>
                                <MetricCard label="Reasoning Depth" value={String(detail.sessionSummary.latestSignals.reasoningDepth ?? "unknown")} />
                                <MetricCard label="Testing Discipline" value={String(detail.sessionSummary.latestSignals.testingDiscipline ?? "unknown")} />
                                <MetricCard label="Complexity Rigor" value={String(detail.sessionSummary.latestSignals.complexityRigor ?? "unknown")} />
                                <MetricCard
                                  label="Signal Confidence"
                                  value={
                                    typeof detail.sessionSummary.latestSignals.confidence === "number"
                                      ? `${Math.round(detail.sessionSummary.latestSignals.confidence * 100)}%`
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Candidate Ceiling"
                                  value={String(detail.sessionSummary.latentCalibration?.candidateCeiling ?? "unknown")}
                                />
                                <MetricCard
                                  label="Ease Of Execution"
                                  value={String(detail.sessionSummary.latentCalibration?.easeOfExecution ?? "unknown")}
                                />
                                <MetricCard
                                  label="Level Up Ready"
                                  value={
                                    typeof detail.sessionSummary.latentCalibration?.levelUpReady === "boolean"
                                      ? detail.sessionSummary.latentCalibration.levelUpReady
                                        ? "Yes"
                                        : "No"
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Verdict Confidence"
                                  value={
                                    typeof detail.sessionSummary.latentCalibration?.confidenceInVerdict === "number"
                                      ? `${Math.round(detail.sessionSummary.latentCalibration.confidenceInVerdict * 100)}%`
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Coding Burst"
                                  value={
                                    typeof detail.sessionSummary.flowState?.codingBurst === "boolean"
                                      ? detail.sessionSummary.flowState.codingBurst
                                        ? "Yes"
                                        : "No"
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Thinking Burst"
                                  value={
                                    typeof detail.sessionSummary.flowState?.thinkingBurst === "boolean"
                                      ? detail.sessionSummary.flowState.thinkingBurst
                                        ? "Yes"
                                        : "No"
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Mute Until Pause"
                                  value={
                                    typeof detail.sessionSummary.flowState?.muteUntilPause === "boolean"
                                      ? detail.sessionSummary.flowState.muteUntilPause
                                        ? "Yes"
                                        : "No"
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Context Reset Cost"
                                  value={String(detail.sessionSummary.flowState?.contextReestablishmentCost ?? "unknown")}
                                />
                              </div>
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
                              {Array.isArray(detail.sessionSummary.latestSignals.structuredEvidence) && detail.sessionSummary.latestSignals.structuredEvidence.length > 0 ? (
                                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                                  <strong>Observed Issues</strong>
                                  {groupStructuredEvidence(detail.sessionSummary.latestSignals.structuredEvidence).map((group) => (
                                    <div key={`admin-structured-group-${group.label}`} style={{ display: "grid", gap: 10 }}>
                                      <strong>{group.label}</strong>
                                      {group.items.map((item, index) => {
                                        const evidenceItem = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
                                        return (
                                          <div key={`admin-structured-evidence-${group.label}-${index}`} style={panelStyle}>
                                            <strong>{String(evidenceItem.issue ?? "Observed issue")}</strong>
                                            <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
                                              {String(evidenceItem.evidence ?? evidenceItem.behavior ?? "No concrete evidence captured.")}
                                            </p>
                                            {evidenceItem.impact ? (
                                              <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
                                                <strong>Impact:</strong> {String(evidenceItem.impact)}
                                              </p>
                                            ) : null}
                                            {evidenceItem.fix ? (
                                              <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
                                                <strong>Fix:</strong> {String(evidenceItem.fix)}
                                              </p>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {detail.sessionSummary.unresolvedIssues.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Unresolved Issues</strong>
                                  {detail.sessionSummary.unresolvedIssues.map((item) => (
                                    <div key={`admin-unresolved-${item}`} style={panelStyle}>
                                      {item}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {detail.sessionSummary.answeredTargets.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Answered Targets</strong>
                                  {detail.sessionSummary.answeredTargets.map((item) => (
                                    <div key={`admin-answered-target-${item}`} style={panelStyle}>
                                      {item}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {detail.sessionSummary.collectedEvidence.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Collected Evidence</strong>
                                  {detail.sessionSummary.collectedEvidence.map((item) => (
                                    <div key={`admin-collected-evidence-${item}`} style={panelStyle}>
                                      {item}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {detail.sessionSummary.missingEvidence.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Missing Evidence</strong>
                                  {detail.sessionSummary.missingEvidence.map((item) => (
                                    <div key={`admin-missing-evidence-${item}`} style={panelStyle}>
                                      {item}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No signal snapshot recorded yet.</p>
                          )}
                        </div>

                        <div style={panelStyle}>
                          <strong>Latest Interviewer Decision</strong>
                          {detail.sessionSummary.latestDecision ? (
                            <>
                              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 12, marginBottom: 12 }}>
                                <MetricCard
                                  label="Decision Confidence"
                                  value={
                                    typeof detail.sessionSummary.latestDecision.confidence === "number"
                                      ? `${Math.round(Number(detail.sessionSummary.latestDecision.confidence) * 100)}%`
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Unified Action"
                                  value={String(detail.sessionSummary.latestDecision.normalizedAction ?? "unknown")}
                                />
                                <MetricCard
                                  label="Total Score"
                                  value={
                                    typeof detail.sessionSummary.latestDecision.totalScore === "number"
                                      ? detail.sessionSummary.latestDecision.totalScore.toFixed(2)
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Pressure"
                                  value={String(detail.sessionSummary.latestDecision.pressure ?? "unknown")}
                                />
                                <MetricCard
                                  label="Worth Asking"
                                  value={
                                    typeof detail.sessionSummary.latestCritic?.questionWorthAsking === "boolean"
                                      ? detail.sessionSummary.latestCritic.questionWorthAsking
                                        ? "Yes"
                                        : "No"
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Timing Verdict"
                                  value={String(detail.sessionSummary.latestCritic?.timingVerdict ?? "unknown")}
                                />
                                <MetricCard
                                  label="Urgency"
                                  value={String(
                                    detail.sessionSummary.latestCritic?.urgency ??
                                      detail.sessionSummary.latestDecision.urgency ??
                                      "unknown",
                                  )}
                                />
                                <MetricCard
                                  label="Interruption Cost"
                                  value={String(
                                    detail.sessionSummary.latestCritic?.interruptionCost ??
                                      detail.sessionSummary.latestDecision.interruptionCost ??
                                      "unknown",
                                  )}
                                />
                                <MetricCard
                                  label="Policy Archetype"
                                  value={String(detail.sessionSummary.latestDecision.policyArchetype ?? "unknown")}
                                />
                                <MetricCard
                                  label="Policy Mode"
                                  value={String(detail.sessionSummary.latestDecision.policyMode ?? "unknown")}
                                />
                                <MetricCard
                                  label="Weight N/T/V/C"
                                  value={
                                    detail.sessionSummary.latestDecision.scoreWeightProfile
                                      ? `${numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "need")?.toFixed(2) ?? "n/a"} / ${numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "timing")?.toFixed(2) ?? "n/a"} / ${numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "value")?.toFixed(2) ?? "n/a"} / ${numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "closure")?.toFixed(2) ?? "n/a"}`
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Dominant Action Bias"
                                  value={stringField(detail.sessionSummary.latestDecision.scoreWeightProfile, "dominantActionBias") ?? "unknown"}
                                />
                                <MetricCard
                                  label="Action Bias Spread"
                                  value={
                                    typeof numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "actionBiasSpread") === "number"
                                      ? Number(numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "actionBiasSpread")).toFixed(2)
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Temporal Weights"
                                  value={
                                    detail.sessionSummary.latestDecision.scoreWeightProfile
                                      ? `${numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "temporalProbeDecay")?.toFixed(2) ?? "n/a"} / ${numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "temporalIdleProbeBoost")?.toFixed(2) ?? "n/a"} / ${numberField(detail.sessionSummary.latestDecision.scoreWeightProfile, "temporalCodingInterruptionPenalty")?.toFixed(2) ?? "n/a"}`
                                      : "unknown"
                                  }
                                />
                                <MetricCard
                                  label="Blocked By Invariant"
                                  value={String(detail.sessionSummary.latestDecision.blockedByInvariant ?? "none")}
                                />
                              </div>
                              {Array.isArray(detail.sessionSummary.latestDecision.decisionPathway) &&
                              detail.sessionSummary.latestDecision.decisionPathway.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Decision Pathway</strong>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {detail.sessionSummary.latestDecision.decisionPathway.map((step) => (
                                      <span
                                        key={`admin-decision-pathway-${step}`}
                                        style={{
                                          ...stagePillStyle,
                                          background:
                                            typeof step === "string" && step.startsWith("Invariant(")
                                              ? "rgba(220, 120, 24, 0.12)"
                                              : typeof step === "string" && step.startsWith("Policy(")
                                                ? "rgba(24, 90, 219, 0.08)"
                                                : "rgba(12, 114, 68, 0.10)",
                                          color:
                                            typeof step === "string" && step.startsWith("Invariant(")
                                              ? "#9a4d00"
                                              : typeof step === "string" && step.startsWith("Policy(")
                                                ? "var(--accent-strong)"
                                                : "#0a6b45",
                                        }}
                                      >
                                        {String(step)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
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
                              {detail.sessionSummary.evidenceFocus ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Evidence Focus This Turn</strong>
                                  <div style={panelStyle}>{detail.sessionSummary.evidenceFocus}</div>
                                </div>
                              ) : null}
                              {detail.sessionSummary.latestCritic?.batchGroup ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Deferred Batch Group</strong>
                                  <div style={panelStyle}>{String(detail.sessionSummary.latestCritic.batchGroup)}</div>
                                </div>
                              ) : null}
                              {detail.sessionSummary.latestCritic?.worthReason ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Worth Reason</strong>
                                  <div style={panelStyle}>{String(detail.sessionSummary.latestCritic.worthReason)}</div>
                                </div>
                              ) : null}
                              {detail.sessionSummary.latestDecision.justificationWhyNow ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Why Now</strong>
                                  <div style={panelStyle}>{String(detail.sessionSummary.latestDecision.justificationWhyNow)}</div>
                                </div>
                              ) : null}
                              {Array.isArray(detail.sessionSummary.latestDecision.scoreBreakdown) &&
                              detail.sessionSummary.latestDecision.scoreBreakdown.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Score Breakdown</strong>
                                  <div style={{ ...panelStyle, display: "grid", gap: 8 }}>
                                    {detail.sessionSummary.latestDecision.scoreBreakdown.map((item, index) => (
                                      <div key={`admin-score-breakdown-${index}`} style={{ display: "grid", gap: 2 }}>
                                        <div style={{ fontWeight: 600 }}>
                                          {String(item.key ?? "score")} · {typeof item.magnitude === "number" ? item.magnitude.toFixed(2) : "n/a"}
                                        </div>
                                        <div style={{ color: "var(--muted-foreground)" }}>{String(item.detail ?? "")}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {Array.isArray(detail.sessionSummary.latestDecision.candidateScores) &&
                              detail.sessionSummary.latestDecision.candidateScores.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Candidate Score Surface</strong>
                                  <div style={{ ...panelStyle, display: "grid", gap: 6 }}>
                                    {detail.sessionSummary.latestDecision.candidateScores.map((item, index) => (
                                      <div key={`admin-candidate-score-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                        <span>{String(item.action ?? "unknown")}</span>
                                        <span>
                                          {typeof item.totalScore === "number" ? item.totalScore.toFixed(2) : "n/a"}
                                          {item.hardMasked ? " (masked)" : ""}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {detail.sessionSummary.latestDecision.tieBreaker ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Tie-breaker</strong>
                                  <div style={panelStyle}>{String(detail.sessionSummary.latestDecision.tieBreaker)}</div>
                                </div>
                              ) : null}
                              {detail.sessionSummary.latestDecision.justificationWhyThisAction ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Why This Action</strong>
                                  <div style={panelStyle}>{String(detail.sessionSummary.latestDecision.justificationWhyThisAction)}</div>
                                </div>
                              ) : null}
                              {detail.sessionSummary.latestDecision.policyAdaptationReason ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Policy Adaptation</strong>
                                  <div style={panelStyle}>{String(detail.sessionSummary.latestDecision.policyAdaptationReason)}</div>
                                </div>
                              ) : null}
                              {Array.isArray(detail.sessionSummary.latestDecision.supportingSignals) &&
                              detail.sessionSummary.latestDecision.supportingSignals.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Supporting Signals</strong>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {detail.sessionSummary.latestDecision.supportingSignals.map((item) => (
                                      <span key={`admin-supporting-signal-${item}`} style={stagePillStyle}>
                                        {String(item)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {Array.isArray(detail.sessionSummary.latestCritic?.autoCapturedEvidence) && detail.sessionSummary.latestCritic.autoCapturedEvidence.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Auto-captured Evidence</strong>
                                  <div style={panelStyle}>{detail.sessionSummary.latestCritic.autoCapturedEvidence.join(", ")}</div>
                                </div>
                              ) : null}
                              {typeof detail.sessionSummary.latestCritic?.selfCorrectionWindowSeconds === "number" ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Self-correction Window</strong>
                                  <div style={panelStyle}>
                                    {detail.sessionSummary.latestCritic.selfCorrectionWindowSeconds}s
                                    {detail.sessionSummary.latestCritic.wouldLikelySelfCorrect ? " / likely self-correct" : ""}
                                  </div>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No decision snapshot recorded yet.</p>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {detail.sessionSummary ? (
                      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                        <div style={panelStyle}>
                          <strong>Latest Intent</strong>
                          {detail.sessionSummary.latestIntent ? (
                            <>
                              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 12, marginBottom: 12 }}>
                                <MetricCard label="Intent" value={String(detail.sessionSummary.latestIntent.intent ?? "unknown")} />
                                <MetricCard label="Target Signal" value={String(detail.sessionSummary.latestIntent.targetSignal ?? "unknown")} />
                                <MetricCard label="Expected Outcome" value={String(detail.sessionSummary.latestIntent.expectedOutcome ?? "unknown")} />
                                <MetricCard label="Urgency" value={String(detail.sessionSummary.latestIntent.urgency ?? "unknown")} />
                                <MetricCard
                                  label="Can Defer"
                                  value={
                                    typeof detail.sessionSummary.latestIntent.canDefer === "boolean"
                                      ? detail.sessionSummary.latestIntent.canDefer
                                        ? "Yes"
                                        : "No"
                                      : "unknown"
                                  }
                                />
                              </div>
                              <dl style={definitionListStyle}>
                                {Object.entries(detail.sessionSummary.latestIntent).map(([key, value]) => (
                                  <div key={key} style={definitionRowStyle}>
                                    <dt style={definitionTermStyle}>{formatLabel(key)}</dt>
                                    <dd style={definitionValueStyle}>
                                      {Array.isArray(value) ? value.join(", ") : String(value)}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                              {Array.isArray(detail.sessionSummary.latestIntent.competingIntents) &&
                              detail.sessionSummary.latestIntent.competingIntents.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Competing Intents</strong>
                                  <div style={{ display: "grid", gap: 8 }}>
                                    {detail.sessionSummary.latestIntent.competingIntents.map((item, index) => (
                                      <div key={`admin-competing-intent-${index}`} style={panelStyle}>
                                        <strong>{String(item.intent ?? "unknown")}</strong>
                                        {item.score !== undefined ? ` (${Math.round(Number(item.score) * 100)}%)` : ""}
                                        {item.reason ? ` - ${String(item.reason)}` : ""}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No intent snapshot recorded yet.</p>
                          )}
                        </div>

                        <div style={panelStyle}>
                          <strong>Latest Trajectory</strong>
                          {detail.sessionSummary.latestTrajectory ? (
                            <>
                              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 12, marginBottom: 12 }}>
                                <MetricCard label="Trajectory" value={String(detail.sessionSummary.latestTrajectory.candidateTrajectory ?? "unknown")} />
                                <MetricCard label="No Intervention" value={String(detail.sessionSummary.latestTrajectory.expectedWithNoIntervention ?? "unknown")} />
                                <MetricCard label="Best Intervention" value={String(detail.sessionSummary.latestTrajectory.bestIntervention ?? "unknown")} />
                                <MetricCard label="Intervention Value" value={String(detail.sessionSummary.latestTrajectory.interventionValue ?? "unknown")} />
                                <MetricCard label="Evidence Gain" value={String(detail.sessionSummary.latestTrajectory.evidenceGainIfAskNow ?? "unknown")} />
                                <MetricCard label="Interrupt Cost" value={String(detail.sessionSummary.latestTrajectory.interruptionCost ?? "unknown")} />
                              </div>
                              <dl style={definitionListStyle}>
                                {Object.entries(detail.sessionSummary.latestTrajectory).map(([key, value]) => (
                                  <div key={key} style={definitionRowStyle}>
                                    <dt style={definitionTermStyle}>{formatLabel(key)}</dt>
                                    <dd style={definitionValueStyle}>
                                      {Array.isArray(value) ? value.join(", ") : String(value)}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No trajectory snapshot recorded yet.</p>
                          )}
                        </div>

                        <div style={panelStyle}>
                          <strong>Session Critic</strong>
                          {detail.sessionSummary.sessionCritic ? (
                            <>
                              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 12, marginBottom: 12 }}>
                                <MetricCard label="Redundancy" value={`${detail.sessionSummary.sessionCritic.redundancyScore}/100`} />
                                <MetricCard label="Interruptions" value={`${detail.sessionSummary.sessionCritic.interruptionScore}/100`} />
                                <MetricCard label="Pressure Balance" value={detail.sessionSummary.sessionCritic.pressureBalance} />
                                <MetricCard label="Flow Preservation" value={detail.sessionSummary.sessionCritic.flowPreservation} />
                                <MetricCard label="Timing Quality" value={detail.sessionSummary.sessionCritic.timingQuality} />
                                <MetricCard label="Closure Quality" value={detail.sessionSummary.sessionCritic.closureQuality} />
                              </div>
                              {detail.sessionSummary.sessionCritic.notes.length > 0 ? (
                                <div style={{ display: "grid", gap: 8 }}>
                                  {detail.sessionSummary.sessionCritic.notes.map((note, index) => (
                                    <div key={`admin-session-critic-note-${index}`} style={panelStyle}>
                                      {note}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No session-level critic summary yet.</p>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {detail.sessionSummary ? (
                      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                        <div style={panelStyle}>
                          <strong>Latest Candidate DNA</strong>
                          {detail.sessionSummary.latestCandidateDna ? (
                            <>
                              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 12, marginBottom: 12 }}>
                                <MetricCard label="Mode" value={String(detail.sessionSummary.latestCandidateDna.recommendedMode ?? "unknown")} />
                                <MetricCard
                                  label="Reasoning"
                                  value={String(asPercent(detail.sessionSummary.latestCandidateDna.vector, "reasoning"))}
                                />
                                <MetricCard
                                  label="Implementation"
                                  value={String(asPercent(detail.sessionSummary.latestCandidateDna.vector, "implementation"))}
                                />
                                <MetricCard
                                  label="Coachability"
                                  value={String(asPercent(detail.sessionSummary.latestCandidateDna.vector, "coachability"))}
                                />
                                <MetricCard
                                  label="Independence"
                                  value={String(asPercent(detail.sessionSummary.latestCandidateDna.vector, "independence"))}
                                />
                              </div>
                              {Array.isArray(detail.sessionSummary.latestCandidateDna.dominantTraits) &&
                              detail.sessionSummary.latestCandidateDna.dominantTraits.length > 0 ? (
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                                  {detail.sessionSummary.latestCandidateDna.dominantTraits.map((trait) => (
                                    <span key={`admin-dna-trait-${trait}`} style={stagePillStyle}>
                                      {String(trait)}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              <dl style={definitionListStyle}>
                                {Object.entries(detail.sessionSummary.latestCandidateDna).map(([key, value]) => (
                                  <div key={key} style={definitionRowStyle}>
                                    <dt style={definitionTermStyle}>{formatLabel(key)}</dt>
                                    <dd style={definitionValueStyle}>
                                      {Array.isArray(value) ? value.join(", ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No candidate DNA snapshot recorded yet.</p>
                          )}
                        </div>

                        <div style={panelStyle}>
                          <strong>Latest Shadow Policy</strong>
                          {detail.sessionSummary.latestShadowPolicy ? (
                            <>
                              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 12, marginBottom: 12 }}>
                                <MetricCard label="Archetype" value={String(detail.sessionSummary.latestShadowPolicy.archetype ?? "unknown")} />
                                <MetricCard label="Action" value={String(detail.sessionSummary.latestShadowPolicy.action ?? "unknown")} />
                                <MetricCard label="Target" value={String(detail.sessionSummary.latestShadowPolicy.target ?? "unknown")} />
                                <MetricCard label="Pressure" value={String(detail.sessionSummary.latestShadowPolicy.pressure ?? "unknown")} />
                                <MetricCard label="Timing" value={String(detail.sessionSummary.latestShadowPolicy.timing ?? "unknown")} />
                              </div>
                              {Array.isArray(detail.sessionSummary.latestShadowPolicy.diff) &&
                              detail.sessionSummary.latestShadowPolicy.diff.length > 0 ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Diff Against Actual Policy</strong>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {detail.sessionSummary.latestShadowPolicy.diff.map((item) => (
                                      <span key={`admin-shadow-diff-${item}`} style={stagePillStyle}>
                                        {String(item)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {detail.sessionSummary.latestShadowPolicy.reason ? (
                                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                                  <strong>Shadow Reason</strong>
                                  <div style={panelStyle}>{String(detail.sessionSummary.latestShadowPolicy.reason)}</div>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>No shadow policy evaluation recorded yet.</p>
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
                      <details style={panelStyle}>
                        <summary style={sectionSummaryStyle}>Session State Timeline</summary>
                        <p style={{ margin: 0, color: "var(--muted)" }}>
                          Full turn-by-turn snapshots, pathway badges, and raw payloads for deeper debugging.
                        </p>
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
                                {item.evidenceFocus ? (
                                  <div style={{ color: "var(--muted)" }}>
                                    <strong>Evidence focus:</strong> {item.evidenceFocus}
                                  </div>
                                ) : null}
                                {item.intent || item.intentTargetSignal || item.expectedOutcome ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.intent ? <Badge tone="info">intent: {item.intent}</Badge> : null}
                                    {item.intentTargetSignal ? <Badge tone="neutral">target: {item.intentTargetSignal}</Badge> : null}
                                    {item.expectedOutcome ? <Badge tone="neutral">outcome: {item.expectedOutcome}</Badge> : null}
                                  </div>
                                ) : null}
                                {item.candidateTrajectory || item.expectedWithNoIntervention || item.bestIntervention ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.candidateTrajectory ? <Badge tone="info">trajectory: {item.candidateTrajectory}</Badge> : null}
                                    {item.expectedWithNoIntervention ? <Badge tone="neutral">no intervention: {item.expectedWithNoIntervention}</Badge> : null}
                                    {item.bestIntervention ? <Badge tone="neutral">best move: {item.bestIntervention}</Badge> : null}
                                    {item.interventionValue ? <Badge tone="neutral">value: {item.interventionValue}</Badge> : null}
                                    {item.expectedEvidenceGain ? <Badge tone="neutral">gain: {item.expectedEvidenceGain}</Badge> : null}
                                  </div>
                                ) : null}
                                {item.timingVerdict || item.urgency || item.interruptionCost ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.timingVerdict ? (
                                      <Badge tone="info">timing: {item.timingVerdict}</Badge>
                                    ) : null}
                                    {item.urgency ? (
                                      <Badge tone="neutral">urgency: {item.urgency}</Badge>
                                    ) : null}
                                    {item.interruptionCost ? (
                                      <Badge tone="neutral">interrupt: {item.interruptionCost}</Badge>
                                    ) : null}
                                    {item.batchGroup ? (
                                      <Badge tone="neutral">batch: {item.batchGroup}</Badge>
                                    ) : null}
                                  </div>
                                ) : null}
                                {item.policyArchetype || item.policyMode ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.policyArchetype ? <Badge tone="info">policy: {item.policyArchetype}</Badge> : null}
                                    {item.policyMode ? <Badge tone="neutral">mode: {item.policyMode}</Badge> : null}
                                  </div>
                                ) : null}
                                {item.decisionPathway && item.decisionPathway.length > 0 ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.decisionPathway.map((step) => (
                                      <Badge
                                        key={`${item.id}-path-${step}`}
                                        tone={
                                          step.startsWith("Invariant(")
                                            ? "warning"
                                            : step.startsWith("Policy(")
                                              ? "info"
                                              : "neutral"
                                        }
                                      >
                                        {step}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                                {item.policyAdaptationReason ? (
                                  <div style={{ color: "var(--muted)" }}>
                                    <strong>Policy adaptation:</strong> {item.policyAdaptationReason}
                                  </div>
                                ) : null}
                                {item.competingIntents && item.competingIntents.length > 0 ? (
                                  <div style={{ display: "grid", gap: 8 }}>
                                    <strong>Competing intents</strong>
                                    <div style={{ display: "grid", gap: 8 }}>
                                      {item.competingIntents.map((candidate, index) => (
                                        <div key={`${item.id}-competing-${index}`} style={panelStyle}>
                                          <strong>{candidate.intent ?? "unknown"}</strong>
                                          {candidate.score !== undefined ? ` (${Math.round(Number(candidate.score) * 100)}%)` : ""}
                                          {candidate.reason ? ` - ${candidate.reason}` : ""}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                {item.answeredTargets && item.answeredTargets.length > 0 ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.answeredTargets.slice(0, 4).map((target) => (
                                      <Badge key={`${item.id}-answered-${target}`} tone="neutral">
                                        answered: {target}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                                {item.collectedEvidence && item.collectedEvidence.length > 0 ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.collectedEvidence.slice(0, 4).map((evidence) => (
                                      <Badge key={`${item.id}-collected-${evidence}`} tone="info">
                                        collected: {evidence}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                                {item.unresolvedIssues && item.unresolvedIssues.length > 0 ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.unresolvedIssues.slice(0, 3).map((issue) => (
                                      <Badge key={`${item.id}-unresolved-${issue}`} tone="info">
                                        unresolved: {issue}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                                {item.missingEvidence && item.missingEvidence.length > 0 ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.missingEvidence.slice(0, 3).map((evidence) => (
                                      <Badge key={`${item.id}-missing-${evidence}`} tone="neutral">
                                        missing: {evidence}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                                {item.autoCapturedEvidence && item.autoCapturedEvidence.length > 0 ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.autoCapturedEvidence.slice(0, 3).map((evidence) => (
                                      <Badge key={`${item.id}-auto-${evidence}`} tone="info">
                                        auto-captured: {evidence}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                                {item.candidateCeiling || item.easeOfExecution || item.levelUpReady !== undefined || item.muteUntilPause !== undefined ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {item.candidateCeiling ? (
                                      <Badge tone="info">ceiling: {item.candidateCeiling}</Badge>
                                    ) : null}
                                    {item.easeOfExecution ? (
                                      <Badge tone="neutral">ease: {item.easeOfExecution}</Badge>
                                    ) : null}
                                    {typeof item.levelUpReady === "boolean" ? (
                                      <Badge tone="info">level-up: {item.levelUpReady ? "ready" : "not yet"}</Badge>
                                    ) : null}
                                    {typeof item.muteUntilPause === "boolean" ? (
                                      <Badge tone={item.muteUntilPause ? "info" : "neutral"}>
                                        flow: {item.muteUntilPause ? "mute until pause" : "open"}
                                      </Badge>
                                    ) : null}
                                    {item.contextReestablishmentCost ? (
                                      <Badge tone="neutral">context reset: {item.contextReestablishmentCost}</Badge>
                                    ) : null}
                                  </div>
                                ) : null}
                                {item.selfCorrectionWindowSeconds ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <Badge tone="info">self-correct: {item.selfCorrectionWindowSeconds}s</Badge>
                                    {item.wouldLikelySelfCorrect ? <Badge tone="info">likely self-correct</Badge> : null}
                                  </div>
                                ) : null}
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
                      </details>
                    ) : null}

                    <details style={panelStyle}>
                      <summary style={sectionSummaryStyle}>Raw Job Status JSON</summary>
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
                  <h2 style={{ margin: 0 }}>Policy Regression Lab</h2>
                  <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                    Golden scenarios rendered through multiple archetypes so policy differences stay visible and testable.
                  </p>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  <strong>Policy Tuning Suggestions</strong>
                  {tuningSuggestions.map((suggestion) => (
                    <div key={suggestion.id} style={panelStyle}>
                      <strong>{suggestion.title}</strong>
                      <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>{suggestion.rationale}</p>
                      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        {suggestion.recommendedAdjustments.map((item, index) => (
                          <div key={`${suggestion.id}-adj-${index}`} style={panelStyle}>
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gap: 14 }}>
                  {policyLab.map((scenario) => (
                    <article key={scenario.scenarioId} style={timelineCardStyle}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <strong>{scenario.label}</strong>
                          <Badge tone="neutral">{scenario.scenarioId}</Badge>
                          <Badge tone={scenario.divergentFields.length > 0 ? "info" : "neutral"}>
                            {scenario.divergentFields.length > 0 ? "policy diff" : "policy converge"}
                          </Badge>
                        </div>
                        <span style={{ color: "var(--muted)" }}>
                          {scenario.summary}
                        </span>
                        {scenario.scoreSpread ? (
                          <span style={{ color: "var(--muted)" }}>
                            score spread={scenario.scoreSpread.spread.toFixed(2)} ({scenario.scoreSpread.bestArchetype} best, {scenario.scoreSpread.weakestArchetype} weakest)
                          </span>
                        ) : null}
                        {scenario.rewardSpread ? (
                          <span style={{ color: "var(--muted)" }}>
                            reward spread={scenario.rewardSpread.spread.toFixed(2)} ({scenario.rewardSpread.bestArchetype} best, {scenario.rewardSpread.weakestArchetype} weakest)
                          </span>
                        ) : null}
                      </div>

                      {scenario.divergentFields.length > 0 ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {scenario.divergentFields.map((field) => (
                            <Badge key={`${scenario.scenarioId}-diff-${field}`} tone="info">
                              diff: {field}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      <div
                        style={{
                          display: "grid",
                          gap: 12,
                          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                        }}
                      >
                        {scenario.results.map((result) => (
                          <div key={`${scenario.scenarioId}-${result.archetype}`} style={panelStyle}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              <Badge tone="info">{result.archetype}</Badge>
                              <Badge tone="neutral">{result.action}</Badge>
                              {result.target ? <Badge tone="neutral">target: {result.target}</Badge> : null}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                              {typeof result.totalScore === "number" ? <Badge tone="info">score: {result.totalScore.toFixed(2)}</Badge> : null}
                              {typeof result.scoreGapFromBest === "number" ? <Badge tone="neutral">gap: {result.scoreGapFromBest.toFixed(2)}</Badge> : null}
                              {typeof result.averageReward === "number" ? <Badge tone="info">avg reward: {result.averageReward.toFixed(2)}</Badge> : null}
                              {typeof result.rewardGapFromBest === "number" ? <Badge tone="neutral">reward gap: {result.rewardGapFromBest.toFixed(2)}</Badge> : null}
                              {typeof result.cumulativeReward === "number" ? <Badge tone="neutral">cum reward: {result.cumulativeReward.toFixed(2)}</Badge> : null}
                              {result.pressure ? <Badge tone="info">pressure: {result.pressure}</Badge> : null}
                              {result.timing ? <Badge tone="neutral">timing: {result.timing}</Badge> : null}
                              {result.suggestedStage ? <Badge tone="neutral">stage: {result.suggestedStage}</Badge> : null}
                            </div>
                            {result.scoreWeightProfile ? (
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                                <Badge tone="neutral">w(n/t/v/c): {result.scoreWeightProfile.need.toFixed(2)}/{result.scoreWeightProfile.timing.toFixed(2)}/{result.scoreWeightProfile.value.toFixed(2)}/{result.scoreWeightProfile.closure.toFixed(2)}</Badge>
                                <Badge tone="info">bias: {result.scoreWeightProfile.dominantActionBias}</Badge>
                              </div>
                            ) : null}
                            {Array.isArray(result.decisionTimeline) && result.decisionTimeline.length > 0 ? (
                              <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                                <strong>Decision Timeline</strong>
                                <div style={{ display: "grid", gap: 8 }}>
                                  {result.decisionTimeline.map((turn) => (
                                    <div key={`${scenario.scenarioId}-${result.archetype}-turn-${turn.turn}`} style={panelStyle}>
                                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <Badge tone="neutral">turn {turn.turn}</Badge>
                                        <Badge tone="info">{turn.action}</Badge>
                                        <Badge tone="neutral">target: {turn.target}</Badge>
                                        {typeof turn.totalScore === "number" ? <Badge tone="info">score {turn.totalScore.toFixed(2)}</Badge> : null}
                                        {typeof turn.rewardTotal === "number" ? <Badge tone="neutral">reward {turn.rewardTotal.toFixed(2)}</Badge> : null}
                                      </div>
                                      {Array.isArray(turn.rewardPenalties) && turn.rewardPenalties.length > 0 ? (
                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                                          {turn.rewardPenalties.map((penalty) => (
                                            <Badge key={`${scenario.scenarioId}-${result.archetype}-penalty-${turn.turn}-${penalty}`} tone="warning">
                                              {penalty}
                                            </Badge>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {result.decisionPathway && result.decisionPathway.length > 0 ? (
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                                {result.decisionPathway.map((step) => (
                                  <Badge
                                    key={`${scenario.scenarioId}-${result.archetype}-${step}`}
                                    tone={
                                      step.startsWith("Invariant(")
                                        ? "warning"
                                        : step.startsWith("Policy(")
                                          ? "info"
                                          : "neutral"
                                    }
                                  >
                                    {step}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                            <p style={{ margin: 0, color: "var(--muted)" }}>{result.reason}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <details style={cardStyle}>
              <div style={{ padding: 20, display: "grid", gap: 16 }}>
                <summary style={sectionSummaryStyle}>Unified Operations Feed</summary>
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
            </details>
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
  tone: "info" | "neutral" | "warning";
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background:
          tone === "info"
            ? "rgba(24, 90, 219, 0.08)"
            : tone === "warning"
              ? "rgba(220, 120, 24, 0.14)"
              : "var(--surface-alt)",
        color:
          tone === "info"
            ? "var(--accent-strong)"
            : tone === "warning"
              ? "#9a4d00"
              : "var(--muted)",
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

const stagePillStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 10px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--surface-alt)",
  color: "var(--muted)",
  fontSize: 13,
  fontWeight: 600,
} as const;

const timelineCardStyle = {
  padding: 16,
  borderRadius: 16,
  border: "1px solid var(--border)",
  background: "#fff",
  display: "grid",
  gap: 12,
} as const;

const sectionSummaryStyle = {
  cursor: "pointer",
  fontWeight: 700,
  color: "var(--accent-strong)",
  marginBottom: 10,
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

function groupStructuredEvidence(evidence: unknown[]) {
  const groups = new Map<string, unknown[]>();

  for (const item of evidence) {
    const record = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const label = evidenceAreaLabel(typeof record.area === "string" ? record.area : undefined);
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
function formatLabel(value: string) {
  return value.replace(/([A-Z])/g, " $1").replaceAll("_", " ").trim();
}

function asPercent(vector: unknown, key: string) {
  if (typeof vector !== "object" || vector === null) {
    return "unknown";
  }

  const value = (vector as Record<string, unknown>)[key];
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "unknown";
}

function numberField(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : null;
}

function stringField(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : null;
}







