export type DedicatedSttSuccess = {
  text: string;
  provider: "openai-stt";
  model: string;
};

export async function transcribeWithDedicatedStt(audio: Blob): Promise<DedicatedSttSuccess> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Dedicated STT is not configured.");
  }

  const model = process.env.OPENAI_STT_MODEL?.trim() || "gpt-4o-mini-transcribe";
  const formData = new FormData();
  formData.append("file", audio, "candidate-turn.webm");
  formData.append("model", model);
  formData.append("language", "en");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : "Dedicated STT request failed.";
    throw new Error(message);
  }

  const payload = (await response.json()) as {
    text?: string;
  };

  const text = payload.text?.trim();
  if (!text) {
    throw new Error("Dedicated STT returned an empty transcript.");
  }

  return {
    text,
    provider: "openai-stt",
    model,
  };
}
