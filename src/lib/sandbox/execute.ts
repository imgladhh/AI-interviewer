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
  };
  run: {
    command: string;
    args: string[];
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
    if (spec.compile) {
      const compileResult = await runProcess({
        command: spec.compile.command,
        args: [...spec.compile.args, filePath],
        cwd: sandboxDir,
        stdin,
        timeoutMs,
        startedAt,
      });

      if (compileResult.status !== "PASSED") {
        return compileResult;
      }
    }

    return await new Promise<ExecuteCodeResult>((resolve) => {
      const child = spawn(spec.run.command, [...spec.run.args], {
        cwd: sandboxDir,
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

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
          runtimeMs: Date.now() - startedAt,
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
            stderr: stderr || `Execution exceeded ${timeoutMs}ms timeout.`,
            runtimeMs: Date.now() - startedAt,
            memoryKb: null,
          });
          return;
        }

        resolve({
          status: code === 0 ? "PASSED" : "ERROR",
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          runtimeMs: Date.now() - startedAt,
          memoryKb: null,
        });
      });

      if (stdin) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
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
          args: [join(".", "solution.js")],
        },
        filename: "solution.js",
      };
    case "PYTHON":
      return {
        run: {
          command: "python",
          args: [join(".", "solution.py")],
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

async function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
  startedAt: number;
}): Promise<ExecuteCodeResult> {
  return await new Promise<ExecuteCodeResult>((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
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
