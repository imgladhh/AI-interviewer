import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const prisma = {
  sessionEvent: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma,
}));

describe("dedicated STT route", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    prisma.sessionEvent.create.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns 503 when dedicated STT is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    const { POST } = await import("@/app/api/stt/transcribe/route");
    const formData = new FormData();
    formData.append("audio", new Blob(["test"], { type: "audio/webm" }), "sample.webm");

    const response = await POST(
      new Request("http://localhost/api/stt/transcribe", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("STT_NOT_CONFIGURED");
  });

  it("returns a transcript when OpenAI STT succeeds", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_STT_MODEL = "gpt-4o-mini-transcribe";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "Use a hash map and then a min heap.",
        }),
      }),
    );

    const { POST } = await import("@/app/api/stt/transcribe/route");
    const formData = new FormData();
    formData.append("audio", new Blob(["test"], { type: "audio/webm" }), "sample.webm");
    formData.append("sessionId", "session-1");

    const response = await POST(
      new Request("http://localhost/api/stt/transcribe", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.text).toBe("Use a hash map and then a min heap.");
    expect(payload.data.provider).toBe("openai-stt");
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(1);
  });
});
