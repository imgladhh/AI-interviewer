import { describe, expect, it } from "vitest";
import {
  getAutoSubmitDelayMs,
  getFinalChunkCommitDelayMs,
  hasNegativeIntentCue,
  isLowSignalUtterance,
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

  it("recognizes filler-heavy low-signal utterances", () => {
    expect(isLowSignalUtterance("um yeah so")).toBe(true);
    expect(isLowSignalUtterance("okay right")).toBe(true);
    expect(isLowSignalUtterance("the bug is the pointer update")).toBe(false);
  });

  it("waits longer before auto-submitting while the candidate is actively coding", () => {
    const idleDelay = getAutoSubmitDelayMs({
      text: "I would sort the array first, then sweep once to merge overlapping intervals.",
      activeCoding: false,
    });
    const codingDelay = getAutoSubmitDelayMs({
      text: "I would sort the array first, then sweep once to merge overlapping intervals.",
      activeCoding: true,
    });

    expect(idleDelay).not.toBeNull();
    expect(codingDelay).not.toBeNull();
    expect(codingDelay!).toBeGreaterThan(idleDelay!);
  });

  it("waits longer before committing a final transcript chunk while the candidate is coding", () => {
    const idleDelay = getFinalChunkCommitDelayMs({
      text: "I think the bug is the pointer update",
      activeCoding: false,
    });
    const codingDelay = getFinalChunkCommitDelayMs({
      text: "I think the bug is the pointer update",
      activeCoding: true,
    });

    expect(idleDelay).not.toBeNull();
    expect(codingDelay).not.toBeNull();
    expect(codingDelay!).toBeGreaterThan(idleDelay!);
  });

  it("is more patient in coding flow than in wrap-up flow", () => {
    const codingDelay = getAutoSubmitDelayMs({
      text: "the bug is probably in the pointer update",
      flowMode: "coding",
    });
    const wrapUpDelay = getAutoSubmitDelayMs({
      text: "the bug is probably in the pointer update",
      flowMode: "wrap_up",
    });

    expect(codingDelay).not.toBeNull();
    expect(wrapUpDelay).not.toBeNull();
    expect(codingDelay!).toBeGreaterThan(wrapUpDelay!);
  });

  it("keeps debugging flow slightly more patient than a normal discussion turn", () => {
    const discussionDelay = getFinalChunkCommitDelayMs({
      text: "I think the bug is the pointer update",
      flowMode: "discussion",
    });
    const debuggingDelay = getFinalChunkCommitDelayMs({
      text: "I think the bug is the pointer update",
      flowMode: "debugging",
    });

    expect(discussionDelay).not.toBeNull();
    expect(debuggingDelay).not.toBeNull();
    expect(debuggingDelay!).toBeGreaterThan(discussionDelay!);
  });

  it("recognizes think-aloud phrases as negative-intent cues", () => {
    expect(hasNegativeIntentCue("wait, let me think")).toBe(true);
    expect(hasNegativeIntentCue("hold on I want to check the loop condition")).toBe(true);
    expect(hasNegativeIntentCue("the bug is the pointer update")).toBe(false);
  });

  it("waits longer when the candidate is thinking out loud during coding", () => {
    const normalDelay = getAutoSubmitDelayMs({
      text: "the bug is probably in the pointer update",
      flowMode: "coding",
      negativeIntent: false,
    });
    const thinkAloudDelay = getAutoSubmitDelayMs({
      text: "wait, let me think about the pointer update",
      flowMode: "coding",
      negativeIntent: true,
    });

    expect(normalDelay).not.toBeNull();
    expect(thinkAloudDelay).not.toBeNull();
    expect(thinkAloudDelay!).toBeGreaterThan(normalDelay!);
  });
});

