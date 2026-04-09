import type { BrowserVoiceState } from "@/lib/voice/types";

export function describeVoiceState(state: BrowserVoiceState) {
  switch (state) {
    case "idle":
      return "Mic off";
    case "starting":
      return "Mic warming up";
    case "listening":
      return "Mic ready - listening";
    case "processing":
      return "Processing speech";
    case "speaking":
      return "AI speaking";
    case "error":
      return "Voice error";
    default:
      return "Unknown";
  }
}

export function describeRoomSystemState(input: {
  voiceState: BrowserVoiceState;
  isAssistantThinking: boolean;
  assistantDraft: string;
  isProviderPreviewing?: boolean;
  awaitingMeasuredReply?: boolean;
}) {
  if (input.awaitingMeasuredReply) {
    return "System: Deliberating";
  }

  if (input.assistantDraft) {
    return "System: Streaming reply";
  }

  if (input.isAssistantThinking) {
    return "System: Deciding";
  }

  if (input.voiceState === "speaking") {
    return "System: Speaking";
  }

  if (input.voiceState === "processing" || input.isProviderPreviewing) {
    return "System: Capturing answer";
  }

  if (input.voiceState === "listening") {
    return "System: Listening";
  }

  return "System: Idle";
}
