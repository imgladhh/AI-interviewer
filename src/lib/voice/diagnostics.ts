export type VoiceDiagnostics = {
  isSecureContext: boolean;
  speechRecognitionAvailable: boolean;
  speechSynthesisAvailable: boolean;
  mediaDevicesAvailable: boolean;
  microphonePermission: "granted" | "denied" | "prompt" | "unknown" | "unsupported";
  audioInputCount: number | null;
  hasAudioInput: boolean | null;
  defaultAudioInputLabel: string | null;
  audioInputs: Array<{
    deviceId: string;
    label: string;
    isDefault: boolean;
    suspectVirtual: boolean;
  }>;
  getUserMediaAudioAccess: "ok" | "failed" | "unsupported" | "unknown";
  getUserMediaError: string | null;
};

export async function getVoiceDiagnostics(): Promise<VoiceDiagnostics> {
  if (typeof window === "undefined") {
    return {
      isSecureContext: false,
      speechRecognitionAvailable: false,
      speechSynthesisAvailable: false,
      mediaDevicesAvailable: false,
      microphonePermission: "unsupported",
      audioInputCount: null,
      hasAudioInput: null,
      defaultAudioInputLabel: null,
      audioInputs: [],
      getUserMediaAudioAccess: "unsupported",
      getUserMediaError: null,
    };
  }

  const mediaDevicesAvailable = Boolean(navigator.mediaDevices?.enumerateDevices);
  const microphonePermission = await getMicrophonePermission();
  const audioInputs = mediaDevicesAvailable ? await getAudioInputs() : [];
  const audioInputCount = mediaDevicesAvailable ? audioInputs.length : null;
  const preflight = await runMicrophonePreflight();
  const defaultAudioInput = audioInputs.find((device) => device.isDefault) ?? audioInputs[0] ?? null;

  return {
    isSecureContext: window.isSecureContext,
    speechRecognitionAvailable: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    speechSynthesisAvailable: "speechSynthesis" in window,
    mediaDevicesAvailable,
    microphonePermission,
    audioInputCount,
    hasAudioInput: audioInputCount === null ? null : audioInputCount > 0,
    defaultAudioInputLabel: defaultAudioInput?.label ?? null,
    audioInputs,
    getUserMediaAudioAccess: preflight.status,
    getUserMediaError: preflight.error,
  };
}

export async function runMicrophonePreflight(): Promise<{
  status: VoiceDiagnostics["getUserMediaAudioAccess"];
  error: string | null;
}> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return {
      status: "unsupported",
      error: null,
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return {
      status: "ok",
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unable to access microphone stream.",
    };
  }
}

async function getMicrophonePermission(): Promise<VoiceDiagnostics["microphonePermission"]> {
  if (!("permissions" in navigator) || typeof navigator.permissions.query !== "function") {
    return "unsupported";
  }

  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });

    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
      return status.state;
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

async function getAudioInputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || "Unnamed microphone",
        isDefault: device.deviceId === "default" || device.groupId === "default",
        suspectVirtual: /virtual|stereo mix|bluetooth|hands-free|array \(intel|nvidia broadcast|voicemod|cable output/i.test(
          device.label,
        ),
      }));
  } catch {
    return [];
  }
}

export function getVoiceDiagnosticsHints(input: {
  diagnostics: VoiceDiagnostics;
  lastVoiceError: string | null;
}) {
  const hints: string[] = [];
  const error = input.lastVoiceError?.toLowerCase() ?? "";

  if (!input.diagnostics.isSecureContext) {
    hints.push("This page is not running in a secure browser context. Use localhost or HTTPS.");
  }

  if (!input.diagnostics.speechRecognitionAvailable) {
    hints.push("This browser does not expose the Web Speech recognition API. Chrome or Edge usually works best.");
  }

  if (input.diagnostics.microphonePermission === "denied") {
    hints.push("Microphone permission is denied. Re-enable it in Chrome site settings and Windows privacy settings.");
  }

  if (input.diagnostics.hasAudioInput === false) {
    hints.push("No audio input devices were detected. Check that a microphone is connected and selected as the Windows default input.");
  }

  if (input.diagnostics.getUserMediaAudioAccess === "failed") {
    hints.push(
      `Browser microphone preflight failed before speech recognition started${input.diagnostics.getUserMediaError ? `: ${input.diagnostics.getUserMediaError}` : "."}`,
    );
  }

  if (input.diagnostics.audioInputs.some((device) => device.suspectVirtual)) {
    hints.push("One or more detected microphones look like virtual, Bluetooth hands-free, or driver-provided devices. If recognition is unstable, switch Windows default input to a built-in or wired microphone first.");
  }

  if (error.includes("audio-capture")) {
    hints.push("Chrome started speech recognition but could not access a usable microphone input. Check Windows Sound > Input, close apps that may be holding the mic, and retry.");
  }

  if (error.includes("not-allowed") || error.includes("service-not-allowed")) {
    hints.push("The browser blocked microphone access. Allow the microphone for this site and retry.");
  }

  if (error.includes("no-speech")) {
    hints.push("No speech was detected. Try speaking closer to the microphone or verify that the input level moves in Windows Sound settings.");
  }

  return hints;
}
