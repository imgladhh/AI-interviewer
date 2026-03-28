import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { estimateOpenAiSttCost } from "@/lib/usage/cost";
import {
  classifyDedicatedSttError,
  DedicatedSttError,
  getDedicatedSttConfig,
  transcribeWithDedicatedStt,
} from "@/lib/voice/stt-provider";

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
  const config = getDedicatedSttConfig();

  if (!config.configured || !config.provider) {
    return fail("Dedicated STT provider is not configured", 503, {
      code: "STT_NOT_CONFIGURED",
      fallbackAllowed: true,
    });
  }

  try {
    const transcription = await transcribeWithDedicatedStt(audio);
    const estimatedCostUsd =
      transcription.provider === "openai-stt"
        ? estimateOpenAiSttCost(transcription.model, audio.size)
        : null;

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
            estimatedCostUsd,
            status: "ok",
          },
        },
      });
    }

    return ok(transcription);
  } catch (error) {
    const sttError =
      error instanceof DedicatedSttError
        ? error
        : new DedicatedSttError({
            message: error instanceof Error ? error.message : "Dedicated STT failed",
            provider: config.provider ?? "openai-stt",
          });
    const failureClass = classifyDedicatedSttError(sttError);

    if (process.env.NODE_ENV !== "production") {
      console.error("[stt/transcribe] Dedicated STT failure", {
        status: sttError.status,
        errorType: sttError.errorType,
        errorCode: sttError.errorCode,
        failureClass,
        message: sttError.message,
        provider: sttError.provider,
        preview,
        sessionId,
        lowCostMode,
      });
    }

    if (sessionId) {
      await prisma.sessionEvent.create({
        data: {
          sessionId,
          eventType: SESSION_EVENT_TYPES.STT_USAGE_RECORDED,
          payloadJson: {
            provider: sttError.provider,
            audioBytes: audio.size,
            preview,
            lowCostMode,
            status: "error",
            statusCode: sttError.status,
            errorType: sttError.errorType,
            errorCode: sttError.errorCode,
            failureClass,
            message: sttError.message,
          },
        },
      });
    }

    return fail(sttError.message, 502, {
      code: "STT_PROVIDER_ERROR",
      fallbackAllowed: true,
      provider: sttError.provider,
      providerStatus: sttError.status,
      providerErrorType: sttError.errorType,
      providerErrorCode: sttError.errorCode,
      providerFailureClass: failureClass,
    });
  }
}
