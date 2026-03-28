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

type TurnTimingInput = {
  text: string;
  interruptedRecently?: boolean;
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

  if (endsSentence && wordCount >= 14) {
    return input.interruptedRecently ? 1200 : 950;
  }

  if (wordCount <= 3) {
    return input.interruptedRecently ? 2500 : 2100;
  }

  if (wordCount <= 8) {
    return input.interruptedRecently ? 2100 : 1750;
  }

  if (hasConnectorEnding || hasComplexityTalk) {
    return input.interruptedRecently ? 2000 : 1600;
  }

  return input.interruptedRecently ? 1750 : 1400;
}

export function getFinalChunkCommitDelayMs(input: TurnTimingInput) {
  const normalized = normalizeUtterance(input.text);
  if (!normalized || shouldIgnoreInterruptedUtterance(normalized, input.interruptedRecently)) {
    return null;
  }

  const wordCount = countWords(normalized);
  const hasConnectorEnding = /\b(and|so|then|because|but|or|with|for|to)$/.test(normalized);

  if (/[.!?]$/.test(normalized)) {
    return wordCount >= 10 ? 320 : 520;
  }

  if (wordCount <= 3) {
    return input.interruptedRecently ? 1500 : 1200;
  }

  if (hasConnectorEnding) {
    return input.interruptedRecently ? 1200 : 900;
  }

  return input.interruptedRecently ? 950 : 720;
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

export function normalizeUtterance(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}
