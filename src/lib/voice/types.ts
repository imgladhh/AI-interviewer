export type VoiceAvailability = {
  speechRecognition: boolean;
  speechSynthesis: boolean;
  mediaRecorder: boolean;
};

export type VoiceTranscriptChunk = {
  text: string;
  isFinal: boolean;
};

export type VoiceAdapterEventHandlers = {
  onTranscript?: (chunk: VoiceTranscriptChunk) => void;
  onStateChange?: (state: BrowserVoiceState) => void;
  onError?: (message: string) => void;
  onSpeechStart?: () => void;
  onVoiceActivityChange?: (isSpeaking: boolean) => void;
};

export type BrowserVoiceState =
  | "idle"
  | "starting"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export interface InterviewVoiceAdapter {
  getAvailability(): VoiceAvailability;
  startListening(options?: { continuousMode?: boolean; mode?: "browser" | "provider" }): Promise<void>;
  stopListening(): void;
  speakText(text: string): Promise<void>;
  cancelSpeaking(): void;
  consumeCapturedAudio?(): Promise<Blob | null>;
  peekCapturedAudio?(): Promise<Blob | null>;
  dispose(): void;
}
