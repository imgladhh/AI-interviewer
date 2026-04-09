"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { PersonaJobStatus, PersonaUiState, SetupFormState } from "@/components/setup/types";

type PreviewResponse = {
  ok: boolean;
  data?: {
    normalizedUrl: string;
    sourceType: string;
    supported: boolean;
    message: string;
  };
  message?: string;
};

type PersonaResponse = {
  ok: boolean;
  data?: {
    id: string;
    status: string;
    fetchStatus: string;
    job?: PersonaJobStatus;
  };
  message?: string;
};

type PersonaStatusResponse = {
  ok: boolean;
  data?: {
    id: string;
    status: string;
    fetchStatus: string;
    fullName?: string | null;
    currentRole?: string | null;
    currentCompany?: string | null;
    personaSummary?: string | null;
    technicalFocus?: string[];
    likelyInterviewFocus?: string[];
    job?: PersonaJobStatus | null;
    events?: Array<{
      id: string;
      eventType: string;
      payloadJson: unknown;
      createdAt: string;
    }>;
  };
  message?: string;
};

type SessionResponse = {
  ok: boolean;
  data?: {
    sessionId: string;
    launch: {
      roomUrl: string;
    };
  };
  message?: string;
};

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow)",
} as const;

const panelStyle = {
  padding: 24,
  background: "var(--surface-alt)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
} as const;

const fieldStyle = {
  display: "grid",
  gap: 8,
} as const;

const inputStyle = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "12px 14px",
  background: "#fff",
} as const;

const buttonBase = {
  border: "none",
  borderRadius: "999px",
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
} as const;

const timelineStepBase = {
  display: "grid",
  gap: 6,
  padding: 14,
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "#fff",
} as const;

const selectOptions = {
  mode: ["CODING", "SYSTEM_DESIGN"] as const,
  targetLevel: ["NEW_GRAD", "SDE1", "SDE2", "SENIOR", "STAFF"] as const,
  selectedLanguage: ["Python", "Java", "C++", "JavaScript"] as const,
  companyStyle: ["GENERIC", "AMAZON", "META", "GOOGLE", "STRIPE"] as const,
};

const initialForm: SetupFormState = {
  mode: "CODING",
  targetLevel: "SDE2",
  selectedLanguage: "Python",
  companyStyle: "GENERIC",
  voiceEnabled: true,
  lowCostMode: true,
  interviewerProfileUrl: "",
};

export function InterviewSetupClient() {
  const router = useRouter();
  const [form, setForm] = useState<SetupFormState>(initialForm);
  const [personaState, setPersonaState] = useState<PersonaUiState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  const canStartTailored = personaState.kind === "persona_ready";
  const hasUrl = form.interviewerProfileUrl.trim().length > 0;
  const isSessionCreating = personaState.kind === "session_creating";

  useEffect(() => {
    if (personaState.kind !== "persona_processing" && personaState.kind !== "persona_queued") {
      return;
    }

    const interval = setInterval(async () => {
      const response = await fetch(`/api/interviewer-profiles/${personaState.profileId}`);
      const payload = (await response.json()) as PersonaStatusResponse;

      if (!payload.ok || !payload.data) {
        setPersonaState({
          kind: "persona_failed",
          profileId: personaState.profileId,
          message: payload.message ?? "Unable to load interviewer profile status.",
        });
        return;
      }

      const job = payload.data.job ?? undefined;
      if (payload.data.status === "READY") {
        setPersonaState({
          kind: "persona_ready",
          profileId: payload.data.id,
          summary: payload.data.personaSummary ?? "Profile prepared.",
          fullName: payload.data.fullName,
          currentRole: payload.data.currentRole,
          currentCompany: payload.data.currentCompany,
          technicalFocus: payload.data.technicalFocus ?? [],
          likelyInterviewFocus: payload.data.likelyInterviewFocus ?? [],
          jobStatus: job,
        });
      } else if (payload.data.status === "FAILED") {
        setPersonaState({
          kind: "persona_failed",
          profileId: payload.data.id,
          message: "We couldn't prepare this profile. You can still start a generic interview.",
          jobStatus: job,
        });
      } else if (job?.state === "queued" || job?.state === "delayed" || job?.state === "waiting-children") {
        setPersonaState({
          kind: "persona_queued",
          profileId: payload.data.id,
          jobStatus: job,
        });
      } else {
        setPersonaState({
          kind: "persona_processing",
          profileId: payload.data.id,
          jobStatus: job,
        });
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [personaState]);

  const personaMessage = useMemo(() => {
    switch (personaState.kind) {
      case "previewing":
        return { text: "Checking this URL...", tone: "muted" };
      case "preview_valid":
        return { text: `Source detected: ${personaState.sourceType}`, tone: "success" };
      case "preview_invalid":
        return { text: personaState.message, tone: "danger" };
      case "creating_persona":
        return { text: "Preparing interviewer profile...", tone: "muted" };
      case "persona_queued":
        return {
          text: buildQueueMessage("Queued for background processing", personaState.jobStatus),
          tone: "muted",
        };
      case "persona_processing":
        return {
          text: buildQueueMessage("Worker is analyzing public profile and building persona", personaState.jobStatus),
          tone: "muted",
        };
      case "persona_ready":
        return { text: personaState.summary, tone: "success" };
      case "persona_failed":
        return { text: buildFailureMessage(personaState.message, personaState.jobStatus), tone: "danger" };
      case "session_failed":
        return { text: personaState.message, tone: "danger" };
      default:
        return null;
    }
  }, [personaState]);

  function updateField<K extends keyof SetupFormState>(key: K, value: SetupFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "interviewerProfileUrl") {
      setPersonaState({ kind: "idle" });
    }
  }

  async function handleAnalyzeProfile() {
    if (!hasUrl) {
      setPersonaState({ kind: "preview_invalid", message: "Paste a public URL first." });
      return;
    }

    setPersonaState({ kind: "previewing" });

    const previewResponse = await fetch("/api/interviewer-profiles/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: form.interviewerProfileUrl }),
    });
    const previewPayload = (await previewResponse.json()) as PreviewResponse;

    if (!previewPayload.ok || !previewPayload.data) {
      setPersonaState({
        kind: "preview_invalid",
        message: previewPayload.message ?? "This URL could not be validated.",
      });
      return;
    }

    if (!previewPayload.data.supported) {
      setPersonaState({
        kind: "preview_invalid",
        message: previewPayload.data.message,
      });
      return;
    }

    setPersonaState({
      kind: "preview_valid",
      normalizedUrl: previewPayload.data.normalizedUrl,
      sourceType: previewPayload.data.sourceType,
    });

    setPersonaState({ kind: "creating_persona" });

    const createResponse = await fetch("/api/interviewer-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: previewPayload.data.normalizedUrl }),
    });
    const createPayload = (await createResponse.json()) as PersonaResponse;

    if (!createPayload.ok || !createPayload.data) {
      setPersonaState({
        kind: "persona_failed",
        message: createPayload.message ?? "Unable to create interviewer profile.",
      });
      return;
    }

    setPersonaState({
      kind: "persona_queued",
      profileId: createPayload.data.id,
      jobStatus: createPayload.data.job,
    });
  }

  async function createSession(personaMode: "generic" | "tailored") {
    setPersonaState({ kind: "session_creating" });

    const interviewerProfileId =
      personaMode === "tailored" && "profileId" in personaState ? personaState.profileId : undefined;

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: form.mode,
          targetLevel: form.targetLevel,
          selectedLanguage: form.selectedLanguage.toUpperCase(),
          companyStyle: form.companyStyle,
          voiceEnabled: form.voiceEnabled,
          lowCostMode: form.lowCostMode,
          personaEnabled: personaMode === "tailored",
        interviewerProfileId,
      }),
    });

    const payload = (await response.json()) as SessionResponse;
    if (!payload.ok || !payload.data) {
      setPersonaState({
        kind: "session_failed",
        message: payload.message ?? "Unable to create interview session.",
      });
      return;
    }

    const roomUrl = payload.data.launch.roomUrl;

    startTransition(() => {
      router.push(roomUrl);
    });
  }

  return (
    <main style={{ minHeight: "100vh", padding: 28 }}>
      <div style={{ width: "min(1080px, 100%)", margin: "0 auto", display: "grid", gap: 20 }}>
        <section style={{ ...cardStyle, padding: 28 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0, color: "var(--accent-strong)", fontWeight: 700, letterSpacing: 1 }}>
              SETUP INTERVIEW
            </p>
            <h1 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 3rem)" }}>Configure your mock interview.</h1>
            <p style={{ margin: 0, color: "var(--muted)", maxWidth: 760 }}>
              This MVP creates a coding-first interview session, with an optional public interviewer profile
              that nudges topic emphasis and follow-up style.
            </p>
          </div>
        </section>

        <section style={{ ...cardStyle, padding: 28, display: "grid", gap: 24 }}>
          <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Field label="Interview Type">
              <select
                value={form.mode}
                onChange={(event) => updateField("mode", event.target.value as SetupFormState["mode"])}
                style={inputStyle}
              >
                {selectOptions.mode.map((option) => (
                  <option key={option} value={option}>
                    {option === "SYSTEM_DESIGN" ? "System Design" : "Coding"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Target Level">
              <select
                value={form.targetLevel}
                onChange={(event) => updateField("targetLevel", event.target.value as SetupFormState["targetLevel"])}
                style={inputStyle}
              >
                {selectOptions.targetLevel.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Company Style">
              <select
                value={form.companyStyle}
                onChange={(event) => updateField("companyStyle", event.target.value as SetupFormState["companyStyle"])}
                style={inputStyle}
              >
                {selectOptions.companyStyle.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Cost Mode">
              <label
                style={{
                  ...panelStyle,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={form.lowCostMode}
                  onChange={(event) => updateField("lowCostMode", event.target.checked)}
                />
                <span>{form.lowCostMode ? "Low-cost mode on" : "Standard mode"}</span>
              </label>
            </Field>
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.78)",
              color: "var(--muted)",
              fontSize: 14,
            }}
          >
            Language is chosen inside the interview room. Question selection now prefers company-tagged questions first and falls back to generic ones when needed.
          </div>

          <section style={panelStyle}>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <h2 style={{ margin: 0 }}>Interviewer Profile URL</h2>
                <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                  Optional. Paste a public personal site, GitHub, company bio, or technical blog to tailor the mock.
                </p>
                <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 14 }}>
                  For local testing, include <code>retry</code> in the URL to simulate a transient worker failure, or
                  <code> always-fail</code> to simulate a final fallback.
                </p>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <input
                  value={form.interviewerProfileUrl}
                  onChange={(event) => updateField("interviewerProfileUrl", event.target.value)}
                  placeholder="https://example.com/jane-doe"
                  style={{ ...inputStyle, flex: "1 1 540px" }}
                />
                <button
                  type="button"
                  onClick={handleAnalyzeProfile}
                  disabled={personaState.kind === "previewing" || personaState.kind === "creating_persona" || personaState.kind === "persona_processing"}
                  style={{
                    ...buttonBase,
                    background: "#efe5d0",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Analyze Profile
                </button>
              </div>

              {personaMessage ? (
                <div
                  style={{
                    borderRadius: 12,
                    padding: "12px 14px",
                    background:
                      personaMessage.tone === "success"
                        ? "rgba(13, 122, 82, 0.10)"
                        : personaMessage.tone === "danger"
                          ? "rgba(176, 58, 46, 0.10)"
                          : "rgba(24, 90, 219, 0.08)",
                    color:
                      personaMessage.tone === "success"
                        ? "var(--success)"
                        : personaMessage.tone === "danger"
                          ? "var(--danger)"
                          : "var(--accent-strong)",
                  }}
                >
                  {personaMessage.text}
                </div>
              ) : null}

              {renderQueueStatus(personaState)}
              <PersonaTimeline personaState={personaState} />
              <DebugJobPanel personaState={personaState} />

              {personaState.kind === "persona_ready" ? (
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    borderRadius: 16,
                    border: "1px solid var(--border)",
                    background: "#fff",
                    padding: 18,
                  }}
                >
                  <h3 style={{ margin: 0 }}>
                    {personaState.fullName ?? "Prepared interviewer persona"}
                  </h3>
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    {[personaState.currentRole, personaState.currentCompany].filter(Boolean).join(" at ")}
                  </p>
                  <p style={{ margin: 0 }}>{personaState.summary}</p>
                  <TagRow title="Technical focus" items={personaState.technicalFocus ?? []} />
                  <TagRow title="Likely interview focus" items={personaState.likelyInterviewFocus ?? []} />
                </div>
              ) : null}
            </div>
          </section>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <button
              type="button"
              onClick={() => createSession("generic")}
              disabled={isSessionCreating || isPending}
              style={{
                ...buttonBase,
                background: "var(--accent)",
                color: "#fff",
              }}
            >
              Start Generic Interview
            </button>
            <button
              type="button"
              onClick={() => createSession("tailored")}
              disabled={!canStartTailored || isSessionCreating || isPending}
              style={{
                ...buttonBase,
                background: canStartTailored ? "#17345f" : "#a2a7ad",
                color: "#fff",
              }}
            >
              Start Tailored Interview
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={fieldStyle}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

function TagRow({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong>{title}</strong>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {items.map((item) => (
          <span
            key={item}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
            }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function renderQueueStatus(personaState: PersonaUiState) {
  const job =
    personaState.kind === "persona_queued" ||
    personaState.kind === "persona_processing" ||
    personaState.kind === "persona_ready" ||
    personaState.kind === "persona_failed"
      ? personaState.jobStatus
      : undefined;

  if (!job) {
    return null;
  }

  const stateLabel =
    job.state === "queued"
      ? "Queued"
      : job.state === "processing"
        ? "Processing"
        : job.state === "completed"
          ? "Completed"
          : job.state === "failed"
            ? "Failed"
            : job.state;

  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: "#fff",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <strong>Background Job</strong>
        <span style={{ color: "var(--muted)" }}>{stateLabel}</span>
      </div>
      <div style={{ display: "grid", gap: 4, color: "var(--muted)", fontSize: 14 }}>
        <span>Attempts: {job.attemptsMade}/{job.attemptsAllowed}</span>
        {job.enqueuedAt ? <span>Queued at: {new Date(job.enqueuedAt).toLocaleTimeString()}</span> : null}
        {job.processedAt ? <span>Processing started: {new Date(job.processedAt).toLocaleTimeString()}</span> : null}
        {job.finishedAt ? <span>Finished: {new Date(job.finishedAt).toLocaleTimeString()}</span> : null}
        {job.failedReason ? <span>Last failure: {job.failedReason}</span> : null}
      </div>
    </div>
  );
}

function PersonaTimeline({ personaState }: { personaState: PersonaUiState }) {
  const steps = buildTimelineSteps(personaState);

  if (steps.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <strong>Persona Preparation Timeline</strong>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        {steps.map((step) => (
          <div
            key={step.title}
            style={{
              ...timelineStepBase,
              borderColor:
                step.state === "done"
                  ? "rgba(13, 122, 82, 0.35)"
                  : step.state === "active"
                    ? "rgba(24, 90, 219, 0.35)"
                    : step.state === "failed"
                      ? "rgba(176, 58, 46, 0.35)"
                      : "var(--border)",
              background:
                step.state === "done"
                  ? "rgba(13, 122, 82, 0.06)"
                  : step.state === "active"
                    ? "rgba(24, 90, 219, 0.06)"
                    : step.state === "failed"
                      ? "rgba(176, 58, 46, 0.06)"
                      : "#fff",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong>{step.title}</strong>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>{step.label}</span>
            </div>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>{step.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildTimelineSteps(personaState: PersonaUiState) {
  if (personaState.kind === "idle") {
    return [];
  }

  const previewState =
    personaState.kind === "preview_invalid"
      ? "failed"
      : personaState.kind === "previewing"
        ? "active"
        : "done";

  const queueState =
    personaState.kind === "creating_persona"
      ? "active"
      : personaState.kind === "persona_queued" || personaState.kind === "persona_processing" || personaState.kind === "persona_ready"
        ? "done"
        : personaState.kind === "persona_failed"
          ? "done"
          : "pending";

  const processingState =
    personaState.kind === "persona_processing"
      ? "active"
      : personaState.kind === "persona_ready"
        ? "done"
        : personaState.kind === "persona_failed"
          ? "failed"
          : "pending";

  const readyState =
    personaState.kind === "persona_ready"
      ? "done"
      : personaState.kind === "persona_failed"
        ? "failed"
        : "pending";

  return [
    {
      title: "Validate URL",
      label: timelineLabel(previewState),
      state: previewState,
      description: "Check URL format and supported public source type.",
    },
    {
      title: "Queue Job",
      label: timelineLabel(queueState),
      state: queueState,
      description: "Create profile record and enqueue background work in Redis.",
    },
    {
      title: "Worker Process",
      label: timelineLabel(processingState),
      state: processingState,
      description:
        personaState.kind === "persona_failed" && personaState.jobStatus?.attemptsMade
          ? `Worker attempted ${personaState.jobStatus.attemptsMade} time(s).`
          : "Worker fetches, extracts, and synthesizes the interviewer persona.",
    },
    {
      title: "Persona Ready",
      label: timelineLabel(readyState),
      state: readyState,
      description:
        personaState.kind === "persona_failed"
          ? "Tailored mode unavailable. Generic interview fallback is still available."
          : "Tailored interviewer context is ready for session creation.",
    },
  ];
}

function timelineLabel(state: "done" | "active" | "failed" | "pending") {
  if (state === "done") return "Done";
  if (state === "active") return "In progress";
  if (state === "failed") return "Failed";
  return "Pending";
}

function buildQueueMessage(prefix: string, job?: PersonaJobStatus) {
  if (!job) {
    return prefix;
  }

  if (job.attemptsMade > 0) {
    return `${prefix}. Retry ${job.attemptsMade} of ${job.attemptsAllowed}.`;
  }

  return `${prefix}.`;
}

function buildFailureMessage(prefix: string, job?: PersonaJobStatus) {
  if (!job?.failedReason) {
    return prefix;
  }

  return `${prefix} Last failure: ${job.failedReason}`;
}

function DebugJobPanel({ personaState }: { personaState: PersonaUiState }) {
  const debugPayload =
    personaState.kind === "persona_queued" ||
    personaState.kind === "persona_processing" ||
    personaState.kind === "persona_ready" ||
    personaState.kind === "persona_failed"
      ? {
          profileId: personaState.profileId,
          state: personaState.kind,
          job: personaState.jobStatus ?? null,
        }
      : null;

  if (!debugPayload) {
    return null;
  }

  return (
    <details
      style={{
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: "#fff",
        padding: 16,
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
        View Raw Job Status JSON
      </summary>
      <pre
        style={{
          margin: "14px 0 0",
          padding: 16,
          borderRadius: 12,
          background: "#1d2230",
          color: "#ebf0ff",
          overflowX: "auto",
          fontSize: 13,
        }}
      >
        {JSON.stringify(debugPayload, null, 2)}
      </pre>
    </details>
  );
}
