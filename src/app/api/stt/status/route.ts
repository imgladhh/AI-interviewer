import { ok } from "@/lib/http";
import { getDedicatedSttConfig } from "@/lib/voice/stt-provider";

export async function GET() {
  const config = getDedicatedSttConfig();

  return ok({
    configured: config.configured,
    provider: config.provider,
    model: config.model,
  });
}
