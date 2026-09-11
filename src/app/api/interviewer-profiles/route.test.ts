import { describe, expect, it, vi } from "vitest";

const prisma = { interviewerProfile: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } };
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/persona/queue", () => ({ enqueuePersonaIngestion: vi.fn(), removeExistingPersonaJob: vi.fn() }));
vi.mock("@/lib/persona/job-events", () => ({ logPersonaJobEvent: vi.fn() }));

describe("POST /api/interviewer-profiles", () => {
  it("fails closed before parsing, database, and queue work", async () => {
    delete process.env.ENABLE_PERSONA_INGESTION;
    const { POST } = await import("@/app/api/interviewer-profiles/route");
    const response = await POST(new Request("http://localhost/api/interviewer-profiles", { method: "POST", body: "not-json" }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("PERSONA_INGESTION_DISABLED");
    expect(prisma.interviewerProfile.findFirst).not.toHaveBeenCalled();
  });
});
