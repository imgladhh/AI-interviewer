import { ok } from "@/lib/http";

export async function GET() {
  return ok({
    configured: Boolean(process.env.OPENAI_API_KEY),
    provider: process.env.OPENAI_API_KEY ? "openai-stt" : null,
    model: process.env.OPENAI_STT_MODEL?.trim() || "gpt-4o-mini-transcribe",
  });
}
