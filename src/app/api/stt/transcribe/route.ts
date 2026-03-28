import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { estimateOpenAiSttCost } from "@/lib/usage/cost";
import { transcribeWithDedicatedStt } from "@/lib/voice/stt-provider";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return fail("Invalid multipart form body", 400);
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) {
    return fail("Audio blob is required", 400);
  }

  const sessionId = typeof formData.get("sessionId") === "string" ? String(formData.get("sessionId")) : null;
  const preview = String(formData.get("preview") ?? "false") === "true";
  const lowCostMode = String(formData.get("lowCostMode") ?? "false") === "true";

  if (!process.env.OPENAI_API_KEY) {
    return fail("Dedicated STT provider is not configured", 503, {
      code: "STT_NOT_CONFIGURED",
      fallbackAllowed: true,
    });
  }

  try {
    const transcription = await transcribeWithDedicatedStt(audio);

    if (sessionId) {
      await prisma.sessionEvent.create({
        data: {
          sessionId,
          eventType: SESSION_EVENT_TYPES.STT_USAGE_RECORDED,
          payloadJson: {
            provider: transcription.provider,
            model: transcription.model,
            audioBytes: audio.size,
            preview,
            lowCostMode,
            estimatedCostUsd: estimateOpenAiSttCost(transcription.model, audio.size),
          },
        },
      });
    }

    return ok(transcription);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Dedicated STT failed", 502, {
      code: "STT_PROVIDER_ERROR",
      fallbackAllowed: true,
    });
  }
}
