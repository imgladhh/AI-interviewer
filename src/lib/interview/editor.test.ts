import { describe, expect, it } from "vitest";
import { getStarterCode, isRunnableLanguage, normalizeLanguage, toMonacoLanguage } from "@/lib/interview/editor";
import { CURATED_CODING_TITLES, QUESTION_BANK } from "@/lib/interview/question-bank";

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
    expect(getStarterCode("PYTHON", "Merge Intervals")).toContain("def merge_intervals(intervals)");
    expect(getStarterCode("JAVASCRIPT", "Merge Intervals")).toContain("function mergeIntervals(intervals)");
    expect(getStarterCode("C++", "Merge Intervals")).toContain("vector<vector<int>> mergeIntervals");
  });

  it("returns problem-specific starter code for Two Sum", () => {
    expect(getStarterCode("PYTHON", "Two Sum")).toContain("def two_sum(nums, target)");
    expect(getStarterCode("JAVASCRIPT", "Two Sum")).toContain("function twoSum(nums, target)");
    expect(getStarterCode("C++", "Two Sum")).toContain("vector<int> twoSum(vector<int> nums, int target)");
  });

  it("returns a dedicated nums-to-int starter for Maximum Subarray", () => {
    expect(getStarterCode("PYTHON", "Maximum Subarray")).toContain("def max_subarray(nums):");
    expect(getStarterCode("JAVASCRIPT", "Maximum Subarray")).toContain("function maxSubArray(nums)");
  });

  it("keeps Validate Binary Search Tree as an unfinished skeleton", () => {
    const pythonStarter = getStarterCode("PYTHON", "Validate Binary Search Tree");
    const javascriptStarter = getStarterCode("JAVASCRIPT", "Validate Binary Search Tree");
    const cppStarter = getStarterCode("C++", "Validate Binary Search Tree");

    expect(pythonStarter).toContain('raise NotImplementedError("TODO: implement this function")');
    expect(pythonStarter).not.toContain("return False");
    expect(pythonStarter).not.toContain("build_tree");
    expect(pythonStarter).not.toContain('__main__');

    expect(javascriptStarter).toContain('throw new Error("TODO: implement this function");');
    expect(javascriptStarter).not.toContain("return false;");
    expect(javascriptStarter).not.toContain("buildTree(");
    expect(javascriptStarter).not.toContain("const result =");

    expect(cppStarter).toContain('throw runtime_error("TODO: implement this function");');
    expect(cppStarter).not.toContain("return false;");
    expect(cppStarter).not.toContain("buildTree(");
    expect(cppStarter).not.toContain("int main()");
  });

  it("keeps class-design starters as bare skeletons without demo code", () => {
    const jsLru = getStarterCode("JAVASCRIPT", "LRU Cache");
    const jsUrl = getStarterCode("JAVASCRIPT", "Design URL Shortener");

    expect(jsLru).not.toContain("const cache = new LRUCache");
    expect(jsUrl).not.toContain("const service = new URLShortener");
    expect(jsUrl).toContain('throw new Error("TODO: implement this method");');
  });

  it("covers every curated coding title with a specialized template", () => {
    expect(CURATED_CODING_TITLES).toHaveLength(32);

    for (const title of CURATED_CODING_TITLES) {
      const pythonStarter = getStarterCode("PYTHON", title);
      const javascriptStarter = getStarterCode("JAVASCRIPT", title);

      expect(pythonStarter).not.toContain("def solve(input):");
      expect(javascriptStarter).not.toContain("function solve(input)");
    }
  });

  it("provides title-aware TODO skeletons for every non-curated coding seed", () => {
    const codingTitles = Array.from(
      new Set(QUESTION_BANK.filter((question) => question.type === "CODING").map((question) => question.title)),
    );
    const curatedTitles = new Set(CURATED_CODING_TITLES);
    const seedTitles = codingTitles.filter((title) => !curatedTitles.has(title));

    expect(codingTitles).toHaveLength(103);
    expect(seedTitles).toHaveLength(71);

    for (const title of seedTitles) {
      const pythonStarter = getStarterCode("PYTHON", title);
      const javascriptStarter = getStarterCode("JAVASCRIPT", title);

      expect(pythonStarter).not.toBe("");
      expect(pythonStarter).toContain(`# ${title}`);
      expect(pythonStarter).toContain("TODO");
      expect(javascriptStarter).not.toBe("");
      expect(javascriptStarter).toContain(`// ${title}`);
      expect(javascriptStarter).toContain("TODO");
    }
  });
});
