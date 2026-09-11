import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.fn();
vi.mock("node:child_process", () => ({ spawn }));

function failedDockerProcess() {
  const child = new EventEmitter() as EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough; stdin: PassThrough };
  child.pid = 123;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  queueMicrotask(() => child.emit("error", new Error("docker unavailable")));
  return child;
}

describe("code execution isolation", () => {
  beforeEach(() => {
    process.env.ENABLE_CODE_RUNS = "true";
    delete process.env.ENABLE_HOST_CODE_EXECUTION;
    spawn.mockReset().mockImplementation(failedDockerProcess);
  });

  afterEach(() => {
    delete process.env.ENABLE_CODE_RUNS;
    delete process.env.ENABLE_HOST_CODE_EXECUTION;
  });

  it("does not fall back to a host process when Docker is unavailable", async () => {
    const { executeCode } = await import("@/lib/sandbox/execute");
    const result = await executeCode({ language: "PYTHON", code: "print('safe')" });
    expect(result.status).toBe("ERROR");
    expect(result.stderr).toMatch(/host fallback is disabled/i);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith("docker", expect.any(Array), expect.any(Object));
  });
});
