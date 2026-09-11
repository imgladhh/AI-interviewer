import { z } from "zod";

import { requestLimits } from "@/lib/security/limits";

export const clientSessionEventSchema = z.discriminatedUnion("eventType", [
  z.object({ eventType: z.literal("INTERVIEW_ROOM_OPENED"), payloadJson: z.object({ room: z.string().trim().min(1).max(64) }).optional() }),
  z.object({ eventType: z.literal("LISTENING_STARTED"), payloadJson: z.object({ mode: z.literal("continuous"), transcriptionMode: z.enum(["provider", "browser"]) }) }),
  z.object({ eventType: z.literal("LISTENING_STOPPED"), payloadJson: z.object({ mode: z.literal("continuous") }) }),
  z.object({ eventType: z.literal("HINT_REQUESTED"), payloadJson: z.object({ source: z.literal("room-controls") }) }),
  z.object({ eventType: z.literal("EDITOR_ACTIVITY_RECORDED"), payloadJson: z.object({ stage: z.string().max(64), flowMode: z.string().max(64), activeCoding: z.literal(true), codeLength: z.number().int().nonnegative(), editCount: z.number().int().nonnegative(), pauseMs: z.number().nonnegative(), deletionRatio: z.number().min(0).max(1) }) }),
  z.object({ eventType: z.literal("WHITEBOARD_SIGNAL_RECORDED"), payloadJson: z.object({ mode: z.literal("SYSTEM_DESIGN"), stage: z.string().max(64), auxiliaryOnly: z.literal(true), excludedFromDecision: z.literal(true), whiteboardSignal: z.object({ component_count: z.number().int().nonnegative(), connection_count: z.number().int().nonnegative(), element_count: z.number().int().nonnegative() }) }) }),
  z.object({ eventType: z.literal("CANDIDATE_TURN_AUTOSUBMITTED"), payloadJson: z.object({ source: z.enum(["silence_timeout", "provider_vad"]) }) }),
  z.object({ eventType: z.literal("AI_INTERRUPTED_BY_CANDIDATE"), payloadJson: z.object({ hadLiveDraft: z.boolean(), wasSpeaking: z.boolean() }) }),
]);

export const createTranscriptSegmentSchema = z.object({
  speaker: z.literal("USER"),
  text: z.string().trim().min(1).max(requestLimits.transcriptChars),
  startedAtMs: z.number().int().nonnegative().optional(),
  endedAtMs: z.number().int().nonnegative().optional(),
  isFinal: z.boolean().default(true),
  audioUrl: z.string().trim().url().max(4096).optional(),
  transcriptSource: z.enum(["manual", "browser", "openai-stt", "assemblyai-stt", "assistant"]).optional(),
  transcriptProvider: z.string().trim().min(1).max(64).optional(),
  sourceText: z.string().trim().min(1).max(requestLimits.transcriptChars).optional(),
  correctionOfId: z.string().trim().min(1).optional(),
});

export const createExecutionRunSchema = z.object({
  language: z.string().trim().min(1).max(32),
  code: z.string().min(1).max(requestLimits.codeChars),
  stdin: z.string().max(requestLimits.stdinChars).optional(),
  source: z.string().trim().min(1).max(32).default("RUN"),
});

export const assistantTurnCommandSchema = z.object({ turnId: z.string().uuid() });

