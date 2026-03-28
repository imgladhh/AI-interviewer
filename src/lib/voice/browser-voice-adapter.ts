import type {
  BrowserVoiceState,
  InterviewVoiceAdapter,
  VoiceAdapterEventHandlers,
  VoiceAvailability,
} from "@/lib/voice/types";

type BrowserSpeechRecognitionAlternative = {
  transcript?: string;
};

type BrowserSpeechRecognitionResult = {
  0?: BrowserSpeechRecognitionAlternative;
  isFinal: boolean;
};

type BrowserSpeechRecognitionResultList = ArrayLike<BrowserSpeechRecognitionResult>;

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
};

type BrowserSpeechRecognitionErrorEvent = {
  error: string;
};

const NON_RECOVERABLE_ERRORS = new Set([
  "audio-capture",
  "not-allowed",
  "service-not-allowed",
  "language-not-supported",
]);

type BrowserSpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognitionInstance;

declare global {
  interface Window {
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
    SpeechRecognition?: BrowserSpeechRecognitionCtor;
  }
}

function emitState(handlers: VoiceAdapterEventHandlers, state: BrowserVoiceState) {
  handlers.onStateChange?.(state);
}

export class BrowserVoiceAdapter implements InterviewVoiceAdapter {
  private recognition: BrowserSpeechRecognitionInstance | null = null;
  private handlers: VoiceAdapterEventHandlers;
  private state: BrowserVoiceState = "idle";
  private speechQueue: Promise<void> = Promise.resolve();
  private isDisposed = false;
  private shouldResumeListening = false;
  private utteranceSpeechDetected = false;
  private speechGeneration = 0;
  private activeInputStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private capturedAudioChunks: BlobPart[] = [];
  private captureMimeType = "audio/webm";
  private analyserContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  private analyserFrameId: number | null = null;
  private speechActive = false;
  private listeningMode: "browser" | "provider" = "browser";

  constructor(handlers: VoiceAdapterEventHandlers) {
    this.handlers = handlers;
    this.recognition = this.createRecognition();
  }

  getAvailability(): VoiceAvailability {
    if (typeof window === "undefined") {
      return {
        speechRecognition: false,
        speechSynthesis: false,
        mediaRecorder: false,
      };
    }

    return {
      speechRecognition: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
      speechSynthesis: "speechSynthesis" in window,
      mediaRecorder: "MediaRecorder" in window,
    };
  }

  async startListening(options?: { continuousMode?: boolean; mode?: "browser" | "provider" }) {
    this.listeningMode = options?.mode ?? "browser";

    if (this.listeningMode === "browser" && !this.recognition) {
      this.handlers.onError?.("Speech recognition is not available in this browser.");
      emitState(this.handlers, "error");
      return;
    }

    try {
      this.shouldResumeListening = options?.continuousMode ?? true;
      this.setState("starting");
      await this.ensureInputStreamReady();
      await wait(120);
      if (this.listeningMode === "provider") {
        this.setState("listening");
        return;
      }
      this.recognition?.start();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start speech recognition.";
      this.handlers.onError?.(message);
      this.setState("error");
    }
  }

  stopListening() {
    this.shouldResumeListening = false;
    this.recognition?.stop();
    this.releaseInputStream();
    if (this.state !== "speaking") {
      this.setState("idle");
    }
  }

  async speakText(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const generation = ++this.speechGeneration;
    const speakTask = async () => {
      if (this.isDisposed || generation !== this.speechGeneration) {
        return;
      }

      this.setState("speaking");

      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => {
          if (!this.isDisposed && generation === this.speechGeneration) {
            this.setState("idle");
          }
          resolve();
        };
        utterance.onerror = () => {
          this.handlers.onError?.("Speech synthesis failed.");
          if (!this.isDisposed && generation === this.speechGeneration) {
            this.setState("error");
          }
          resolve();
        };
        window.speechSynthesis.speak(utterance);
      });
    };

    this.speechQueue = this.speechQueue.then(speakTask, speakTask);
    await this.speechQueue;
  }

  cancelSpeaking() {
    this.speechGeneration += 1;
    this.speechQueue = Promise.resolve();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.setState("idle");
  }

  async consumeCapturedAudio() {
    if (this.capturedAudioChunks.length === 0) {
      return null;
    }

    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.requestData();
      await wait(140);
    }

    const blob = new Blob(this.capturedAudioChunks, {
      type: this.captureMimeType || "audio/webm",
    });
    this.capturedAudioChunks = [];
    return blob.size > 0 ? blob : null;
  }

  async peekCapturedAudio() {
    if (!this.mediaRecorder) {
      return null;
    }

    if (this.mediaRecorder.state === "recording") {
      this.mediaRecorder.requestData();
      await wait(140);
    }

    if (this.capturedAudioChunks.length === 0) {
      return null;
    }

    const blob = new Blob(this.capturedAudioChunks, {
      type: this.captureMimeType || "audio/webm",
    });
    return blob.size > 0 ? blob : null;
  }

  dispose() {
    this.isDisposed = true;
    this.stopListening();
    this.cancelSpeaking();
    this.releaseInputStream();
    this.recognition = null;
  }

  private setState(state: BrowserVoiceState) {
    this.state = state;
    emitState(this.handlers, state);
  }

  private createRecognition(): BrowserSpeechRecognitionInstance | null {
    if (typeof window === "undefined") {
      return null;
    }

    const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      return null;
    }

    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      this.utteranceSpeechDetected = false;
      this.setState("listening");
    };

    recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript?.trim();
        if (!transcript) {
          continue;
        }

        if (!this.utteranceSpeechDetected) {
          this.utteranceSpeechDetected = true;
          this.handlers.onSpeechStart?.();
        }

        this.handlers.onTranscript?.({
          text: transcript,
          isFinal: result.isFinal,
        });
      }
    };

    recognition.onerror = (event: BrowserSpeechRecognitionErrorEvent) => {
      if (NON_RECOVERABLE_ERRORS.has(event.error)) {
        this.shouldResumeListening = false;
      }
      this.handlers.onError?.(`Speech recognition error: ${event.error}`);
      this.setState("error");
    };

    recognition.onend = () => {
      this.utteranceSpeechDetected = false;
      if (this.state !== "speaking" && this.state !== "error") {
        this.setState("idle");
      }

      if (this.shouldResumeListening && !this.isDisposed && this.state !== "error") {
        queueMicrotask(() => {
          if (!this.shouldResumeListening || this.isDisposed || (!this.recognition && this.listeningMode === "browser")) {
            return;
          }

          try {
            this.setState("starting");
            void this.ensureInputStreamReady().then(
              async () => {
                await wait(80);
                if (this.listeningMode === "provider") {
                  this.setState("listening");
                  return;
                }
                this.recognition?.start();
              },
              () => {
                this.shouldResumeListening = false;
              },
            );
          } catch {
            // Browser recognition can throw if restarted too quickly; the next user action can recover.
          }
        });
      }
    };

    return recognition;
  }

  private async ensureInputStreamReady() {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return;
    }

    if (this.activeInputStream && this.activeInputStream.active) {
      return;
    }

    this.activeInputStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ensureMediaRecorder(this.activeInputStream);
    this.ensureAnalyser(this.activeInputStream);
  }

  private releaseInputStream() {
    this.stopAnalyser();

    if (this.mediaRecorder) {
      const recorder = this.mediaRecorder;
      this.mediaRecorder = null;
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }

    if (!this.activeInputStream) {
      return;
    }

    for (const track of this.activeInputStream.getTracks()) {
      track.stop();
    }
    this.activeInputStream = null;
  }

  private ensureMediaRecorder(stream: MediaStream) {
    if (typeof window === "undefined" || !("MediaRecorder" in window)) {
      return;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      return;
    }

    this.capturedAudioChunks = [];
    const recorder = new MediaRecorder(stream);
    this.captureMimeType = recorder.mimeType || "audio/webm";
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.capturedAudioChunks.push(event.data);
      }
    };
    recorder.start(250);
    this.mediaRecorder = recorder;
  }

  private ensureAnalyser(stream: MediaStream) {
    if (typeof window === "undefined") {
      return;
    }

    if (this.analyserFrameId !== null && this.analyserContext && this.analyserNode && this.analyserSource) {
      return;
    }

    const AudioContextCtor = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    this.analyserContext = new AudioContextCtor();
    this.analyserSource = this.analyserContext.createMediaStreamSource(stream);
    this.analyserNode = this.analyserContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserSource.connect(this.analyserNode);

    const samples = new Float32Array(this.analyserNode.fftSize);
    let activeFrames = 0;
    let silentFrames = 0;

    const loop = () => {
      if (!this.analyserNode || this.isDisposed) {
        return;
      }

      this.analyserNode.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const threshold = 0.018;

      if (rms >= threshold) {
        activeFrames += 1;
        silentFrames = 0;
      } else {
        silentFrames += 1;
        activeFrames = 0;
      }

      if (!this.speechActive && activeFrames >= 2) {
        this.speechActive = true;
        this.handlers.onSpeechStart?.();
        this.handlers.onVoiceActivityChange?.(true);
      }

      if (this.speechActive && silentFrames >= 6) {
        this.speechActive = false;
        this.handlers.onVoiceActivityChange?.(false);
      }

      this.analyserFrameId = window.setTimeout(loop, 120) as unknown as number;
    };

    loop();
  }

  private stopAnalyser() {
    if (this.analyserFrameId !== null && typeof window !== "undefined") {
      clearTimeout(this.analyserFrameId);
      this.analyserFrameId = null;
    }

    this.speechActive = false;
    this.handlers.onVoiceActivityChange?.(false);

    this.analyserSource?.disconnect();
    this.analyserNode?.disconnect();
    void this.analyserContext?.close().catch(() => undefined);
    this.analyserSource = null;
    this.analyserNode = null;
    this.analyserContext = null;
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
