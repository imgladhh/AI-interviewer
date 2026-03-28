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
    delete process.env.STT_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ASSEMBLYAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns 503 when dedicated STT is not configured", async () => {
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

  it("returns a transcript when AssemblyAI STT succeeds", async () => {
    process.env.STT_PROVIDER = "assemblyai";
    process.env.ASSEMBLYAI_API_KEY = "assembly-key";
    process.env.ASSEMBLYAI_STT_MODELS = "universal-3-pro,universal-2";

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ upload_url: "https://files.assemblyai.test/audio" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ id: "tx_123" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            status: "completed",
            text: "Use a heap after counting frequencies.",
          }),
        }),
    );

    const { POST } = await import("@/app/api/stt/transcribe/route");
    const formData = new FormData();
    formData.append("audio", new Blob(["test"], { type: "audio/webm" }), "sample.webm");
    formData.append("sessionId", "session-assembly");

    const response = await POST(
      new Request("http://localhost/api/stt/transcribe", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.text).toBe("Use a heap after counting frequencies.");
    expect(payload.data.provider).toBe("assemblyai-stt");
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(1);
  });

  it("classifies AssemblyAI quota-like failures for fallback handling", async () => {
    process.env.STT_PROVIDER = "assemblyai";
    process.env.ASSEMBLYAI_API_KEY = "assembly-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: vi.fn().mockResolvedValue({
          error: "Usage limit reached for this account.",
        }),
      }),
    );

    const { POST } = await import("@/app/api/stt/transcribe/route");
    const formData = new FormData();
    formData.append("audio", new Blob(["test"], { type: "audio/webm" }), "sample.webm");
    formData.append("sessionId", "session-assembly-quota");

    const response = await POST(
      new Request("http://localhost/api/stt/transcribe", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.ok).toBe(false);
    expect(payload.provider).toBe("assemblyai-stt");
    expect(payload.providerFailureClass).toBe("quota");
    expect(prisma.sessionEvent.create).toHaveBeenCalledTimes(1);
  });
});
