import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionStatus } from "@prisma/client";
import { normalizeLanguage } from "@/lib/interview/editor";

type ExecuteCodeInput = {
  language: string;
  code: string;
  stdin?: string;
  timeoutMs?: number;
};

export type ExecuteCodeResult = {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  runtimeMs: number;
  memoryKb: number | null;
};

type CommandSpec = {
  compile?: {
    command: string;
    args: string[];
    env?: Record<string, string | undefined>;
  };
  run: {
    command: string;
    args: string[];
    env?: Record<string, string | undefined>;
  };
  filename: string;
};

export async function executeCode({
  language,
  code,
  stdin,
  timeoutMs = 5000,
}: ExecuteCodeInput): Promise<ExecuteCodeResult> {
  const spec = buildCommandSpec(language);
  if (!spec) {
    return {
      status: "FAILED",
      stdout: "",
      stderr: `Execution currently supports Python, JavaScript, and C++ in the local sandbox. Received ${language}.`,
      runtimeMs: 0,
      memoryKb: null,
    };
  }

  const sandboxDir = await mkdtemp(join(tmpdir(), "ai-interviewer-run-"));
  const filePath = join(sandboxDir, spec.filename);
  await writeFile(filePath, code, "utf8");

  const startedAt = Date.now();

  try {
    if (shouldUseDockerSandbox()) {
      const dockerResult = await executeCodeWithDocker({
        language,
        sandboxDir,
        stdin,
        timeoutMs,
        startedAt,
      });

      if (dockerResult.status !== "ERROR" || !/docker/i.test(dockerResult.stderr)) {
        return dockerResult;
      }
    }

    if (spec.compile) {
      const compileResult = await runProcess({
        command: spec.compile.command,
        args: [...spec.compile.args, filePath],
        cwd: sandboxDir,
        stdin,
        timeoutMs,
        startedAt,
        env: spec.compile.env,
      });

      if (compileResult.status !== "PASSED") {
        return compileResult;
      }
    }

    return await runProcess({
      command: spec.run.command,
      args: [...spec.run.args],
      cwd: sandboxDir,
      stdin,
      timeoutMs,
      startedAt,
      env: spec.run.env,
    });
  } finally {
    await rm(sandboxDir, { recursive: true, force: true });
  }
}

function buildCommandSpec(language: string): CommandSpec | null {
  switch (normalizeLanguage(language)) {
    case "JAVASCRIPT":
      return {
        run: {
          command: process.execPath,
          args: ["--max-old-space-size=128", join(".", "solution.js")],
        },
        filename: "solution.js",
      };
    case "PYTHON":
      return {
        run: {
          command: "python",
          args: [join(".", "solution.py")],
          env: {
            PYTHONUNBUFFERED: "1",
          },
        },
        filename: "solution.py",
      };
    case "C++":
      return {
        compile: {
          command: "g++",
          args: ["-std=c++17", "-O2", "-o", "solution.exe"],
        },
        run: {
          command: join(".", "solution.exe"),
          args: [],
        },
        filename: "solution.cpp",
      };
    default:
      return null;
  }
}

function shouldUseDockerSandbox() {
  return process.env.CODE_SANDBOX_DRIVER?.trim().toLowerCase() === "docker";
}

async function executeCodeWithDocker(input: {
  language: string;
  sandboxDir: string;
  stdin?: string;
  timeoutMs: number;
  startedAt: number;
}): Promise<ExecuteCodeResult> {
  const dockerSpec = buildDockerSpec(input.language);
  if (!dockerSpec) {
    return {
      status: "ERROR",
      stdout: "",
      stderr: `docker sandbox is not configured for ${input.language}.`,
      runtimeMs: Date.now() - input.startedAt,
      memoryKb: null,
    };
  }

  return runProcess({
    command: "docker",
    args: [
      "run",
      "--rm",
      "--network",
      "none",
      "--memory",
      process.env.CODE_SANDBOX_MEMORY_LIMIT ?? "256m",
      "--cpus",
      process.env.CODE_SANDBOX_CPU_LIMIT ?? "0.5",
      "-v",
      `${input.sandboxDir}:/workspace`,
      "-w",
      "/workspace",
      dockerSpec.image,
      ...dockerSpec.command,
    ],
    cwd: input.sandboxDir,
    stdin: input.stdin,
    timeoutMs: input.timeoutMs,
    startedAt: input.startedAt,
  });
}

function buildDockerSpec(language: string) {
  switch (normalizeLanguage(language)) {
    case "JAVASCRIPT":
      return {
        image: process.env.CODE_SANDBOX_NODE_IMAGE ?? "node:20-alpine",
        command: ["node", "--max-old-space-size=128", "solution.js"],
      };
    case "PYTHON":
      return {
        image: process.env.CODE_SANDBOX_PYTHON_IMAGE ?? "python:3.11-alpine",
        command: ["python", "solution.py"],
      };
    case "C++":
      return {
        image: process.env.CODE_SANDBOX_CPP_IMAGE ?? "gcc:13",
        command: ["/bin/sh", "-lc", "g++ -std=c++17 -O2 -o solution ./solution.cpp && ./solution"],
      };
    default:
      return null;
  }
}

async function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
  startedAt: number;
  env?: Record<string, string | undefined>;
}): Promise<ExecuteCodeResult> {
  return await new Promise<ExecuteCodeResult>((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: "pipe",
      env: {
        ...process.env,
        ...input.env,
      },
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child.pid);
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status: "ERROR",
        stdout,
        stderr: error.message,
        runtimeMs: Date.now() - input.startedAt,
        memoryKb: null,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          status: "TIMEOUT",
          stdout,
          stderr: stderr || `Execution exceeded ${input.timeoutMs}ms timeout.`,
          runtimeMs: Date.now() - input.startedAt,
          memoryKb: null,
        });
        return;
      }

      resolve({
        status: code === 0 ? "PASSED" : "ERROR",
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        runtimeMs: Date.now() - input.startedAt,
        memoryKb: null,
      });
    });

    if (input.stdin) {
      child.stdin.write(input.stdin);
    }
    child.stdin.end();
  });
}

async function terminateProcessTree(pid?: number) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore cleanup failure
    }
  }
}
