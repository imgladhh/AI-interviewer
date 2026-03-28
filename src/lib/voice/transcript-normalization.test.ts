import { describe, expect, it } from "vitest";
import { mergeTranscriptFragments, normalizeTranscriptText } from "@/lib/voice/transcript-normalization";

describe("transcript normalization", () => {
  it("normalizes common technical terms", () => {
    const normalized = normalizeTranscriptText("i would use 2 pointers and then talk about time complexity and o of n");

    expect(normalized).toContain("I would use two pointers");
    expect(normalized).toContain("time complexity");
    expect(normalized).toContain("O(n)");
  });

  it("normalizes broader coding interview vocabulary", () => {
    const normalized = normalizeTranscriptText(
      "maybe dynamic programming is better, or a min heap with big o of log n per operation",
    );

    expect(normalized).toContain("dynamic programming");
    expect(normalized).toContain("min heap");
    expect(normalized).toContain("Big-O");
    expect(normalized).toContain("O(log n)");
  });

  it("merges overlapping transcript fragments", () => {
    const merged = mergeTranscriptFragments(
      "I would use a hash map to count",
      "hash map to count the frequency first",
    );

    expect(merged).toBe("I would use a hash map to count the frequency first");
  });
});
