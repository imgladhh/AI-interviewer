import { spawn } from "node:child_process";

const node = process.execPath;
const server = spawn(node, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3100"], {
  stdio: "inherit",
  detached: process.platform !== "win32",
  env: { ...process.env, ENABLE_CODE_RUNS: "false", ENABLE_HOST_CODE_EXECUTION: "false", ENABLE_PERSONA_INGESTION: "false" },
});

async function waitForHealth() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:3100/api/health");
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Core smoke server did not become healthy within 120 seconds.");
}

async function stopServer() {
  if (!server.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      const fallback = setTimeout(resolve, 5_000);
      killer.on("close", () => { clearTimeout(fallback); resolve(); });
      killer.on("error", () => { clearTimeout(fallback); resolve(); });
    });
  } else {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ }
  }
}

let exitCode = 1;
try {
  await waitForHealth();
  exitCode = await new Promise((resolve) => {
    const test = spawn(node, ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.smoke.config.ts"], { stdio: "inherit" });
    test.on("close", (code) => resolve(code ?? 1));
    test.on("error", () => resolve(1));
  });
} finally {
  await stopServer();
}
process.exit(exitCode);
