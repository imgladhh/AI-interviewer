import Link from "next/link";

const shellStyle = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "32px",
} as const;

const cardStyle = {
  width: "min(980px, 100%)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow)",
  padding: "40px",
} as const;

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "14px 20px",
  borderRadius: "999px",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 700,
} as const;

const secondaryCard = {
  padding: "20px",
  background: "var(--surface-alt)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
} as const;

export default function HomePage() {
  return (
    <main style={shellStyle}>
      <section style={cardStyle}>
        <div style={{ display: "grid", gap: 28 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, color: "var(--accent-strong)", fontWeight: 700, letterSpacing: 1 }}>
              AI INTERVIEWER
            </p>
            <h1 style={{ margin: 0, fontSize: "clamp(2.4rem, 6vw, 4.5rem)", lineHeight: 1 }}>
              Mock Interview with AI
            </h1>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "1.1rem", maxWidth: 740 }}>
              Start with coding interviews today, optionally tailor the mock to a public interviewer profile,
              and keep the architecture ready for system design next.
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <Link href="/setup" style={buttonStyle}>
              Start Mock Interview
            </Link>
            <Link
              href="/questions"
              style={{
                ...buttonStyle,
                background: "transparent",
                color: "var(--text)",
                border: "1px solid var(--border)",
              }}
            >
              Browse Question Bank
            </Link>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            <article style={secondaryCard}>
              <h2 style={{ marginTop: 0 }}>Structured interview flow</h2>
              <p style={{ marginBottom: 0, color: "var(--muted)" }}>
                Setup, persona preparation, and session creation are wired to API routes and a Prisma-backed data model.
              </p>
            </article>
            <article style={secondaryCard}>
              <h2 style={{ marginTop: 0 }}>Optional interviewer persona</h2>
              <p style={{ marginBottom: 0, color: "var(--muted)" }}>
                Paste a public profile URL to nudge topic emphasis and follow-up style without pretending to predict a real interview.
              </p>
            </article>
            <article style={secondaryCard}>
              <h2 style={{ marginTop: 0 }}>MVP-ready data model</h2>
              <p style={{ marginBottom: 0, color: "var(--muted)" }}>
                Sessions, transcripts, code snapshots, evaluation, and interviewer context are already modeled for expansion.
              </p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
