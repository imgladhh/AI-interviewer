import { describe, expect, it } from "vitest";
import { getStarterCode, isRunnableLanguage, normalizeLanguage, toMonacoLanguage } from "@/lib/interview/editor";

describe("interview editor helpers", () => {
  it("normalizes supported languages", () => {
    expect(normalizeLanguage("python")).toBe("PYTHON");
    expect(normalizeLanguage("JAVASCRIPT")).toBe("JAVASCRIPT");
    expect(normalizeLanguage("cpp")).toBe("C++");
  });

  it("maps languages to Monaco ids", () => {
    expect(toMonacoLanguage("PYTHON")).toBe("python");
    expect(toMonacoLanguage("JAVASCRIPT")).toBe("javascript");
    expect(toMonacoLanguage("JAVA")).toBe("java");
    expect(toMonacoLanguage("C++")).toBe("cpp");
  });

  it("flags runnable languages and generates starter code", () => {
    expect(isRunnableLanguage("PYTHON")).toBe(true);
    expect(isRunnableLanguage("JAVASCRIPT")).toBe(true);
    expect(isRunnableLanguage("C++")).toBe(true);
    expect(isRunnableLanguage("JAVA")).toBe(false);
    expect(getStarterCode("PYTHON", "Merge Intervals")).toContain("def solve");
    expect(getStarterCode("JAVASCRIPT", "Merge Intervals")).toContain("function solve");
    expect(getStarterCode("C++", "Merge Intervals")).toContain("vector<int> solve");
  });

  it("returns problem-specific starter code for Two Sum", () => {
    expect(getStarterCode("PYTHON", "Two Sum")).toContain("def two_sum(nums, target)");
    expect(getStarterCode("JAVASCRIPT", "Two Sum")).toContain("function twoSum(nums, target)");
    expect(getStarterCode("C++", "Two Sum")).toContain("vector<int> twoSum(vector<int> nums, int target)");
  });
});
