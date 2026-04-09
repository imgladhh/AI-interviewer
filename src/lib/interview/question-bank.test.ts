import { describe, expect, it } from "vitest";
import { QUESTION_BANK, getQuestionPromptByTitle } from "@/lib/interview/question-bank";

describe("question bank", () => {
  it("contains a meaningful curated set of questions", () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(100);
  });

  it("uses unique slugs", () => {
    const slugs = QUESTION_BANK.map((question) => question.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("returns detailed prompts for seeded flagship questions", () => {
    expect(getQuestionPromptByTitle("Two Sum")).toMatch(/Example 1:/);
    expect(getQuestionPromptByTitle("Top K Frequent Elements")).toMatch(/Constraints:/);
    expect(getQuestionPromptByTitle("Design URL Shortener")).toMatch(/encode\(longUrl\)/i);
  });

  it("includes company-specific variants for major target companies", () => {
    const companyStyles = Array.from(
      new Set(
      QUESTION_BANK
        .filter((question) => ["AMAZON", "META", "GOOGLE"].includes(String(question.companyStyle)))
        .map((question) => String(question.companyStyle)),
      ),
    );

    expect(companyStyles).toContain("AMAZON");
    expect(companyStyles).toContain("META");
    expect(companyStyles).toContain("GOOGLE");
  });
});
