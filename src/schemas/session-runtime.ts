import { z } from "zod";

export const createSessionEventSchema = z.object({
  eventType: z.string().trim().min(1).max(80),
  payloadJson: z.record(z.string(), z.unknown()).optional(),
});

export const createTranscriptSegmentSchema = z.object({
  speaker: z.enum(["USER", "AI", "SYSTEM"]),
  text: z.string().trim().min(1),
  startedAtMs: z.number().int().nonnegative().optional(),
  endedAtMs: z.number().int().nonnegative().optional(),
  isFinal: z.boolean().default(true),
  audioUrl: z.string().trim().url().optional(),
  transcriptSource: z.enum(["manual", "browser", "openai-stt", "assemblyai-stt", "assistant"]).optional(),
  transcriptProvider: z.string().trim().min(1).max(64).optional(),
  sourceText: z.string().trim().min(1).optional(),
});

export const createExecutionRunSchema = z.object({
  language: z.string().trim().min(1).max(32),
  code: z.string().min(1),
  stdin: z.string().optional(),
  source: z.string().trim().min(1).max(32).default("RUN"),
});

