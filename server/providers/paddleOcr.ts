import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

import { PDFParse } from "pdf-parse";

import { comparePdfAndOcrPage, summarizeOcrAuditPages } from "../pdfOcrAudit.js";
import { projectRoot } from "../projectRoot.js";
import type {
  FetchLike,
  OcrAuditOptions,
  OcrLineDetail,
  OcrProviderStatus,
  RecognizedOcrText
} from "../types/ocr.js";
import type { OcrAudit, OcrAuditPage } from "../types/pdf.js";

const defaultEndpoint = "http://127.0.0.1:8087";
const defaultModel = "PP-OCRv6";
const defaultRenderWidth = 1400;
const execFileAsync = promisify(execFile);
interface PaddleRuntimePaths {
  runtimeRoot: string;
  python: string;
  service: string;
  pidFile: string;
  tokenFile: string;
  logFile: string;
}

interface PaddleInstallationStatus {
  installed: boolean;
  controllable: boolean;
  paths: PaddleRuntimePaths;
}

interface PaddleFetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

interface PaddleHealthResponse {
  status?: unknown;
  engine?: unknown;
  pid?: unknown;
}

interface PaddleOcrResponse {
  message?: unknown;
  error?: unknown;
  durationMs?: unknown;
  lines?: unknown;
}

interface PaddleRecognizedText extends RecognizedOcrText {
  details: OcrLineDetail[];
  durationMs: number;
}

type SampledOcrAuditOptions = Omit<OcrAuditOptions, "pageNumbers"> & { pageNumbers?: number[] };

let managedServerProcess: ReturnType<typeof spawn> | null = null;

function runtimePaths(): PaddleRuntimePaths {
  const runtimeRoot = process.env.PADDLE_OCR_RUNTIME_DIR
    ? path.resolve(process.env.PADDLE_OCR_RUNTIME_DIR)
    : path.join(projectRoot, ".local-ai", "paddleocr");
  return {
    runtimeRoot,
    python: path.join(runtimeRoot, ".venv", "Scripts", "python.exe"),
    service: path.join(projectRoot, "scripts", "paddleOcrService.py"),
    pidFile: path.join(runtimeRoot, "paddle-ocr.pid"),
    tokenFile: path.join(runtimeRoot, "paddle-ocr-control-token"),
    logFile: path.join(runtimeRoot, "paddle-ocr.log")
  };
}

function endpointUrl(pathname = ""): URL {
  const endpoint = String(process.env.PADDLE_OCR_BASE_URL || defaultEndpoint).trim().replace(/\/+$/, "");
  const parsed = new URL(`${endpoint}${pathname}`);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("PaddleOCR endpoint must use HTTP or HTTPS");
  return parsed;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function installationStatus(): Promise<PaddleInstallationStatus> {
  const paths = runtimePaths();
  const [python, service] = await Promise.all([fileExists(paths.python), fileExists(paths.service)]);
  return {
    installed: python && service,
    controllable: process.platform === "win32" && python && service,
    paths
  };
}

export async function probePaddleOcr({
  fetchImpl = fetch,
  timeoutMs = 1500
}: PaddleFetchOptions = {}): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpointUrl("/health"), { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({})) as PaddleHealthResponse;
    return body.status === "ok" && body.engine === "paddleocr";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPaddleHealth({
  fetchImpl = fetch,
  timeoutMs = 1500
}: PaddleFetchOptions = {}): Promise<PaddleHealthResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpointUrl("/health"), { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json().catch(() => ({})) as PaddleHealthResponse;
    return body.status === "ok" && body.engine === "paddleocr" ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getPaddleOcrStatus({ fetchImpl = fetch }: PaddleFetchOptions = {}): Promise<OcrProviderStatus> {
  const installation = await installationStatus();
  const online = await probePaddleOcr({ fetchImpl });
  const endpoint = endpointUrl();
  const localEndpoint = ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
  return {
    installed: installation.installed,
    online,
    controllable: installation.controllable && localEndpoint,
    state: online ? "online" : installation.installed ? "offline" : "unavailable",
    endpoint: endpoint.origin,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    model: process.env.PADDLE_OCR_MODEL?.trim() || defaultModel,
    device: process.env.PADDLE_OCR_DEVICE?.trim() || "gpu:0",
    message: online
      ? "PaddleOCR 本地复核服务运行正常"
      : installation.installed
        ? "PaddleOCR 已安装，服务尚未启动"
        : "当前机器未安装 PaddleOCR 本地运行环境"
  };
}

function getPaddlePort(): number {
  const endpoint = endpointUrl();
  return Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80));
}

async function findListeningPid(port: number): Promise<number | null> {
  const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], { windowsHide: true });
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0].toUpperCase() !== "TCP") continue;
    if (!fields[1]?.endsWith(`:${port}`) || fields[3]?.toUpperCase() !== "LISTENING") continue;
    const pid = Number(fields[4]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

async function waitForHealth(expectedOnline: boolean, timeoutMs = 60000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await probePaddleOcr({ timeoutMs: 1200 }) === expectedOnline) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  } while (Date.now() < deadline);
  return false;
}

export async function startPaddleOcrService(): Promise<OcrProviderStatus> {
  const current = await getPaddleOcrStatus();
  if (current.online) return current;
  if (!current.controllable) throw new Error(current.installed ? "PADDLE_OCR_NOT_CONTROLLABLE" : "PADDLE_OCR_NOT_INSTALLED");
  const { runtimeRoot, python, service, pidFile, tokenFile, logFile } = runtimePaths();
  const controlToken = randomBytes(32).toString("hex");
  await fs.writeFile(tokenFile, controlToken, { encoding: "utf8", mode: 0o600 });
  const logHandle = await fs.open(logFile, "a");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    USERPROFILE: runtimeRoot,
    HOME: runtimeRoot,
    PADDLE_HOME: path.join(runtimeRoot, "cache"),
    PADDLE_PDX_MODEL_SOURCE: "BOS",
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
    PADDLE_OCR_PORT: String(getPaddlePort()),
    PADDLE_OCR_MODEL: process.env.PADDLE_OCR_MODEL?.trim() || defaultModel,
    PADDLE_OCR_DEVICE: process.env.PADDLE_OCR_DEVICE?.trim() || "gpu:0",
    PADDLE_OCR_CONTROL_TOKEN: controlToken
  };
  const child = spawn(python, [service], {
    cwd: projectRoot,
    detached: true,
    windowsHide: true,
    env,
    stdio: ["ignore", logHandle.fd, logHandle.fd]
  });
  managedServerProcess = child;
  child.once("error", () => {
    if (managedServerProcess === child) managedServerProcess = null;
  });
  child.once("exit", () => {
    if (managedServerProcess === child) managedServerProcess = null;
  });
  child.unref();
  await logHandle.close();
  if (!await waitForHealth(true)) throw new Error("PADDLE_OCR_START_TIMEOUT");
  const health = await fetchPaddleHealth();
  const servicePid = Number(health?.pid);
  if (!Number.isInteger(servicePid) || servicePid <= 0) throw new Error("PADDLE_OCR_PID_UNAVAILABLE");
  await fs.writeFile(pidFile, String(servicePid), "utf8");
  return getPaddleOcrStatus();
}

export async function stopPaddleOcrService(): Promise<OcrProviderStatus> {
  const current = await getPaddleOcrStatus();
  if (!current.online) return current;
  if (!current.controllable) throw new Error("PADDLE_OCR_NOT_CONTROLLABLE");
  const { pidFile, tokenFile } = runtimePaths();
  const savedPid = Number(await fs.readFile(pidFile, "utf8").catch(() => "0"));
  const listeningPid = await findListeningPid(getPaddlePort());
  const pid = savedPid;
  if (!pid || pid !== listeningPid) throw new Error("PADDLE_OCR_PROCESS_MISMATCH");
  const controlToken = await fs.readFile(tokenFile, "utf8").catch(() => "");
  if (!controlToken) throw new Error("PADDLE_OCR_CONTROL_TOKEN_UNAVAILABLE");
  const response = await fetch(endpointUrl("/shutdown"), {
    method: "POST",
    headers: { "X-Paddle-Control-Token": controlToken }
  });
  if (!response.ok) throw new Error("PADDLE_OCR_SHUTDOWN_REJECTED");
  managedServerProcess = null;
  await Promise.all([fs.rm(pidFile, { force: true }), fs.rm(tokenFile, { force: true })]);
  if (!await waitForHealth(false, 10000)) throw new Error("PADDLE_OCR_STOP_TIMEOUT");
  return getPaddleOcrStatus();
}

export async function recognizeImageWithPaddle(image: Uint8Array, {
  fetchImpl = fetch,
  timeoutMs = Number(process.env.PADDLE_OCR_TIMEOUT_MS || 30000)
}: PaddleFetchOptions = {}): Promise<PaddleRecognizedText> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpointUrl("/ocr"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: Buffer.from(image).toString("base64") }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({})) as PaddleOcrResponse;
    if (!response.ok) throw new Error(`PaddleOCR HTTP ${response.status}: ${body.message || body.error || response.statusText}`);
    const lines: OcrLineDetail[] = Array.isArray(body.lines)
      ? body.lines
          .filter((line): line is Record<string, unknown> => Boolean(line && typeof line === "object" && String((line as Record<string, unknown>).text || "").trim()))
          .map((line) => ({
            ...line,
            text: String(line.text).trim(),
            confidence: Number(line.confidence || 0)
          }))
      : [];
    return {
      text: lines.map((line) => String(line.text).trim()).join("\n"),
      lines: lines.map((line) => String(line.text).trim()),
      details: lines,
      durationMs: Number(body.durationMs || 0)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function auditPdfWithPaddleOcr(buffer: Buffer, {
  layout = null,
  totalPages = 0,
  pageNumbers = [],
  maxPages = Number(process.env.PADDLE_OCR_MAX_PAGES || 24)
}: SampledOcrAuditOptions = {}): Promise<OcrAudit> {
  if (!await probePaddleOcr()) throw new Error("PaddleOCR local service is offline");
  const pageCount = Math.max(Number(totalPages || 0), Number(layout?.stats?.pages || layout?.pages?.length || 0));
  const selected = [...new Set(pageNumbers.map(Number).filter((page) => page >= 1 && page <= pageCount))]
    .sort((a, b) => a - b)
    .slice(0, Math.max(1, maxPages));
  if (selected.length === 0) {
    return { ...summarizeOcrAuditPages([], { engine: "paddle-ocr-local", model: defaultModel, totalPages: pageCount }), advisory: true };
  }

  const parser = new PDFParse({ data: buffer });
  const pages: OcrAuditPage[] = [];
  try {
    const screenshots = await parser.getScreenshot({ partial: selected, desiredWidth: defaultRenderWidth, imageBuffer: true, imageDataUrl: false });
    for (let index = 0; index < (screenshots.pages || []).length; index += 1) {
      const screenshot = screenshots.pages[index];
      if (!screenshot.data) continue;
      const pageNumber = Number(screenshot.pageNumber || selected[index]);
      const recognized = await recognizeImageWithPaddle(screenshot.data);
      const averageConfidence = recognized.details.length
        ? Math.round(recognized.details.reduce((sum, line) => sum + Number(line.confidence || 0), 0) / recognized.details.length * 100)
        : 0;
      pages.push(comparePdfAndOcrPage({
        pageNumber,
        confidence: averageConfidence,
        ocrText: recognized.text,
        ocrLines: recognized.lines,
        layoutPage: layout?.pages?.find((page) => Number(page.page) === pageNumber)
      }));
    }
  } finally {
    await parser.destroy();
  }

  return {
    ...summarizeOcrAuditPages(pages, {
      engine: "paddle-ocr-local",
      model: process.env.PADDLE_OCR_MODEL?.trim() || defaultModel,
      totalPages: pageCount,
      message: "PaddleOCR 按冲突页和周期样本进行高精度本地复核；结论只进入差异层，不自动覆盖课程。"
    }),
    advisory: true
  };
}
