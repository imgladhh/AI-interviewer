import { afterEach, describe, expect, it } from "vitest";
import { boundedText, requestLimits } from "@/lib/security/limits";
import { isCodeRunEnabled, isHostCodeExecutionEnabled, isPersonaIngestionEnabled } from "@/lib/security/feature-flags";
import { buildSafeChildEnvironment, executeCode } from "@/lib/sandbox/execute";
import { createExecutionRunSchema, createTranscriptSegmentSchema } from "@/schemas/session-runtime";

describe("security limits and feature flags", () => {
  afterEach(() => {
    delete process.env.ENABLE_CODE_RUNS;
    delete process.env.ENABLE_HOST_CODE_EXECUTION;
    delete process.env.ENABLE_PERSONA_INGESTION;
    delete process.env.MAX_CODE_CHARS;
  });

  it("keeps dangerous features disabled by default", () => {
    expect(isCodeRunEnabled()).toBe(false);
    expect(isHostCodeExecutionEnabled()).toBe(false);
    expect(isPersonaIngestionEnabled()).toBe(false);
  });

  it("does not create a process or temporary sandbox when code runs are disabled", async () => {
    const result = await executeCode({ language: "PYTHON", code: "print('no')" });
    expect(result.status).toBe("ERROR");
    expect(result.stderr).toMatch(/disabled/i);
  });

  it("accepts only explicit truthy flags and deterministic positive limits", () => {
    process.env.ENABLE_CODE_RUNS = "true";
    process.env.ENABLE_HOST_CODE_EXECUTION = "1";
    process.env.MAX_CODE_CHARS = "123";
    expect(isCodeRunEnabled()).toBe(true);
    expect(isHostCodeExecutionEnabled()).toBe(true);
    expect(requestLimits.codeChars).toBe(123);
  });

  it("bounds output and excludes application secrets from child processes", () => {
    process.env.OPENAI_API_KEY = "secret";
    const env = buildSafeChildEnvironment({ PYTHONUNBUFFERED: "1" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PYTHONUNBUFFERED).toBe("1");
    expect(boundedText("abcdef", 3)).toContain("abc");
    delete process.env.OPENAI_API_KEY;
  });

  it("rejects oversized code, stdin, and transcript input deterministically", () => {
    expect(createExecutionRunSchema.safeParse({ language: "PYTHON", code: "x".repeat(100_001) }).success).toBe(false);
    expect(createExecutionRunSchema.safeParse({ language: "PYTHON", code: "ok", stdin: "x".repeat(20_001) }).success).toBe(false);
    expect(createTranscriptSegmentSchema.safeParse({ speaker: "USER", text: "x".repeat(20_001) }).success).toBe(false);
  });
});
