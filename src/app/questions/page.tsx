import { QuestionLaunchButton } from "@/components/questions/question-launch-button";
import { prisma } from "@/lib/db";

const shellStyle = {
  minHeight: "100vh",
  padding: "24px 20px 40px",
} as const;

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow)",
} as const;

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export default async function QuestionsPage() {
  const questions = await prisma.question.findMany({
    where: { isActive: true },
    orderBy: [{ companyStyle: "asc" }, { difficulty: "asc" }, { title: "asc" }],
  });

  return (
    <main style={shellStyle}>
      <div style={{ width: "min(1440px, 100%)", margin: "0 auto", display: "grid", gap: 20 }}>
        <section style={{ ...cardStyle, padding: 28 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0, color: "var(--accent-strong)", fontWeight: 700, letterSpacing: 1 }}>
              QUESTION BANK
            </p>
            <h1 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 3.25rem)" }}>
              Browse the full interview question bank.
            </h1>
            <p style={{ margin: 0, color: "var(--muted)", maxWidth: 900 }}>
              This view shows the active bank currently stored in the database, including difficulty, interview type,
              algorithm tags, and company targeting.
            </p>
          </div>
        </section>

        <section style={{ ...cardStyle, padding: 20, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1160 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "12px 10px" }}>Title</th>
                <th style={{ padding: "12px 10px" }}>Type</th>
                <th style={{ padding: "12px 10px" }}>Difficulty</th>
                <th style={{ padding: "12px 10px" }}>Level</th>
                <th style={{ padding: "12px 10px" }}>Company</th>
                <th style={{ padding: "12px 10px" }}>Estimated</th>
                <th style={{ padding: "12px 10px" }}>Tags</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((question) => {
                const tags = toStringArray(question.topicTags);

                return (
                  <tr key={question.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", verticalAlign: "top" }}>
                    <td style={{ padding: "14px 10px", fontWeight: 700, minWidth: 240 }}>
                      <QuestionLaunchButton
                        questionId={question.id}
                        mode={question.type}
                        targetLevel={question.levelTarget ?? "SDE2"}
                        companyStyle={question.companyStyle ?? "GENERIC"}
                        variant="link"
                        label={question.title}
                      />
                    </td>
                    <td style={{ padding: "14px 10px" }}>{question.type}</td>
                    <td style={{ padding: "14px 10px" }}>{question.difficulty}</td>
                    <td style={{ padding: "14px 10px" }}>{question.levelTarget ?? "—"}</td>
                    <td style={{ padding: "14px 10px" }}>{question.companyStyle ?? "GENERIC"}</td>
                    <td style={{ padding: "14px 10px" }}>
                      {question.estimatedMinutes ? `${question.estimatedMinutes} min` : "—"}
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {tags.length > 0 ? (
                          tags.map((tag) => (
                            <span
                              key={`${question.id}-${tag}`}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 999,
                                border: "1px solid var(--border)",
                                background: "var(--surface-alt)",
                                color: "var(--muted)",
                                fontSize: 13,
                              }}
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}