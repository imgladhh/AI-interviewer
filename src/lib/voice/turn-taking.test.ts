import { describe, expect, it } from "vitest";
import {
  getAutoSubmitDelayMs,
  getFinalChunkCommitDelayMs,
  normalizeUtterance,
  shouldIgnoreInterruptedUtterance,
} from "@/lib/voice/turn-taking";

describe("voice turn-taking policy", () => {
  it("uses a longer auto-submit delay for short uncertain phrases", () => {
    expect(getAutoSubmitDelayMs({ text: "maybe hashmap" })).toBeGreaterThanOrEqual(1400);
  });

  it("uses a shorter delay for complete longer sentences", () => {
    expect(
      getAutoSubmitDelayMs({
        text: "I would sort the array first, then sweep once to merge overlapping intervals.",
      }),
    ).toBeLessThanOrEqual(1400);
  });

  it("ignores interruption phrases when the candidate just cut off the AI", () => {
    expect(shouldIgnoreInterruptedUtterance("wait one second", true)).toBe(true);
    expect(getFinalChunkCommitDelayMs({ text: "wait one second", interruptedRecently: true })).toBeNull();
  });

  it("still allows meaningful content after an interruption", () => {
    expect(shouldIgnoreInterruptedUtterance("wait, I think the bug is in the pointer update", true)).toBe(false);
  });

  it("normalizes whitespace and casing consistently", () => {
    expect(normalizeUtterance("  Hold   On  ")).toBe("hold on");
  });
});

