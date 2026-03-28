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
