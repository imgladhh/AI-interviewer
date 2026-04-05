const INTERRUPTION_PHRASES = [
  "wait",
  "one second",
  "hold on",
  "hang on",
  "give me a second",
  "let me think",
  "sorry",
  "hold up",
];

const NEGATIVE_INTENT_PHRASES = [
  "wait",
  "let me think",
  "let me see",
  "hold on",
  "hang on",
  "give me a second",
  "one second",
  "hold up",
];

const LOW_SIGNAL_TOKENS = new Set([
  "um",
  "uh",
  "ah",
  "er",
  "mm",
  "hmm",
  "yeah",
  "yep",
  "ok",
  "okay",
  "right",
  "so",
  "well",
]);

type TurnTimingInput = {
  text: string;
  interruptedRecently?: boolean;
  activeCoding?: boolean;
  flowMode?: "discussion" | "coding" | "debugging" | "wrap_up";
  negativeIntent?: boolean;
};

export function getAutoSubmitDelayMs(input: TurnTimingInput) {
  const normalized = normalizeUtterance(input.text);
  if (!normalized || shouldIgnoreInterruptedUtterance(normalized, input.interruptedRecently)) {
    return null;
  }

  const wordCount = countWords(normalized);
  const endsSentence = /[.!?]$/.test(normalized);
  const hasConnectorEnding = /\b(and|so|then|because|but|or|with|for|to)$/.test(normalized);
  const hasComplexityTalk = /\btime complexity|space complexity|o\(/.test(normalized);

  if (hasConnectorEnding || hasComplexityTalk) {
    const baseDelay = input.interruptedRecently ? 2000 : 1600;
    return applyNegativeIntentBias(
      applyVoiceFlowBias(applyCodingDelayBias(baseDelay, input.activeCoding), input.flowMode),
      input.negativeIntent,
      input.flowMode,
    );
  }

  const baseDelay = resolveAutoSubmitBaseDelay({
    wordCount,
    endsSentence,
    interruptedRecently: input.interruptedRecently,
  });
  return applyNegativeIntentBias(
    applyVoiceFlowBias(applyCodingDelayBias(baseDelay, input.activeCoding), input.flowMode),
    input.negativeIntent,
    input.flowMode,
  );
}

export function getFinalChunkCommitDelayMs(input: TurnTimingInput) {
  const normalized = normalizeUtterance(input.text);
  if (!normalized || shouldIgnoreInterruptedUtterance(normalized, input.interruptedRecently)) {
    return null;
  }

  const wordCount = countWords(normalized);
  const hasConnectorEnding = /\b(and|so|then|because|but|or|with|for|to)$/.test(normalized);

  if (/[.!?]$/.test(normalized)) {
    return applyNegativeIntentBias(
      applyVoiceFlowBias(
        applyCodingDelayBias(wordCount >= 10 ? 320 : 520, input.activeCoding, 220, 1600),
        input.flowMode,
        240,
        1600,
      ),
      input.negativeIntent,
      input.flowMode,
    );
  }

  if (wordCount <= 3) {
    return applyNegativeIntentBias(
      applyVoiceFlowBias(
        applyCodingDelayBias(input.interruptedRecently ? 1500 : 1200, input.activeCoding, 220, 1600),
        input.flowMode,
        240,
        1600,
      ),
      input.negativeIntent,
      input.flowMode,
    );
  }

  if (hasConnectorEnding) {
    return applyNegativeIntentBias(
      applyVoiceFlowBias(
        applyCodingDelayBias(input.interruptedRecently ? 1200 : 900, input.activeCoding, 220, 1600),
        input.flowMode,
        240,
        1600,
      ),
      input.negativeIntent,
      input.flowMode,
    );
  }

  return applyNegativeIntentBias(
    applyVoiceFlowBias(
      applyCodingDelayBias(input.interruptedRecently ? 950 : 720, input.activeCoding, 220, 1600),
      input.flowMode,
      240,
      1600,
    ),
    input.negativeIntent,
    input.flowMode,
  );
}

export function shouldIgnoreInterruptedUtterance(text: string, interruptedRecently = false) {
  const normalized = normalizeUtterance(text);
  if (!normalized) {
    return true;
  }

  if (!interruptedRecently) {
    return false;
  }

  return INTERRUPTION_PHRASES.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `));
}

export function isLowSignalUtterance(text: string) {
  const normalized = normalizeUtterance(text).replace(/[,.!?;:]/g, " ").trim();
  if (!normalized) {
    return true;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length > 4) {
    return false;
  }

  return tokens.every((token) => LOW_SIGNAL_TOKENS.has(token));
}

export function hasNegativeIntentCue(text: string) {
  const normalized = normalizeUtterance(text).replace(/[,.!?;:]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  return NEGATIVE_INTENT_PHRASES.some(
    (phrase) => normalized === phrase || normalized.startsWith(`${phrase} `),
  );
}

export function normalizeUtterance(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function resolveAutoSubmitBaseDelay(input: {
  wordCount: number;
  endsSentence: boolean;
  interruptedRecently?: boolean;
}) {
  if (input.endsSentence && input.wordCount >= 14) {
    return input.interruptedRecently ? 1200 : 950;
  }

  if (input.wordCount <= 3) {
    return input.interruptedRecently ? 2500 : 2100;
  }

  if (input.wordCount <= 8) {
    return input.interruptedRecently ? 2100 : 1750;
  }

  return input.interruptedRecently ? 1750 : 1400;
}

function applyCodingDelayBias(baseDelay: number, activeCoding = false, increment = 350, maxDelay = 2800) {
  if (!activeCoding) {
    return baseDelay;
  }

  return Math.min(baseDelay + increment, maxDelay);
}

function applyVoiceFlowBias(
  baseDelay: number,
  flowMode: TurnTimingInput["flowMode"],
  increment = 320,
  maxDelay = 2800,
) {
  if (flowMode === "coding") {
    return Math.min(baseDelay + increment, maxDelay);
  }

  if (flowMode === "debugging") {
    return Math.min(baseDelay + Math.round(increment * 0.65), maxDelay);
  }

  if (flowMode === "wrap_up") {
    return Math.max(baseDelay - 120, 260);
  }

  return baseDelay;
}

function applyNegativeIntentBias(
  baseDelay: number,
  negativeIntent = false,
  flowMode: TurnTimingInput["flowMode"] = "discussion",
) {
  if (!negativeIntent) {
    return baseDelay;
  }

  if (flowMode === "coding") {
    return Math.min(baseDelay + 520, 3200);
  }

  if (flowMode === "debugging") {
    return Math.min(baseDelay + 380, 3000);
  }

  return Math.min(baseDelay + 180, 2600);
}
