import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { derivePersonaProfileFromPublicContent } from "@/lib/persona/ingest-public-profile";

describe("derivePersonaProfileFromPublicContent", () => {
  it("extracts persona signals from public HTML content", () => {
    const profile = derivePersonaProfileFromPublicContent({
      url: "https://example.com/jane-doe",
      sourceType: "BLOG",
      html: `
        <html>
          <head>
            <title>Jane Doe - Senior Backend Engineer at Example</title>
            <meta name="description" content="Distributed systems, testing, reliability, and pragmatic engineering leadership." />
          </head>
          <body>
            <h1>Jane Doe</h1>
            <p>I write about distributed systems, debugging, and mentoring engineers.</p>
          </body>
        </html>
      `,
    });

    expect(profile.fullName).toContain("Jane Doe");
    expect(profile.currentRole).toMatch(/Engineer/i);
    expect(profile.personaSummary).toMatch(/interviewer/i);
    expect(profile.technicalFocus).toContain("system design");
    expect(profile.likelyInterviewFocus.length).toBeGreaterThan(0);
    expect(profile.communicationStyleGuess.length).toBeGreaterThan(0);
    expect(profile.confidence).toBeGreaterThan(0.4);
  });
});

