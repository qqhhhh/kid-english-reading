import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { PDFParse } from "pdf-parse";

import { comparePdfAndOcrPage, summarizeOcrAuditPages } from "../pdfOcrAudit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const defaultEndpoint = "http://127.0.0.1:8086";
const defaultModel = "HYVL";
const defaultRenderWidth = 1400;
const execFileAsync = promisify(execFile);
let managedServerProcess = null;

function runtimePaths() {
  const runtimeRoot = process.env.HUNYUAN_OCR_RUNTIME_DIR
    ? path.resolve(process.env.HUNYUAN_OCR_RUNTIME_DIR)
    : path.join(projectRoot, ".local-ai", "hunyuanocr");
  return {
    runtimeRoot,
    server: path.join(runtimeRoot, "bin", "llama-server.exe"),
    model: path.join(runtimeRoot, "models", "HunyuanOCR-Q8_0.gguf"),
    projector: path.join(runtimeRoot, "models", "mmproj-HunyuanOCR-Q8_0.gguf")
  };
}

function endpointUrl(pathname = "") {
  const endpoint = String(process.env.HUNYUAN_OCR_BASE_URL || defaultEndpoint).trim().replace(/\/+$/, "");
  const parsed = new URL(`${endpoint}${pathname}`);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("HunyuanOCR endpoint must use HTTP or HTTPS");
  return parsed;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function installationStatus() {
  const paths = runtimePaths();
  const [server, model, projector] = await Promise.all([
    fileExists(paths.server),
    fileExists(paths.model),
    fileExists(paths.projector)
  ]);
  return {
    installed: server && model && projector,
    controllable: process.platform === "win32" && server && model && projector,
    paths
  };
}

export function buildHunyuanOcrRequest({ image, model = defaultModel, maxTokens = 4096 }) {
  return {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    stream: false,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: "提取文档图片中正文的所有信息用markdown格式表示，其中页眉、页脚部分忽略，按照阅读顺序组织进行解析。请忠实保留英文原文、栏目标题、音标、中文释义和标点，不要解释。"
        },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${Buffer.from(image).toString("base64")}` }
        }
      ]
    }]
  };
}

function responseMessage(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item?.text || item?.content || "").join("\n");
  return "";
}

export function normalizeHunyuanOcrText(value) {
  const lines = String(value || "")
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-+]\s+/, "")
      .replace(/^\*\*(.*?)\*\*$/, "$1")
      .replace(/\s+/g, " ")
      .trim())
    .filter((line) => line && !/^\|?\s*:?-{3,}/.test(line));
  return { text: lines.join("\n"), lines };
}

export async function probeHunyuanOcr({ fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpointUrl("/health"), { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({}));
    return body.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function getHunyuanOcrStatus({ fetchImpl = fetch } = {}) {
  const installation = await installationStatus();
  const online = await probeHunyuanOcr({ fetchImpl });
  const endpoint = endpointUrl();
  const localEndpoint = ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
  return {
    installed: installation.installed,
    online,
    controllable: installation.controllable && localEndpoint,
    state: online ? "online" : installation.installed ? "offline" : "unavailable",
    endpoint: endpoint.origin,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    model: process.env.HUNYUAN_OCR_MODEL?.trim() || defaultModel,
    message: online
      ? "HunyuanOCR 本地复核服务运行正常"
      : installation.installed
        ? "模型已安装，服务尚未启动"
        : "当前机器未安装 HunyuanOCR 本地模型"
  };
}

function getHunyuanPort() {
  const endpoint = endpointUrl();
  return Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80));
}

async function findHunyuanServerPid(port) {
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

async function assertHunyuanServerProcess(pid) {
  const { stdout } = await execFileAsync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true });
  const imageName = stdout.trim().match(/^"([^"]+)"/)?.[1]?.toLowerCase();
  if (imageName !== "llama-server.exe") throw new Error("HUNYUAN_OCR_PROCESS_MISMATCH");
}

async function waitForHealth(expectedOnline, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await probeHunyuanOcr({ timeoutMs: 1200 }) === expectedOnline) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  } while (Date.now() < deadline);
  return false;
}

export async function startHunyuanOcrService() {
  const current = await getHunyuanOcrStatus();
  if (current.online) return current;
  if (!current.controllable) throw new Error(current.installed ? "HUNYUAN_OCR_NOT_CONTROLLABLE" : "HUNYUAN_OCR_NOT_INSTALLED");
  const { runtimeRoot, server, model, projector } = runtimePaths();
  const port = getHunyuanPort();
  const child = spawn(server, [
    "--model", model,
    "--mmproj", projector,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--alias", defaultModel,
    "--ctx-size", "10240",
    "--n-predict", "4096",
    "--parallel", "1",
    "--gpu-layers", "99"
  ], {
    cwd: runtimeRoot,
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  managedServerProcess = child;
  child.once("error", () => {
    if (managedServerProcess === child) managedServerProcess = null;
  });
  child.once("exit", () => {
    if (managedServerProcess === child) managedServerProcess = null;
  });
  child.unref();
  if (!await waitForHealth(true)) throw new Error("HUNYUAN_OCR_START_TIMEOUT");
  return getHunyuanOcrStatus();
}

export async function stopHunyuanOcrService() {
  const current = await getHunyuanOcrStatus();
  if (!current.online) return current;
  if (!current.controllable) throw new Error("HUNYUAN_OCR_NOT_CONTROLLABLE");
  const pid = managedServerProcess?.pid || await findHunyuanServerPid(getHunyuanPort());
  if (!pid) throw new Error("HUNYUAN_OCR_PROCESS_NOT_FOUND");
  await assertHunyuanServerProcess(pid);
  await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  managedServerProcess = null;
  if (!await waitForHealth(false, 10000)) throw new Error("HUNYUAN_OCR_STOP_TIMEOUT");
  return getHunyuanOcrStatus();
}

export async function recognizeImageWithHunyuan(image, {
  fetchImpl = fetch,
  timeoutMs = Number(process.env.HUNYUAN_OCR_TIMEOUT_MS || 90000)
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpointUrl("/v1/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildHunyuanOcrRequest({
        image,
        model: process.env.HUNYUAN_OCR_MODEL?.trim() || defaultModel,
        maxTokens: Number(process.env.HUNYUAN_OCR_MAX_TOKENS || 4096)
      })),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HunyuanOCR HTTP ${response.status}: ${body?.error?.message || response.statusText}`);
    const content = responseMessage(body);
    if (!content.trim()) throw new Error("HunyuanOCR returned empty content");
    return normalizeHunyuanOcrText(content);
  } finally {
    clearTimeout(timer);
  }
}

export async function auditPdfWithHunyuanOcr(buffer, {
  layout = null,
  totalPages = 0,
  pageNumbers = [],
  maxPages = Number(process.env.HUNYUAN_OCR_MAX_PAGES || 12)
} = {}) {
  if (!await probeHunyuanOcr()) throw new Error("HunyuanOCR local service is offline");
  const pageCount = Math.max(Number(totalPages || 0), Number(layout?.stats?.pages || layout?.pages?.length || 0));
  const selected = [...new Set(pageNumbers.map(Number).filter((page) => page >= 1 && page <= pageCount))]
    .sort((a, b) => a - b)
    .slice(0, Math.max(1, maxPages));
  if (selected.length === 0) {
    return { ...summarizeOcrAuditPages([], { engine: "hunyuan-ocr-local", model: "HunyuanOCR-Q8_0", totalPages: pageCount }), advisory: true };
  }

  const parser = new PDFParse({ data: buffer });
  const pages = [];
  try {
    const screenshots = await parser.getScreenshot({ partial: selected, desiredWidth: defaultRenderWidth, imageBuffer: true, imageDataUrl: false });
    for (let index = 0; index < (screenshots.pages || []).length; index += 1) {
      const screenshot = screenshots.pages[index];
      if (!screenshot.data) continue;
      const pageNumber = Number(screenshot.pageNumber || selected[index]);
      const recognized = await recognizeImageWithHunyuan(screenshot.data);
      pages.push(comparePdfAndOcrPage({
        pageNumber,
        confidence: 90,
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
      engine: "hunyuan-ocr-local",
      model: "HunyuanOCR-Q8_0",
      totalPages: pageCount,
      message: "HunyuanOCR 按冲突页和周期样本复核；结论只进入差异层，不自动覆盖课程。"
    }),
    advisory: true
  };
}
