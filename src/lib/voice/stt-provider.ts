export type DedicatedSttProvider = "openai-stt" | "assemblyai-stt";

export type DedicatedSttSuccess = {
  text: string;
  provider: DedicatedSttProvider;
  model: string;
};

export type DedicatedSttConfig = {
  configured: boolean;
  provider: DedicatedSttProvider | null;
  model: string | null;
};

export type DedicatedSttFailureClass =
  | "quota"
  | "auth"
  | "model"
  | "network"
  | "timeout"
  | "other";

export class DedicatedSttError extends Error {
  status: number | null;
  errorType: string | null;
  errorCode: string | null;
  provider: DedicatedSttProvider;

  constructor(input: {
    message: string;
    provider: DedicatedSttProvider;
    status?: number | null;
    errorType?: string | null;
    errorCode?: string | null;
  }) {
    super(input.message);
    this.name = "DedicatedSttError";
    this.status = input.status ?? null;
    this.errorType = input.errorType ?? null;
    this.errorCode = input.errorCode ?? null;
    this.provider = input.provider;
  }
}

export function classifyDedicatedSttError(error: DedicatedSttError): DedicatedSttFailureClass {
  const message = error.message.toLowerCase();

  if (
    error.status === 402 ||
    error.status === 403 ||
    error.status === 429 ||
    error.errorCode === "insufficient_quota" ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("credit") ||
    message.includes("payment") ||
    message.includes("usage limit") ||
    message.includes("usage") && message.includes("limit")
  ) {
    return "quota";
  }

  if (
    error.status === 401 ||
    message.includes("api key") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("invalid key")
  ) {
    return "auth";
  }

  if (error.errorType === "network_error" || message.includes("network")) {
    return "network";
  }

  if (error.errorType === "timeout" || message.includes("timed out")) {
    return "timeout";
  }

  if (error.status === 404 || message.includes("model")) {
    return "model";
  }

  return "other";
}

export function getDedicatedSttConfig(): DedicatedSttConfig {
  const requestedProvider = process.env.STT_PROVIDER?.trim().toLowerCase();
  const assemblyKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  const openAiKey = process.env.OPENAI_API_KEY?.trim();

  if (requestedProvider === "assemblyai" || requestedProvider === "assemblyai-stt") {
    return {
      configured: Boolean(assemblyKey),
      provider: assemblyKey ? "assemblyai-stt" : null,
      model: assemblyKey ? getAssemblyAiSpeechModels().join(", ") : null,
    };
  }

  if (requestedProvider === "openai" || requestedProvider === "openai-stt") {
    return {
      configured: Boolean(openAiKey),
      provider: openAiKey ? "openai-stt" : null,
      model: openAiKey ? getOpenAiModel() : null,
    };
  }

  if (assemblyKey) {
    return {
      configured: true,
      provider: "assemblyai-stt",
      model: getAssemblyAiSpeechModels().join(", "),
    };
  }

  if (openAiKey) {
    return {
      configured: true,
      provider: "openai-stt",
      model: getOpenAiModel(),
    };
  }

  return {
    configured: false,
    provider: null,
    model: null,
  };
}

export async function transcribeWithDedicatedStt(audio: Blob): Promise<DedicatedSttSuccess> {
  const config = getDedicatedSttConfig();

  if (!config.configured || !config.provider) {
    throw new DedicatedSttError({
      message: "Dedicated STT is not configured.",
      provider: "openai-stt",
    });
  }

  if (config.provider === "assemblyai-stt") {
    return transcribeWithAssemblyAi(audio);
  }

  return transcribeWithOpenAi(audio);
}

async function transcribeWithOpenAi(audio: Blob): Promise<DedicatedSttSuccess> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new DedicatedSttError({
      message: "OpenAI STT is not configured.",
      provider: "openai-stt",
    });
  }

  const model = getOpenAiModel();
  const formData = new FormData();
  formData.append("file", audio, "candidate-turn.webm");
  formData.append("model", model);
  formData.append("language", "en");

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });
  } catch (error) {
    throw new DedicatedSttError({
      message: error instanceof Error ? error.message : "OpenAI STT network error.",
      provider: "openai-stt",
      errorType: "network_error",
    });
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new DedicatedSttError({
      message:
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : "OpenAI STT request failed.",
      provider: "openai-stt",
      status: response.status,
      errorType: typeof payload?.error?.type === "string" ? payload.error.type : null,
      errorCode: typeof payload?.error?.code === "string" ? payload.error.code : null,
    });
  }

  const payload = (await response.json()) as { text?: string };
  const text = payload.text?.trim();
  if (!text) {
    throw new DedicatedSttError({
      message: "OpenAI STT returned an empty transcript.",
      provider: "openai-stt",
      status: response.status,
      errorType: "empty_transcript",
    });
  }

  return {
    text,
    provider: "openai-stt",
    model,
  };
}

async function transcribeWithAssemblyAi(audio: Blob): Promise<DedicatedSttSuccess> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) {
    throw new DedicatedSttError({
      message: "AssemblyAI STT is not configured.",
      provider: "assemblyai-stt",
    });
  }

  const baseUrl = "https://api.assemblyai.com";
  const speechModels = getAssemblyAiSpeechModels();

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(`${baseUrl}/v2/upload`, {
      method: "POST",
      headers: {
        authorization: apiKey,
      },
      body: audio,
    });
  } catch (error) {
    throw new DedicatedSttError({
      message: error instanceof Error ? error.message : "AssemblyAI upload failed.",
      provider: "assemblyai-stt",
      errorType: "network_error",
    });
  }

  if (!uploadResponse.ok) {
    const payload = await uploadResponse.json().catch(() => null);
    throw new DedicatedSttError({
      message:
        typeof payload?.error === "string"
          ? payload.error
          : "AssemblyAI upload request failed.",
      provider: "assemblyai-stt",
      status: uploadResponse.status,
      errorType: "upload_failed",
      errorCode: typeof payload?.code === "string" ? payload.code : null,
    });
  }

  const uploadPayload = (await uploadResponse.json()) as { upload_url?: string };
  const audioUrl = uploadPayload.upload_url?.trim();
  if (!audioUrl) {
    throw new DedicatedSttError({
      message: "AssemblyAI upload did not return an upload_url.",
      provider: "assemblyai-stt",
      status: uploadResponse.status,
      errorType: "upload_missing_url",
    });
  }

  let transcriptResponse: Response;
  try {
    transcriptResponse = await fetch(`${baseUrl}/v2/transcript`, {
      method: "POST",
      headers: {
        authorization: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_models: speechModels,
        language_detection: true,
      }),
    });
  } catch (error) {
    throw new DedicatedSttError({
      message: error instanceof Error ? error.message : "AssemblyAI transcript request failed.",
      provider: "assemblyai-stt",
      errorType: "network_error",
    });
  }

  if (!transcriptResponse.ok) {
    const payload = await transcriptResponse.json().catch(() => null);
    throw new DedicatedSttError({
      message:
        typeof payload?.error === "string"
          ? payload.error
          : "AssemblyAI transcript request failed.",
      provider: "assemblyai-stt",
      status: transcriptResponse.status,
      errorType: "transcript_request_failed",
      errorCode: typeof payload?.code === "string" ? payload.code : null,
    });
  }

  const transcriptPayload = (await transcriptResponse.json()) as { id?: string };
  const transcriptId = transcriptPayload.id?.trim();
  if (!transcriptId) {
    throw new DedicatedSttError({
      message: "AssemblyAI transcript request did not return an id.",
      provider: "assemblyai-stt",
      status: transcriptResponse.status,
      errorType: "transcript_missing_id",
    });
  }

  const pollDeadline = Date.now() + 20_000;
  while (Date.now() < pollDeadline) {
    await sleep(700);

    let pollResponse: Response;
    try {
      pollResponse = await fetch(`${baseUrl}/v2/transcript/${transcriptId}`, {
        headers: {
          authorization: apiKey,
        },
      });
    } catch (error) {
      throw new DedicatedSttError({
        message: error instanceof Error ? error.message : "AssemblyAI polling failed.",
        provider: "assemblyai-stt",
        errorType: "network_error",
      });
    }

    if (!pollResponse.ok) {
      const payload = await pollResponse.json().catch(() => null);
      throw new DedicatedSttError({
        message:
          typeof payload?.error === "string"
            ? payload.error
            : "AssemblyAI polling request failed.",
        provider: "assemblyai-stt",
        status: pollResponse.status,
        errorType: "poll_failed",
        errorCode: typeof payload?.code === "string" ? payload.code : null,
      });
    }

    const payload = (await pollResponse.json()) as {
      status?: string;
      text?: string;
      error?: string;
    };

    if (payload.status === "completed") {
      const text = payload.text?.trim();
      if (!text) {
        throw new DedicatedSttError({
          message: "AssemblyAI returned an empty transcript.",
          provider: "assemblyai-stt",
          status: pollResponse.status,
          errorType: "empty_transcript",
        });
      }

      return {
        text,
        provider: "assemblyai-stt",
        model: speechModels.join(", "),
      };
    }

    if (payload.status === "error") {
      throw new DedicatedSttError({
        message: typeof payload.error === "string" ? payload.error : "AssemblyAI transcription failed.",
        provider: "assemblyai-stt",
        status: pollResponse.status,
        errorType: "transcription_failed",
      });
    }
  }

  throw new DedicatedSttError({
    message: "AssemblyAI transcription timed out before completion.",
    provider: "assemblyai-stt",
    errorType: "timeout",
  });
}

function getOpenAiModel() {
  return process.env.OPENAI_STT_MODEL?.trim() || "gpt-4o-mini-transcribe";
}

function getAssemblyAiSpeechModels() {
  const raw = process.env.ASSEMBLYAI_STT_MODELS?.trim();
  if (!raw) {
    return ["universal-3-pro", "universal-2"];
  }

  const models = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return models.length > 0 ? models : ["universal-3-pro", "universal-2"];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
