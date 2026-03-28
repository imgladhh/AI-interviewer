"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  deriveCurrentCodingStage,
  describeCodingStage,
  isCodingInterviewStage,
  type CodingInterviewStage,
} from "@/lib/assistant/stages";
import { getStarterCode, isRunnableLanguage, normalizeLanguage, toMonacoLanguage } from "@/lib/interview/editor";
import { SESSION_EVENT_TYPES } from "@/lib/session/event-types";
import { summarizeUsageFromSessionEvents } from "@/lib/usage/cost";
import { BrowserVoiceAdapter } from "@/lib/voice/browser-voice-adapter";
import {
  getVoiceDiagnostics,
  getVoiceDiagnosticsHints,
  runMicrophonePreflight,
  type VoiceDiagnostics,
} from "@/lib/voice/diagnostics";
import { mergeTranscriptFragments, normalizeTranscriptText } from "@/lib/voice/transcript-normalization";
import {
  getAutoSubmitDelayMs,
  getFinalChunkCommitDelayMs,
  shouldIgnoreInterruptedUtterance,
} from "@/lib/voice/turn-taking";
import type { BrowserVoiceState, InterviewVoiceAdapter, VoiceAvailability } from "@/lib/voice/types";
import { describeVoiceState } from "@/lib/voice/voice-status";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: 360,
        borderRadius: 18,
        border: "1px solid var(--border)",
        background: "#1d2230",
      }}
    />
  ),
});

type TranscriptSegment = {
  id: string;
  speaker: "USER" | "AI" | "SYSTEM";
  segmentIndex: number;
  text: string;
  createdAt: string;
};

type SessionEvent = {
  id: string;
  eventType: string;
  eventTime: string;
  payloadJson: unknown;
};

type ExecutionRun = {
  id: string;
  status: "PASSED" | "FAILED" | "ERROR" | "TIMEOUT";
  stdout: string | null;
  stderr: string | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  createdAt: string;
  codeSnapshot?: {
    id: string;
    language: string;
    snapshotIndex: number;
    source: string;
  } | null;
};

type SessionReportSummary = {
  overallScore: number;
  overallSummary: string;
  recommendation: string;
  strengths: string[];
  weaknesses: string[];
  improvementPlan: string[];
  dimensions: Array<{
    key: string;
    label: string;
    score: number;
    maxScore: number;
    evidence: string;
  }>;
};

type UsageSummary = {
  llmCalls: number;
  sttCalls: number;
  llmEstimatedCostUsd: number;
  sttEstimatedCostUsd: number;
  totalEstimatedCostUsd: number;
};

const defaultVoiceDiagnostics: VoiceDiagnostics = {
  isSecureContext: false,
  speechRecognitionAvailable: false,
  speechSynthesisAvailable: false,
  mediaDevicesAvailable: false,
  microphonePermission: "unknown",
  audioInputCount: null,
  hasAudioInput: null,
  defaultAudioInputLabel: null,
  audioInputs: [],
  getUserMediaAudioAccess: "unknown",
  getUserMediaError: null,
};

type InterviewRoomClientProps = {
  sessionId: string;
  questionTitle: string;
  questionPrompt: string;
  mode: string;
  selectedLanguage: string | null;
  targetLevel: string | null;
  personaEnabled: boolean;
  personaSummary: string | null;
  appliedPromptContext: string | null;
  lowCostMode: boolean;
  initialUsageSummary: UsageSummary;
  initialStage: CodingInterviewStage;
  initialTranscripts: TranscriptSegment[];
  initialEvents: SessionEvent[];
};

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow)",
} as const;

const editorLanguageLabel = (language: string | null) => normalizeLanguage(language);

export function InterviewRoomClient(props: InterviewRoomClientProps) {
  const normalizedLanguage = normalizeLanguage(props.selectedLanguage);
  const monacoLanguage = toMonacoLanguage(props.selectedLanguage);
  const [transcripts, setTranscripts] = useState(props.initialTranscripts);
  const [events, setEvents] = useState(props.initialEvents);
  const [executionRuns, setExecutionRuns] = useState<ExecutionRun[]>([]);
  const [editorCode, setEditorCode] = useState(() => getStarterCode(props.selectedLanguage, props.questionTitle));
  const [isPending, startTransition] = useTransition();
  const [isRunningCode, setIsRunningCode] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<BrowserVoiceState>("idle");
  const [voiceAvailability, setVoiceAvailability] = useState<VoiceAvailability>({
    speechRecognition: false,
    speechSynthesis: false,
    mediaRecorder: false,
  });
  const [dedicatedSttConfigured, setDedicatedSttConfigured] = useState(false);
  const [dedicatedSttProvider, setDedicatedSttProvider] = useState<string | null>(null);
  const [isProviderPreviewing, setIsProviderPreviewing] = useState(false);
  const [draftTranscript, setDraftTranscript] = useState("");
  const [lastVoiceError, setLastVoiceError] = useState<string | null>(null);
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<VoiceDiagnostics>(defaultVoiceDiagnostics);
  const [isRefreshingDiagnostics, setIsRefreshingDiagnostics] = useState(false);
  const [editorStatus, setEditorStatus] = useState(
    isRunnableLanguage(props.selectedLanguage)
      ? "Code execution is ready for this language."
      : "Editing is enabled. Local execution currently supports Python and JavaScript.",
  );
  const [candidateMessage, setCandidateMessage] = useState("");
  const [isAssistantThinking, setIsAssistantThinking] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [reportSummary, setReportSummary] = useState<SessionReportSummary | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummary>(props.initialUsageSummary);
  const [roomNotice, setRoomNotice] = useState("Continuous listening is available when your browser supports speech recognition.");
  const [isContinuousListening, setIsContinuousListening] = useState(false);
  const [lastInterruptionAt, setLastInterruptionAt] = useState<string | null>(null);
  const [pendingConfirmationText, setPendingConfirmationText] = useState<string | null>(null);
  const voiceAdapterRef = useRef<InterviewVoiceAdapter | null>(null);
  const assistantStreamAbortRef = useRef<AbortController | null>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interruptionCooldownUntilRef = useRef<number>(0);
  const interruptionNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmitConfirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubmittedCandidateTextRef = useRef("");
  const pendingSpeechBufferRef = useRef("");
  const providerPreviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const providerSpeechActiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const [transcriptResponse, eventsResponse, runsResponse] = await Promise.all([
        fetch(`/api/sessions/${props.sessionId}/transcripts`, { cache: "no-store" }),
        fetch(`/api/sessions/${props.sessionId}/events`, { cache: "no-store" }),
        fetch(`/api/sessions/${props.sessionId}/code-runs`, { cache: "no-store" }),
      ]);

      const [transcriptPayload, eventsPayload, runsPayload] = await Promise.all([
        transcriptResponse.json(),
        eventsResponse.json(),
        runsResponse.json(),
      ]);

      if (cancelled) {
        return;
      }

      if (transcriptPayload.ok) {
        setTranscripts((current) =>
          mergeById(
            current,
            transcriptPayload.data.transcripts as TranscriptSegment[],
            (items) => items.sort((left, right) => left.segmentIndex - right.segmentIndex),
          ),
        );
      }

      if (eventsPayload.ok) {
        setEvents((current) => {
          const merged = mergeById(
            current,
            eventsPayload.data.events as SessionEvent[],
            (items) =>
              items.sort(
                (left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime(),
              ),
          );
          setUsageSummary(summarizeUsageFromSessionEvents(merged));
          return merged;
        });
      }

      if (runsPayload.ok) {
        setExecutionRuns((current) =>
          mergeById(
            current,
            runsPayload.data.executionRuns as ExecutionRun[],
            (items) =>
              items.sort(
                (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
              ),
          ),
        );
      }
    }

    void refresh();
    const interval = setInterval(() => void refresh(), 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [props.sessionId]);

  useEffect(() => {
    let cancelled = false;

    async function loadExistingReport() {
      const response = await fetch(`/api/sessions/${props.sessionId}/report`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      if (!payload.ok || cancelled) {
        return;
      }

      const reportJson =
        payload.data?.reportJson && typeof payload.data.reportJson === "object"
          ? (payload.data.reportJson as Record<string, unknown>)
          : null;

      if (!reportJson) {
        return;
      }

      setReportSummary({
        overallScore: Number(reportJson.overallScore ?? 0),
        overallSummary: String(reportJson.overallSummary ?? ""),
        recommendation: String(reportJson.recommendation ?? "BORDERLINE"),
        strengths: asStringArray(reportJson.strengths),
        weaknesses: asStringArray(reportJson.weaknesses),
        improvementPlan: asStringArray(reportJson.improvementPlan),
        dimensions: Array.isArray(reportJson.dimensions)
          ? (reportJson.dimensions as SessionReportSummary["dimensions"])
          : [],
      });
    }

    void loadExistingReport();
    return () => {
      cancelled = true;
    };
  }, [props.sessionId]);

  useEffect(() => {
    void fetch(`/api/sessions/${props.sessionId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: SESSION_EVENT_TYPES.INTERVIEW_ROOM_OPENED,
        payloadJson: {
          room: "coding-room",
        },
      }),
    });
  }, [props.sessionId]);

  useEffect(() => {
    const adapter = new BrowserVoiceAdapter({
      onSpeechStart: () => {
        cancelPendingAutoSubmitConfirmation();
        void interruptAiTurn("candidate_speech");
      },
      onTranscript: (chunk) => {
        if (dedicatedSttConfigured) {
          return;
        }

        const normalizedChunk = normalizeTranscriptText(chunk.text);
        const mergedText = mergeTranscriptFragments(pendingSpeechBufferRef.current, normalizedChunk);

        if (chunk.isFinal) {
          pendingSpeechBufferRef.current = mergedText;
          setDraftTranscript("");
          setVoiceState("processing");
        } else {
          setDraftTranscript(mergedText);
          setVoiceState("listening");
        }

        if (chunk.isFinal) {
          clearSilenceTimer();
          scheduleFinalTranscriptSubmit(mergedText);
          return;
        }

        clearPendingFinalTranscript();
        scheduleSilenceSubmit(mergedText);
      },
      onStateChange: (state) => {
        setVoiceState(state);
      },
      onError: (message) => {
        setLastVoiceError(message);
        void refreshVoiceDiagnostics();
      },
      onVoiceActivityChange: (isSpeaking) => {
        providerSpeechActiveRef.current = isSpeaking;

        if (!dedicatedSttConfigured) {
          return;
        }

        if (isSpeaking) {
          cancelPendingAutoSubmitConfirmation();
          clearSilenceTimer();
          clearPendingFinalTranscript();
          void interruptAiTurn("candidate_speech");
          void requestProviderPreviewTranscript(true);
          scheduleProviderPreviewLoop();
          return;
        }

        clearProviderPreviewTimer();
        void requestProviderPreviewTranscript(true).finally(() => {
          scheduleProviderSilenceSubmit();
        });
      },
    });

    voiceAdapterRef.current = adapter;
    setVoiceAvailability(adapter.getAvailability());

    return () => {
      clearSilenceTimer();
      clearPendingFinalTranscript();
      cancelPendingAutoSubmitConfirmation();
      clearInterruptionNoticeTimer();
      clearProviderPreviewTimer();
      adapter.dispose();
      voiceAdapterRef.current = null;
    };
  }, [dedicatedSttConfigured, props.sessionId]);

  useEffect(() => {
    void refreshVoiceDiagnostics();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSttStatus() {
      const response = await fetch("/api/stt/status", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) {
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!payload?.ok || cancelled) {
        return;
      }

      setDedicatedSttConfigured(Boolean(payload.data?.configured));
      setDedicatedSttProvider(typeof payload.data?.provider === "string" ? payload.data.provider : null);
    }

    void loadSttStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (voiceState === "starting") {
      setRoomNotice("Microphone is warming up. Wait for the room to say it is ready before you begin speaking.");
      return;
    }

    if (voiceState === "listening") {
      setRoomNotice(
        dedicatedSttConfigured
          ? isContinuousListening
            ? "Microphone ready in dedicated STT mode. Start speaking and the room will detect speech activity before finalizing a provider transcript."
            : "Microphone ready in dedicated STT mode. Hold the button and start speaking now."
          : isContinuousListening
            ? "Microphone ready. You can start speaking now, and the room will wait for a short pause before submitting."
            : "Microphone ready. Hold the button and start speaking now.",
      );
      return;
    }

    if (voiceState === "idle" && !isContinuousListening) {
      setRoomNotice("Microphone is off. Click Start Mic and wait for the ready state before speaking.");
    }
  }, [voiceState, isContinuousListening, dedicatedSttConfigured]);

  const timeline = useMemo(() => {
    return [...events].sort((left, right) => {
      return new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime();
    });
  }, [events]);

  const voiceDiagnosticHints = useMemo(
    () => getVoiceDiagnosticsHints({ diagnostics: voiceDiagnostics, lastVoiceError }),
    [voiceDiagnostics, lastVoiceError],
  );

  const latestRun = executionRuns[0] ?? null;
  const currentStage = useMemo(() => {
    if (events.length === 0 && transcripts.length === 0 && !latestRun) {
      return props.initialStage;
    }

    return deriveCurrentCodingStage({
      events,
      transcripts,
      latestExecutionRun: latestRun,
    });
  }, [events, latestRun, props.initialStage, transcripts]);

  function runAction(action: () => Promise<void>) {
    setActionError(null);
    startTransition(() => {
      void action().catch((error) => {
        setActionError(error instanceof Error ? error.message : "Unknown action failure");
      });
    });
  }

  async function refreshVoiceDiagnostics() {
    setIsRefreshingDiagnostics(true);
    try {
      const diagnostics = await getVoiceDiagnostics();
      setVoiceDiagnostics(diagnostics);
    } finally {
      setIsRefreshingDiagnostics(false);
    }
  }

  function beginAutoSubmitConfirmation(
    text: string,
    options: { autoSubmitted: true; source: string },
  ) {
    cancelPendingAutoSubmitConfirmation();
    setPendingConfirmationText(text);
    setRoomNotice("Candidate turn captured. Waiting 1 second in case you want to keep talking before sending it to the interviewer.");

    autoSubmitConfirmationTimeoutRef.current = setTimeout(() => {
      setPendingConfirmationText(null);
      autoSubmitConfirmationTimeoutRef.current = null;
      void handleCandidateMessage(text, options);
    }, 1000);
  }

  function clearSilenceTimer() {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }

  function clearPendingFinalTranscript() {
    if (finalTranscriptTimeoutRef.current) {
      clearTimeout(finalTranscriptTimeoutRef.current);
      finalTranscriptTimeoutRef.current = null;
    }
  }

  function clearInterruptionNoticeTimer() {
    if (interruptionNoticeTimeoutRef.current) {
      clearTimeout(interruptionNoticeTimeoutRef.current);
      interruptionNoticeTimeoutRef.current = null;
    }
  }

  function clearProviderPreviewTimer() {
    if (providerPreviewTimeoutRef.current) {
      clearTimeout(providerPreviewTimeoutRef.current);
      providerPreviewTimeoutRef.current = null;
    }
  }

  function cancelPendingAutoSubmitConfirmation() {
    if (autoSubmitConfirmationTimeoutRef.current) {
      clearTimeout(autoSubmitConfirmationTimeoutRef.current);
      autoSubmitConfirmationTimeoutRef.current = null;
    }

    if (pendingConfirmationText) {
      pendingSpeechBufferRef.current = mergeTranscriptFragments(
        pendingSpeechBufferRef.current,
        pendingConfirmationText,
      );
      setDraftTranscript(pendingSpeechBufferRef.current);
      setPendingConfirmationText(null);
      setRoomNotice("Heard more audio, so the pending auto-submit was cancelled and merged back into your turn.");
    }
  }

  function interruptedRecently() {
    return Date.now() < interruptionCooldownUntilRef.current;
  }

  async function requestProviderPreviewTranscript(force = false) {
    if (!dedicatedSttConfigured || !voiceAdapterRef.current?.peekCapturedAudio) {
      return;
    }

    if (isProviderPreviewing && !force) {
      return;
    }

    const audioBlob = await voiceAdapterRef.current.peekCapturedAudio();
    if (!audioBlob || audioBlob.size < (props.lowCostMode ? 18000 : 12000)) {
      return;
    }

    setIsProviderPreviewing(true);

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "candidate-preview.webm");
      formData.append("sessionId", props.sessionId);
      formData.append("preview", "true");
      formData.append("lowCostMode", String(props.lowCostMode));

      const response = await fetch("/api/stt/transcribe", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        return;
      }

      const previewText =
        typeof payload.data?.text === "string" ? normalizeTranscriptText(payload.data.text) : "";
      if (!previewText) {
        return;
      }

      pendingSpeechBufferRef.current = previewText;
      setDraftTranscript(previewText);
    } finally {
      setIsProviderPreviewing(false);
    }
  }

  function scheduleProviderPreviewLoop() {
    clearProviderPreviewTimer();
    if (!dedicatedSttConfigured || !isContinuousListening) {
      return;
    }

    providerPreviewTimeoutRef.current = setTimeout(() => {
      if (!providerSpeechActiveRef.current) {
        return;
      }

      void requestProviderPreviewTranscript().finally(() => {
        scheduleProviderPreviewLoop();
      });
    }, props.lowCostMode ? 4200 : 3200);
  }

  function scheduleProviderSilenceSubmit() {
    clearSilenceTimer();
    if (!isContinuousListening) {
      return;
    }

    const candidateText = normalizeTranscriptText(pendingSpeechBufferRef.current || draftTranscript);
    const delayMs = getAutoSubmitDelayMs({
      text: candidateText || "spoken candidate answer",
      interruptedRecently: interruptedRecently(),
    });

    if (delayMs === null) {
      return;
    }

    silenceTimeoutRef.current = setTimeout(() => {
      const previewText = normalizeTranscriptText(pendingSpeechBufferRef.current || draftTranscript);
      beginAutoSubmitConfirmation(previewText, {
        autoSubmitted: true,
        source: "provider_vad",
      });
    }, delayMs);
  }

  function scheduleSilenceSubmit(text: string) {
    clearSilenceTimer();
    if (!isContinuousListening || !text.trim()) {
      return;
    }

    const delayMs = getAutoSubmitDelayMs({
      text,
      interruptedRecently: interruptedRecently(),
    });

    if (delayMs === null) {
      return;
    }

    silenceTimeoutRef.current = setTimeout(() => {
      const stableText = normalizeTranscriptText(text);
      if (!stableText) {
        return;
      }

      const normalized = normalizeCandidateText(stableText);
      if (normalized === lastSubmittedCandidateTextRef.current) {
        return;
      }

      pendingSpeechBufferRef.current = stableText;
      setDraftTranscript("");
      beginAutoSubmitConfirmation(stableText, {
        autoSubmitted: true,
        source: "silence_timeout",
      });
    }, delayMs);
  }

  function scheduleFinalTranscriptSubmit(text: string) {
    clearPendingFinalTranscript();
    const mergedFinalText = mergeTranscriptFragments(pendingSpeechBufferRef.current, normalizeTranscriptText(text));
    pendingSpeechBufferRef.current = mergedFinalText;

    const delayMs = getFinalChunkCommitDelayMs({
      text: mergedFinalText,
      interruptedRecently: interruptedRecently(),
    });

    if (delayMs === null) {
      setDraftTranscript("");
      setRoomNotice("Short interruption captured. Keep going when you're ready.");
      return;
    }

    finalTranscriptTimeoutRef.current = setTimeout(() => {
      setDraftTranscript("");
      void handleCandidateMessage(mergedFinalText, {
        source: "speech_final",
      });
    }, delayMs);
  }

  async function postTranscript(
    speaker: "USER" | "AI",
    text: string,
    options?: {
      transcriptSource?: "manual" | "browser" | "openai-stt" | "assistant";
      transcriptProvider?: string;
      sourceText?: string;
    },
  ) {
    const normalizedText = normalizeTranscriptText(text);
    const response = await fetch(`/api/sessions/${props.sessionId}/transcripts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        speaker,
        text: normalizedText,
        isFinal: true,
        transcriptSource: options?.transcriptSource,
        transcriptProvider: options?.transcriptProvider,
        sourceText: options?.sourceText,
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to persist transcript segment.");
    }

    const payload = await response.json();
    if (payload.ok) {
      setTranscripts((current) =>
        mergeById(current, [payload.data.transcript as TranscriptSegment], (items) =>
          items.sort((left, right) => left.segmentIndex - right.segmentIndex),
        ),
      );
      setDraftTranscript("");
      if (speaker === "USER") {
        pendingSpeechBufferRef.current = "";
      }
    }
  }

  async function refineSpeechTranscriptWithProvider(browserText: string) {
    const audioBlob = await voiceAdapterRef.current?.consumeCapturedAudio?.();
    if (!audioBlob || audioBlob.size < (props.lowCostMode ? 18000 : 12000)) {
      return {
        text: browserText,
        transcriptSource: "browser" as const,
        transcriptProvider: "browser-speech-recognition",
      };
    }

    const formData = new FormData();
    formData.append("audio", audioBlob, "candidate-turn.webm");
    formData.append("sessionId", props.sessionId);
    formData.append("preview", "false");
    formData.append("lowCostMode", String(props.lowCostMode));

    try {
      const response = await fetch("/api/stt/transcribe", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : "Dedicated STT failed, so the room fell back to browser transcription.";
        setRoomNotice(message);
        return {
          text: browserText,
          transcriptSource: "browser" as const,
          transcriptProvider: "browser-speech-recognition",
        };
      }

      const refinedText =
        typeof payload.data?.text === "string" && payload.data.text.trim()
          ? payload.data.text.trim()
          : browserText;
      const provider =
        typeof payload.data?.provider === "string" ? payload.data.provider : "openai-stt";
      const changed =
        normalizeCandidateText(refinedText) !== normalizeCandidateText(browserText);

      setRoomNotice(
        changed
          ? "Dedicated speech transcription refined your latest answer before it was sent to the interviewer."
          : "Dedicated speech transcription confirmed your latest answer.",
      );

      return {
        text: refinedText,
        transcriptSource: "openai-stt" as const,
        transcriptProvider: provider,
      };
    } catch {
      setRoomNotice("Dedicated STT was unavailable, so the room used the browser transcript for this turn.");
      return {
        text: browserText,
        transcriptSource: "browser" as const,
        transcriptProvider: "browser-speech-recognition",
      };
    }
  }

  async function requestAssistantTurn() {
    await interruptAiTurn();
    setIsAssistantThinking(true);
    setAssistantDraft("");

    try {
      const abortController = new AbortController();
      assistantStreamAbortRef.current = abortController;

      const response = await fetch(`/api/sessions/${props.sessionId}/assistant-turn/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? "Unable to generate assistant reply.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let spokenIndex = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const eventsPayload = buffer.split("\n\n");
        buffer = eventsPayload.pop() ?? "";

        for (const rawEvent of eventsPayload) {
          const parsed = parseSseEvent(rawEvent);
          if (!parsed) {
            continue;
          }

          if (parsed.event === "delta") {
            const text = typeof parsed.data?.text === "string" ? parsed.data.text : "";
            accumulated += text;
            setAssistantDraft(accumulated);

            const readyToSpeak = extractSpeakableText(accumulated, spokenIndex);
            if (readyToSpeak.text) {
              spokenIndex = readyToSpeak.nextIndex;
              await voiceAdapterRef.current?.speakText(readyToSpeak.text);
            }
          }

          if (parsed.event === "error") {
            const message =
              typeof parsed.data?.message === "string"
                ? parsed.data.message
                : "Unable to generate assistant reply.";
            throw new Error(message);
          }

          if (parsed.event === "done") {
            const payload = parsed.data as {
              transcript?: TranscriptSegment;
              events?: SessionEvent[];
            };
            setAssistantDraft("");

            const finalTranscript = payload.transcript;
            if (finalTranscript) {
              setTranscripts((current) =>
                mergeById(current, [finalTranscript], (items) =>
                  items.sort((left, right) => left.segmentIndex - right.segmentIndex),
                ),
              );
            }

            const finalEvents = payload.events;
            if (Array.isArray(finalEvents) && finalEvents.length > 0) {
              setEvents((current) =>
                mergeById(current, finalEvents, (items) =>
                  items.sort(
                    (left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime(),
                  ),
                ),
              );
            }

            if (accumulated.length > spokenIndex) {
              await voiceAdapterRef.current?.speakText(accumulated.slice(spokenIndex).trim());
            }
          }
        }
      }
    } finally {
      assistantStreamAbortRef.current = null;
      setIsAssistantThinking(false);
    }
  }

  async function handleCandidateMessage(
    text: string,
    options?: { autoSubmitted?: boolean; source?: string },
  ) {
    const browserText = normalizeTranscriptText(text);
    if (!browserText && !(dedicatedSttConfigured && options?.source === "provider_vad")) {
      return;
    }

    const speechDrivenSource =
      options?.source === "speech_final" ||
      options?.source === "silence_timeout" ||
      options?.source === "provider_vad" ||
      Boolean(options?.autoSubmitted);

    const transcriptResult = speechDrivenSource
      ? await refineSpeechTranscriptWithProvider(browserText)
      : {
          text: browserText,
          transcriptSource: "manual" as const,
          transcriptProvider: "manual-entry",
        };

    const normalizedText = normalizeTranscriptText(transcriptResult.text);
    const normalized = normalizeCandidateText(normalizedText);
    if (!normalized) {
      return;
    }

    if (speechDrivenSource && shouldIgnoreInterruptedUtterance(normalized, interruptedRecently())) {
      setRoomNotice("Taking a short pause. The room is still listening for the rest of your answer.");
      return;
    }

    if (speechDrivenSource && shouldDelaySpeechDrivenCommit(normalizedText)) {
      pendingSpeechBufferRef.current = mergeTranscriptFragments(pendingSpeechBufferRef.current, normalizedText);
      setDraftTranscript(pendingSpeechBufferRef.current);
      setRoomNotice("That sounded incomplete, so the room is giving you a bit more time before submitting.");
      scheduleSilenceSubmit(pendingSpeechBufferRef.current);
      return;
    }

    lastSubmittedCandidateTextRef.current = normalized;
    if (options?.autoSubmitted) {
      setRoomNotice("Candidate turn auto-submitted after a short pause.");
      await postEvent(SESSION_EVENT_TYPES.CANDIDATE_TURN_AUTOSUBMITTED, {
        source: options.source ?? "silence_timeout",
        textPreview: normalized.slice(0, 120),
      });
    }
    await postTranscript("USER", normalizedText, {
      transcriptSource: transcriptResult.transcriptSource,
      transcriptProvider: transcriptResult.transcriptProvider,
      sourceText:
        transcriptResult.transcriptSource === "openai-stt" ? browserText : undefined,
    });
    if (transcriptResult.transcriptSource === "openai-stt") {
      setRoomNotice("Dedicated STT finalized your latest spoken answer and passed that transcript to the interviewer.");
    }
    await requestAssistantTurn();
  }

  async function postEvent(eventType: string, payloadJson?: Record<string, unknown>) {
    const response = await fetch(`/api/sessions/${props.sessionId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        payloadJson,
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to persist session event.");
    }

    const payload = await response.json();
    if (payload.ok) {
      setEvents((current) =>
        mergeById(current, [payload.data.event as SessionEvent], (items) =>
          items.sort((left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime()),
        ),
      );
    }
  }

  async function runCode() {
    setIsRunningCode(true);
    setActionError(null);
    setEditorStatus(`Running ${editorLanguageLabel(props.selectedLanguage)} in local sandbox...`);

    try {
      const response = await fetch(`/api/sessions/${props.sessionId}/code-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: normalizedLanguage,
          code: editorCode,
          source: "RUN",
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Unable to execute code.");
      }

      setExecutionRuns((current) =>
        mergeById(current, [payload.data.executionRun as ExecutionRun], (items) =>
          items
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
            .slice(0, 10),
        ),
      );
      setEditorStatus(`Latest run: ${payload.data.executionRun.status}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to execute code.";
      setActionError(message);
      setEditorStatus(message);
    } finally {
      setIsRunningCode(false);
    }
  }

  async function generateReport() {
    setIsGeneratingReport(true);
    setActionError(null);

    try {
      const response = await fetch(`/api/sessions/${props.sessionId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Unable to generate feedback report.");
      }

      setReportSummary(payload.data.evaluation as SessionReportSummary);
      if (payload.data.event) {
        setEvents((current) =>
          mergeById(current, [payload.data.event as SessionEvent], (items) =>
            items.sort((left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime()),
          ),
        );
      }
      setRoomNotice("Feedback report generated from the current session signals.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate feedback report.";
      setActionError(message);
    } finally {
      setIsGeneratingReport(false);
    }
  }

  async function startListening() {
    if (!voiceAdapterRef.current) {
      setLastVoiceError("Voice adapter is not ready.");
      return;
    }

    setLastVoiceError(null);
    await refreshVoiceDiagnostics();
    const preflight = await runMicrophonePreflight();
    if (preflight.status === "failed") {
      const message = `Microphone preflight failed: ${preflight.error ?? "unknown error"}`;
      setLastVoiceError(message);
      setRoomNotice("The browser could not open a live microphone stream, so speech recognition was not started.");
      await refreshVoiceDiagnostics();
      return;
    }
    clearPendingFinalTranscript();
    clearProviderPreviewTimer();
    pendingSpeechBufferRef.current = "";
    setDraftTranscript("");
    setRoomNotice(
      dedicatedSttConfigured
        ? "Continuous listening is on in dedicated STT mode. The room will detect speech activity and refine turns with the provider."
        : "Continuous listening is on. The room will auto-submit a candidate turn after a short pause.",
    );
    setIsContinuousListening(true);
    await postEvent(SESSION_EVENT_TYPES.LISTENING_STARTED, {
      mode: "continuous",
      transcriptionMode: dedicatedSttConfigured ? "provider" : "browser",
    });
    await voiceAdapterRef.current.startListening({
      continuousMode: true,
      mode: dedicatedSttConfigured ? "provider" : "browser",
    });
  }

  async function startPushToTalk() {
    if (!voiceAdapterRef.current) {
      setLastVoiceError("Voice adapter is not ready.");
      return;
    }

    setLastVoiceError(null);
    await refreshVoiceDiagnostics();
    const preflight = await runMicrophonePreflight();
    if (preflight.status === "failed") {
      const message = `Microphone preflight failed: ${preflight.error ?? "unknown error"}`;
      setLastVoiceError(message);
      setRoomNotice("The browser could not open a live microphone stream, so push-to-talk was not started.");
      await refreshVoiceDiagnostics();
      return;
    }
    clearPendingFinalTranscript();
    clearProviderPreviewTimer();
    pendingSpeechBufferRef.current = "";
    setDraftTranscript("");
    setRoomNotice(
      dedicatedSttConfigured
        ? "Push-to-talk is active in dedicated STT mode."
        : "Push-to-talk is active while you hold the button.",
    );
    await voiceAdapterRef.current.startListening({
      continuousMode: false,
      mode: dedicatedSttConfigured ? "provider" : "browser",
    });
  }

  async function stopListening() {
    clearSilenceTimer();
    clearPendingFinalTranscript();
    clearProviderPreviewTimer();
    const pendingProviderText = normalizeTranscriptText(pendingSpeechBufferRef.current || draftTranscript);
    if (isContinuousListening) {
      setRoomNotice("Continuous listening stopped.");
      setIsContinuousListening(false);
      await postEvent(SESSION_EVENT_TYPES.LISTENING_STOPPED, {
        mode: "continuous",
      });
    } else if (dedicatedSttConfigured && pendingProviderText) {
      setRoomNotice("Push-to-talk ended. Finalizing your spoken answer with dedicated STT.");
      await handleCandidateMessage(pendingProviderText, {
        source: "provider_vad",
      });
    }
    voiceAdapterRef.current?.stopListening();
  }

  async function interruptAiTurn(reason: "candidate_speech" | "manual" = "manual") {
    const wasStreaming = Boolean(assistantStreamAbortRef.current) || Boolean(assistantDraft);
    const wasSpeaking = voiceState === "speaking";

    assistantStreamAbortRef.current?.abort();
    assistantStreamAbortRef.current = null;
    voiceAdapterRef.current?.cancelSpeaking();
    setAssistantDraft("");
    setIsAssistantThinking(false);

    if (reason === "candidate_speech" && (wasStreaming || wasSpeaking)) {
      interruptionCooldownUntilRef.current = Date.now() + 2500;
      setLastInterruptionAt(new Date().toISOString());
      setRoomNotice("AI response interrupted because the candidate started speaking.");
      clearInterruptionNoticeTimer();
      interruptionNoticeTimeoutRef.current = setTimeout(() => {
        setLastInterruptionAt(null);
      }, 4000);
      await postEvent(SESSION_EVENT_TYPES.AI_INTERRUPTED_BY_CANDIDATE, {
        hadLiveDraft: wasStreaming,
        wasSpeaking,
      });
    }
  }

  async function speakAiPrompt(text: string) {
    await postTranscript("AI", text, {
      transcriptSource: "assistant",
      transcriptProvider: "browser-tts",
    });
    await voiceAdapterRef.current?.speakText(text);
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24 }}>
      <div style={{ width: "min(1280px, 100%)", margin: "0 auto", display: "grid", gap: 18 }}>
        <header
          style={{
            ...cardStyle,
            padding: 24,
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <p style={{ margin: 0, color: "var(--accent-strong)", fontWeight: 700 }}>INTERVIEW ROOM</p>
            <h1 style={{ margin: "6px 0 0" }}>{props.questionTitle}</h1>
          </div>
          <div style={{ color: "var(--muted)" }}>
            <div>Mode: {props.mode}</div>
            <div>Language: {editorLanguageLabel(props.selectedLanguage)}</div>
            <div>Level: {props.targetLevel ?? "Unspecified"}</div>
            <div>Persona: {props.personaEnabled ? "Enabled" : "Generic"}</div>
            <div>Stage: {describeCodingStage(currentStage)}</div>
          </div>
        </header>

        <section
          style={{
            ...cardStyle,
            padding: 16,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <StatusPill label={describeVoiceState(voiceState)} tone={voiceTone(voiceState)} />
            <StatusPill label={`Stage: ${describeCodingStage(currentStage)}`} tone="neutral" />
            <StatusPill label={props.lowCostMode ? "Low-cost mode on" : "Standard cost mode"} tone="warning" />
            {isContinuousListening ? <StatusPill label="Continuous Listening On" tone="success" /> : null}
            {isAssistantThinking ? <StatusPill label="AI Generating" tone="info" /> : null}
            {assistantDraft ? <StatusPill label="AI Streaming" tone="info" /> : null}
            {lastInterruptionAt ? <StatusPill label="AI Interrupted" tone="warning" /> : null}
          </div>
          <span style={{ color: "var(--muted)", fontSize: 14 }}>{roomNotice}</span>
        </section>

        <section style={{ display: "grid", gap: 18, gridTemplateColumns: "340px 1fr 360px" }}>
          <aside
            style={{
              ...cardStyle,
              padding: 20,
              display: "grid",
              gap: 18,
              alignContent: "start",
            }}
          >
            <div>
              <h2 style={{ marginTop: 0 }}>Prompt</h2>
              <p style={{ color: "var(--muted)", marginBottom: 0 }}>{props.questionPrompt}</p>
            </div>

            <div>
              <h2 style={{ marginTop: 0 }}>Interviewer Context</h2>
              <p style={{ color: "var(--muted)" }}>
                {props.personaSummary ?? "Generic interviewer persona for now."}
              </p>
              <p style={{ margin: "10px 0 0", color: "var(--text)", fontWeight: 600 }}>
                Current stage: {describeCodingStage(currentStage)}
              </p>
              {props.appliedPromptContext ? (
                <p style={{ marginBottom: 0, fontSize: 14, color: "var(--muted)" }}>
                  Applied prompt context prepared and stored for orchestrator integration.
                </p>
              ) : null}
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.75)",
                  display: "grid",
                  gap: 4,
                }}
              >
                <strong>Usage so far</strong>
                <span style={{ color: "var(--muted)", fontSize: 14 }}>
                  LLM calls: {usageSummary.llmCalls} · STT calls: {usageSummary.sttCalls}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 14 }}>
                  Estimated cost: ${usageSummary.totalEstimatedCostUsd.toFixed(4)}
                </span>
              </div>
            </div>

            <div
              style={{
                padding: 16,
                borderRadius: 16,
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
                display: "grid",
                gap: 10,
              }}
            >
              <strong>Room Actions</strong>
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 12,
                  borderRadius: 12,
                  background: "#fff",
                  border: "1px solid var(--border)",
                }}
              >
                <strong>Voice Controls</strong>
                <span style={{ color: "var(--muted)" }}>
                  {describeVoiceState(voiceState)}
                  {!voiceAvailability.speechRecognition ? " (speech recognition unavailable in this browser)" : ""}
                </span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    style={actionButtonStyle}
                    disabled={!voiceAvailability.speechRecognition || isPending}
                    onClick={() => runAction(startListening)}
                  >
                    Start Mic
                  </button>
                  <button
                    style={actionButtonStyle}
                    disabled={!voiceAvailability.speechRecognition || isPending}
                    onClick={() => runAction(stopListening)}
                    onMouseDown={() => {
                      void startPushToTalk();
                    }}
                    onMouseUp={() => void stopListening()}
                    onMouseLeave={() => void stopListening()}
                  >
                    Push to Talk
                  </button>
                  <button
                    style={actionButtonStyle}
                    disabled={!voiceAvailability.speechRecognition || isPending}
                    onClick={() => runAction(stopListening)}
                  >
                    Stop Mic
                  </button>
                </div>
                {draftTranscript ? (
                  <div style={{ color: "var(--muted)", fontSize: 14 }}>
                    {dedicatedSttConfigured ? "Provider draft transcript" : "Draft transcript"}: {draftTranscript}
                  </div>
                ) : null}
                {isProviderPreviewing ? (
                  <div style={{ color: "var(--accent-strong)", fontSize: 14 }}>
                    Dedicated STT is previewing your current speech...
                  </div>
                ) : null}
                {pendingConfirmationText ? (
                  <div style={{ color: "#8a5a00", fontSize: 14 }}>
                    Pending confirmation: {pendingConfirmationText}
                  </div>
                ) : null}
                {lastVoiceError ? <span style={{ color: "var(--danger)" }}>{lastVoiceError}</span> : null}
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    padding: 12,
                    borderRadius: 12,
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <strong>Voice Diagnostics</strong>
                    <button
                      style={smallButtonStyle}
                      disabled={isRefreshingDiagnostics}
                      onClick={() => runAction(refreshVoiceDiagnostics)}
                    >
                      {isRefreshingDiagnostics ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                  <DiagnosticRow label="Secure context" value={voiceDiagnostics.isSecureContext ? "Yes" : "No"} ok={voiceDiagnostics.isSecureContext} />
                  <DiagnosticRow
                    label="Speech recognition API"
                    value={voiceDiagnostics.speechRecognitionAvailable ? "Available" : "Unavailable"}
                    ok={voiceDiagnostics.speechRecognitionAvailable}
                  />
                  <DiagnosticRow
                    label="Speech synthesis"
                    value={voiceDiagnostics.speechSynthesisAvailable ? "Available" : "Unavailable"}
                    ok={voiceDiagnostics.speechSynthesisAvailable}
                  />
                  <DiagnosticRow
                    label="Media devices API"
                    value={voiceDiagnostics.mediaDevicesAvailable ? "Available" : "Unavailable"}
                    ok={voiceDiagnostics.mediaDevicesAvailable}
                  />
                  <DiagnosticRow
                    label="Media recorder"
                    value={voiceAvailability.mediaRecorder ? "Available" : "Unavailable"}
                    ok={voiceAvailability.mediaRecorder}
                  />
                  <DiagnosticRow
                    label="Dedicated STT"
                    value={dedicatedSttConfigured ? `Configured (${dedicatedSttProvider ?? "provider"})` : "Not configured"}
                    ok={dedicatedSttConfigured}
                  />
                  <DiagnosticRow
                    label="Microphone permission"
                    value={voiceDiagnostics.microphonePermission}
                    ok={
                      voiceDiagnostics.microphonePermission === "granted" ||
                      voiceDiagnostics.microphonePermission === "prompt"
                    }
                  />
                  <DiagnosticRow
                    label="Audio input devices"
                    value={
                      voiceDiagnostics.audioInputCount === null
                        ? "Unknown"
                        : `${voiceDiagnostics.audioInputCount} detected`
                    }
                    ok={voiceDiagnostics.hasAudioInput !== false}
                  />
                  <DiagnosticRow
                    label="Browser mic preflight"
                    value={voiceDiagnostics.getUserMediaAudioAccess}
                    ok={voiceDiagnostics.getUserMediaAudioAccess === "ok" || voiceDiagnostics.getUserMediaAudioAccess === "unknown"}
                  />
                  <DiagnosticRow
                    label="Default input"
                    value={voiceDiagnostics.defaultAudioInputLabel ?? "Unknown"}
                    ok={Boolean(voiceDiagnostics.defaultAudioInputLabel)}
                  />
                  {lastVoiceError ? (
                    <DiagnosticRow label="Last recognition error" value={lastVoiceError} ok={false} />
                  ) : null}
                  {voiceDiagnostics.getUserMediaError ? (
                    <DiagnosticRow label="Preflight error" value={voiceDiagnostics.getUserMediaError} ok={false} />
                  ) : null}
                  {voiceDiagnostics.audioInputs.length > 0 ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>Detected microphones</strong>
                      {voiceDiagnostics.audioInputs.map((device) => (
                        <div key={device.deviceId || device.label} style={diagnosticHintStyle}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <strong>{device.label}</strong>
                            <span style={{ color: device.suspectVirtual ? "#8a5a00" : "var(--muted)", fontSize: 13 }}>
                              {device.isDefault ? "default" : "secondary"}
                              {device.suspectVirtual ? " • possible virtual/bluetooth" : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {voiceDiagnosticHints.length > 0 ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>Suggested fixes</strong>
                      {voiceDiagnosticHints.map((hint) => (
                        <div key={hint} style={diagnosticHintStyle}>
                          {hint}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: "var(--muted)", fontSize: 14 }}>
                      No obvious browser-side blockers detected.
                    </span>
                  )}
                </div>
              </div>
              <button
                style={actionButtonStyle}
                disabled={isPending}
                onClick={() =>
                  runAction(async () => {
                    await postEvent(SESSION_EVENT_TYPES.QUESTION_SHOWN, { surfacedInRoom: true });
                    await speakAiPrompt(`Let's begin. Walk me through your approach for ${props.questionTitle}.`);
                  })
                }
              >
                Simulate AI Intro
              </button>
              <button
                style={actionButtonStyle}
                disabled={isPending}
                onClick={() =>
                  runAction(async () => {
                    await handleCandidateMessage(
                      "I would start by clarifying constraints and then think through a hash map based approach.",
                    );
                  })
                }
              >
                Simulate Candidate Reply
              </button>
              <button
                style={actionButtonStyle}
                disabled={isPending || isAssistantThinking}
                onClick={() => runAction(async () => requestAssistantTurn())}
              >
                {isAssistantThinking ? "AI Thinking..." : "Ask AI Follow-up"}
              </button>
              <button
                style={actionButtonStyle}
                disabled={isPending}
                onClick={() =>
                  runAction(async () => {
                    await postEvent(SESSION_EVENT_TYPES.HINT_REQUESTED, { source: "room-controls" });
                    await requestAssistantTurn();
                  })
                }
              >
                Request Hint
              </button>
              <button
                style={actionButtonStyle}
                disabled={isGeneratingReport || isPending}
                onClick={() => runAction(generateReport)}
              >
                {isGeneratingReport ? "Generating Report..." : "Generate Report"}
              </button>
              <Link href={`/report/${props.sessionId}`} style={linkButtonStyle}>
                View Full Report
              </Link>
              <button
                style={actionButtonStyle}
                disabled={isPending}
                onClick={() =>
                  runAction(async () =>
                    postEvent(SESSION_EVENT_TYPES.STAGE_ADVANCED, {
                      previousStage: currentStage,
                      stage: "APPROACH_DISCUSSION",
                      source: "room-controls",
                    }),
                  )
                }
              >
                Advance Stage
              </button>
              {actionError ? <span style={{ color: "var(--danger)" }}>{actionError}</span> : null}
            </div>
          </aside>

          <section
            style={{
              ...cardStyle,
              padding: 20,
              display: "grid",
              gap: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <strong>Code Workspace</strong>
                <div style={{ color: "var(--muted)", fontSize: 14 }}>{editorStatus}</div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button style={actionButtonStyle} disabled={isRunningCode} onClick={() => void runCode()}>
                  {isRunningCode ? "Running..." : "Run Code"}
                </button>
              </div>
            </div>

            <div
              style={{
                minHeight: 360,
                borderRadius: 18,
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              <MonacoEditor
                height="360px"
                language={monacoLanguage}
                theme="vs-dark"
                value={editorCode}
                onChange={(value) => setEditorCode(value ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                }}
              />
            </div>

            <div
              style={{
                padding: 16,
                borderRadius: 16,
                background: "#fff",
                border: "1px solid var(--border)",
                display: "grid",
                gap: 10,
              }}
            >
              <strong>Candidate Message</strong>
              <textarea
                value={candidateMessage}
                onChange={(event) => setCandidateMessage(event.target.value)}
                placeholder="Type the candidate response here if you do not want to use the microphone."
                style={{
                  width: "100%",
                  minHeight: 92,
                  resize: "vertical",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: 12,
                  font: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={actionButtonStyle}
                  disabled={!candidateMessage.trim() || isAssistantThinking}
                  onClick={() =>
                    runAction(async () => {
                      const message = candidateMessage.trim();
                      setCandidateMessage("");
                      await handleCandidateMessage(message);
                    })
                  }
                >
                  Send Candidate Reply
                </button>
                <button
                  style={actionButtonStyle}
                  disabled={isAssistantThinking}
                  onClick={() => runAction(async () => requestAssistantTurn())}
                >
                  {isAssistantThinking ? "AI Thinking..." : "Generate AI Reply"}
                </button>
              </div>
            </div>

            <div
              style={{
                padding: 16,
                borderRadius: 16,
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
                display: "grid",
                gap: 12,
              }}
            >
              <strong>Latest Run</strong>
              {latestRun ? (
                <>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--muted)", fontSize: 14 }}>
                    <span>Status: {latestRun.status}</span>
                    <span>Runtime: {latestRun.runtimeMs ?? 0}ms</span>
                    {latestRun.codeSnapshot ? (
                      <span>Snapshot #{latestRun.codeSnapshot.snapshotIndex}</span>
                    ) : null}
                  </div>
                  <OutputBlock title="stdout" value={latestRun.stdout} />
                  <OutputBlock title="stderr" value={latestRun.stderr} />
                </>
              ) : (
                <span style={{ color: "var(--muted)" }}>
                  No code runs yet. Execute the current editor contents to create a code snapshot and runtime record.
                </span>
              )}
            </div>

            {reportSummary ? (
              <div
                style={{
                  padding: 16,
                  borderRadius: 16,
                  background: "#fff",
                  border: "1px solid var(--border)",
                  display: "grid",
                  gap: 12,
                }}
              >
                <strong>Feedback Report v0</strong>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--muted)", fontSize: 14 }}>
                  <span>Recommendation: {reportSummary.recommendation}</span>
                  <span>Score: {reportSummary.overallScore}/100</span>
                </div>
                <p style={{ margin: 0, color: "var(--muted)" }}>{reportSummary.overallSummary}</p>
                <Link href={`/report/${props.sessionId}`} style={{ ...linkButtonStyle, justifySelf: "start" }}>
                  Open Full Report
                </Link>
                <ReportList title="Strengths" items={reportSummary.strengths} />
                <ReportList title="Areas to Improve" items={reportSummary.weaknesses} />
                <ReportList title="Next Steps" items={reportSummary.improvementPlan} />
              </div>
            ) : null}
          </section>

          <aside
            style={{
              ...cardStyle,
              padding: 20,
              display: "grid",
              gap: 18,
              alignContent: "start",
            }}
          >
            <section style={{ display: "grid", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Transcript</h2>
              <div style={{ display: "grid", gap: 10, maxHeight: 260, overflowY: "auto" }}>
                {transcripts.length === 0 ? (
                  <div style={emptyPanelStyle}>No transcript segments yet.</div>
                ) : (
                  transcripts.map((segment) => (
                    <div key={segment.id} style={transcriptBubble(segment.speaker)}>
                      <strong>{segment.speaker}</strong>
                      <span>{segment.text}</span>
                    </div>
                  ))
                )}
                {draftTranscript ? (
                  <div style={{ ...transcriptBubble("USER"), opacity: 0.7 }}>
                    <strong>USER (live)</strong>
                    <span>{draftTranscript}</span>
                  </div>
                ) : null}
                {assistantDraft ? (
                  <div style={{ ...transcriptBubble("AI"), opacity: 0.75 }}>
                    <strong>AI (live)</strong>
                    <span>{assistantDraft}</span>
                  </div>
                ) : null}
              </div>
            </section>

            <section style={{ display: "grid", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Session Timeline</h2>
              <div style={{ display: "grid", gap: 10, maxHeight: 220, overflowY: "auto" }}>
                {timeline.length === 0 ? (
                  <div style={emptyPanelStyle}>No session events yet.</div>
                ) : (
                  timeline.map((event) => (
                    <div key={event.id} style={timelineItemStyle}>
                      <strong>{event.eventType}</strong>
                      {event.eventType === SESSION_EVENT_TYPES.STAGE_ADVANCED ? (
                        <span style={{ color: "var(--text)", fontSize: 14 }}>
                          {formatStageTransition(event.payloadJson)}
                        </span>
                      ) : null}
                      <span style={{ color: "var(--muted)", fontSize: 14 }}>
                        {new Date(event.eventTime).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section style={{ display: "grid", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Recent Runs</h2>
              <div style={{ display: "grid", gap: 10, maxHeight: 220, overflowY: "auto" }}>
                {executionRuns.length === 0 ? (
                  <div style={emptyPanelStyle}>No execution records yet.</div>
                ) : (
                  executionRuns.map((run) => (
                    <div key={run.id} style={timelineItemStyle}>
                      <strong>{run.status}</strong>
                      <span style={{ color: "var(--muted)", fontSize: 14 }}>
                        {new Date(run.createdAt).toLocaleTimeString()} · {run.runtimeMs ?? 0}ms
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function OutputBlock({ title, value }: { title: string; value: string | null }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "var(--muted)", fontSize: 14 }}>{title}</span>
      <pre
        style={{
          margin: 0,
          padding: 12,
          borderRadius: 12,
          background: "#1d2230",
          color: "#ebf0ff",
          overflowX: "auto",
          minHeight: 48,
          whiteSpace: "pre-wrap",
        }}
      >
        {value?.trim() ? value : "(empty)"}
      </pre>
    </div>
  );
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span style={{ fontWeight: 700 }}>{title}</span>
      {items.length === 0 ? (
        <span style={{ color: "var(--muted)", fontSize: 14 }}>No items yet.</span>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((item) => (
            <div
              key={`${title}-${item}`}
              style={{
                padding: 10,
                borderRadius: 12,
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
              }}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: 14 }}>{label}</span>
      <strong style={{ color: ok ? "var(--success)" : "var(--danger)", fontSize: 14 }}>{value}</strong>
    </div>
  );
}

const actionButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "#fff",
  cursor: "pointer",
  textAlign: "left" as const,
} as const;

const linkButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "#fff",
  textDecoration: "none",
  color: "var(--text)",
  display: "inline-flex",
  alignItems: "center",
} as const;

const smallButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "6px 10px",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
} as const;

const diagnosticHintStyle = {
  padding: 10,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "#fff",
  color: "var(--text)",
  fontSize: 14,
  lineHeight: 1.5,
} as const;

const emptyPanelStyle = {
  padding: 14,
  borderRadius: 14,
  border: "1px dashed var(--border)",
  color: "var(--muted)",
  background: "rgba(255,255,255,0.65)",
} as const;

const timelineItemStyle = {
  display: "grid",
  gap: 4,
  padding: 12,
  borderRadius: 12,
  background: "#fff",
  border: "1px solid var(--border)",
} as const;

function transcriptBubble(speaker: TranscriptSegment["speaker"]) {
  return {
    display: "grid",
    gap: 4,
    padding: 12,
    borderRadius: 14,
    border: "1px solid var(--border)",
    background:
      speaker === "AI"
        ? "rgba(24, 90, 219, 0.08)"
        : speaker === "USER"
          ? "#fff"
          : "rgba(0,0,0,0.04)",
  } as const;
}

function StatusPill({ label, tone }: { label: string; tone: "neutral" | "success" | "warning" | "info" | "danger" }) {
  const palette = {
    neutral: { background: "#fff", color: "var(--text)" },
    success: { background: "rgba(13, 122, 82, 0.10)", color: "var(--success)" },
    warning: { background: "rgba(184, 110, 0, 0.12)", color: "#8a5a00" },
    info: { background: "rgba(24, 90, 219, 0.08)", color: "var(--accent-strong)" },
    danger: { background: "rgba(176, 58, 46, 0.10)", color: "var(--danger)" },
  } as const;

  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        fontSize: 13,
        fontWeight: 700,
        ...palette[tone],
      }}
    >
      {label}
    </span>
  );
}

function parseSseEvent(raw: string) {
  const lines = raw.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function extractSpeakableText(text: string, fromIndex: number) {
  const pending = text.slice(fromIndex);
  const matches = pending.match(/.*?[.!?](?:\s|$)/g);

  if (!matches || matches.length === 0) {
    return {
      text: "",
      nextIndex: fromIndex,
    };
  }

  const speakable = matches.join("").trim();
  return {
    text: speakable,
    nextIndex: fromIndex + speakable.length,
  };
}

function mergeById<T extends { id: string }>(
  current: T[],
  incoming: T[],
  finalize?: (items: T[]) => T[],
) {
  const byId = new Map<string, T>();

  for (const item of current) {
    byId.set(item.id, item);
  }

  for (const item of incoming) {
    byId.set(item.id, item);
  }

  const merged = [...byId.values()];
  return finalize ? finalize(merged) : merged;
}

function normalizeCandidateText(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function shouldDelaySpeechDrivenCommit(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const looksIncomplete = /\b(and|so|then|because|but|or|with|for|to)$/i.test(normalized);
  const hasTerminalPunctuation = /[.!?]$/.test(normalized);

  if (wordCount <= 4) {
    return true;
  }

  if (looksIncomplete && !hasTerminalPunctuation) {
    return true;
  }

  return false;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatStageTransition(payloadJson: unknown) {
  const payload =
    typeof payloadJson === "object" && payloadJson !== null ? (payloadJson as Record<string, unknown>) : {};
  const previousStage = isCodingInterviewStage(payload.previousStage)
    ? describeCodingStage(payload.previousStage)
    : null;
  const stage = isCodingInterviewStage(payload.stage) ? describeCodingStage(payload.stage) : null;

  if (previousStage && stage) {
    return `${previousStage} -> ${stage}`;
  }

  if (stage) {
    return `Moved to ${stage}`;
  }

  return "Stage transition recorded.";
}

function voiceTone(state: BrowserVoiceState): "neutral" | "success" | "warning" | "info" | "danger" {
  if (state === "listening") return "success";
  if (state === "starting" || state === "processing" || state === "speaking") return "info";
  if (state === "error") return "danger";
  return "neutral";
}
