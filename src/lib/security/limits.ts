function positiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const requestLimits = {
  get codeChars() { return positiveInteger("MAX_CODE_CHARS", 100_000); },
  get stdinChars() { return positiveInteger("MAX_STDIN_CHARS", 20_000); },
  get transcriptChars() { return positiveInteger("MAX_TRANSCRIPT_CHARS", 20_000); },
  get audioBytes() { return positiveInteger("MAX_STT_AUDIO_BYTES", 10 * 1024 * 1024); },
  get providerOutputChars() { return positiveInteger("MAX_PROVIDER_OUTPUT_CHARS", 64_000); },
  get personaResponseBytes() { return positiveInteger("MAX_PERSONA_RESPONSE_BYTES", 1024 * 1024); },
  get providerTimeoutMs() { return positiveInteger("PROVIDER_TIMEOUT_MS", 20_000); },
  get codeTimeoutMs() { return positiveInteger("MAX_CODE_TIMEOUT_MS", 5_000); },
  get processOutputChars() { return positiveInteger("MAX_PROCESS_OUTPUT_CHARS", 64_000); },
} as const;

export function boundedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[output truncated]`;
}

export function providerSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestLimits.providerTimeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Provider response exceeded configured size limit");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("Provider response exceeded configured size limit");
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}
