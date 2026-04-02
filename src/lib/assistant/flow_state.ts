import type { CandidateSignalSnapshot } from "@/lib/assistant/signal_extractor";
import type { CodingInterviewStage } from "@/lib/assistant/stages";

type TranscriptLike = {
  speaker: "USER" | "AI" | "SYSTEM";
  text: string;
};

export type ContextReestablishmentCost = "low" | "medium" | "high";

export type FlowState = {
  codingBurst: boolean;
  thinkingBurst: boolean;
  muteUntilPause: boolean;
  contextReestablishmentCost: ContextReestablishmentCost;
};

export function assessFlowState(input: {
  currentStage: CodingInterviewStage;
  signals: CandidateSignalSnapshot;
  recentTranscripts?: TranscriptLike[];
}) {
  const recentUserTurns = (input.recentTranscripts ?? []).filter((item) => item.speaker === "USER").slice(-3);
  const recentWordCount = recentUserTurns.reduce(
    (total, turn) => total + turn.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  const longRecentExplanation = recentWordCount >= 70;
  const codingBurst =
    input.currentStage === "IMPLEMENTATION" &&
    input.signals.progress === "progressing" &&
    input.signals.behavior === "structured";
  const thinkingBurst =
    input.currentStage !== "IMPLEMENTATION" &&
    input.signals.reasoningDepth === "deep" &&
    input.signals.communication === "clear" &&
    longRecentExplanation;
  const muteUntilPause = codingBurst || thinkingBurst;
  const contextReestablishmentCost: ContextReestablishmentCost =
    muteUntilPause ? "high" : input.signals.progress === "stuck" ? "low" : "medium";

  return {
    codingBurst,
    thinkingBurst,
    muteUntilPause,
    contextReestablishmentCost,
  } satisfies FlowState;
}
