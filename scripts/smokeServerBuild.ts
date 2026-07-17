import { once } from "node:events";
import { access, mkdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const builtEntry = path.join(projectRoot, ".server-build", "server", "dev.js");
const smokeRoot = path.join(projectRoot, ".tmp-build", `server-smoke-${process.pid}`);
const smokeDataDir = path.join(smokeRoot, "data");

await access(builtEntry);
await rm(smokeRoot, { recursive: true, force: true });
await mkdir(smokeDataDir, { recursive: true });

const port = await reservePort();
const child = spawn(process.execPath, [builtEntry], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "test",
    KID_READING_DATA_DIR: smokeDataDir,
    KID_READING_DB_PATH: path.join(smokeDataDir, "app.sqlite"),
    KID_READING_SAVE_AUDIO: "0",
    LOCAL_COURSE_STUDIO_ENABLED: "0",
    SPEECH_PROVIDER: "mock",
    SPEECH_ENHANCEMENT_PROVIDER: "disabled",
    SPEECH_ENHANCEMENT_AB: "0",
    AI_PROVIDER: "disabled"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let childOutput = "";
child.stdout.on("data", (chunk) => {
  childOutput += chunk;
});
child.stderr.on("data", (chunk) => {
  childOutput += chunk;
});

try {
  const health = await waitForHealth(`http://127.0.0.1:${port}/api/health`);
  if (!isRecord(health) || health.ok !== true) throw new Error(`Unexpected health payload: ${JSON.stringify(health)}`);
  console.log(`Compiled server health check passed on 127.0.0.1:${port}.`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n${childOutput}`.trim());
} finally {
  child.kill();
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(smokeRoot, { recursive: true, force: true });
}

async function reservePort(): Promise<number> {
  const server = net.createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve a smoke-test port.");
  const selectedPort = address.port;
  server.close();
  await once(server, "close");
  return selectedPort;
}

async function waitForHealth(url: string): Promise<unknown> {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Compiled server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`Health endpoint returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw lastError || new Error("Timed out waiting for compiled server health check.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
