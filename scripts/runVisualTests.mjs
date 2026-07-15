import { spawn } from "node:child_process";
import process from "node:process";

let vite = null;

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stopVite() {
  if (vite && vite.exitCode === null && !vite.killed) vite.kill();
}

process.once("SIGINT", () => {
  stopVite();
  process.exitCode = 130;
});
process.once("SIGTERM", () => {
  stopVite();
  process.exitCode = 143;
});

try {
  if (!(await isReachable("http://127.0.0.1:5173"))) {
    vite = spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--strictPort"],
      { cwd: process.cwd(), stdio: ["ignore", "inherit", "inherit"] }
    );
  }
  await waitFor("http://127.0.0.1:5173");
  const playwright = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    { cwd: process.cwd(), stdio: "inherit" }
  );
  const exitCode = await new Promise((resolve, reject) => {
    playwright.once("error", reject);
    playwright.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  stopVite();
}
