import crypto from "node:crypto";

import { PDFDocument } from "pdf-lib";

import { comparePdfAndOcrPage, summarizeOcrAuditPages } from "../pdfOcrAudit.js";

const startUrl = "https://iocr.xfyun.cn/ocrzdq/v1/pdfOcr/start";
const statusUrl = "https://iocr.xfyun.cn/ocrzdq/v1/pdfOcr/status";

function requiredCredential(name, fallbackName = "") {
  const value = process.env[name]?.trim() || (fallbackName ? process.env[fallbackName]?.trim() : "");
  if (!value) throw new Error(`${name}${fallbackName ? ` (or ${fallbackName})` : ""} is required for XFYUN PDF OCR`);
  return value;
}

export function createXfyunPdfOcrSignature({ appId, secret, timestamp }) {
  const auth = crypto.createHash("md5").update(`${appId}${timestamp}`).digest("hex");
  return crypto.createHmac("sha1", secret).update(auth).digest("base64");
}

function authHeaders({
  appId = requiredCredential("XFYUN_PDF_OCR_APP_ID", "XFYUN_OCR_APP_ID"),
  secret = requiredCredential("XFYUN_PDF_OCR_SECRET", "XFYUN_OCR_API_SECRET")
} = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    appId,
    timestamp,
    signature: createXfyunPdfOcrSignature({ appId, secret, timestamp })
  };
}

function parseTaskResponse(body, action) {
  if (!body?.flag || Number(body?.code || 0) !== 0 || !body?.data) {
    throw new Error(`XFYUN PDF OCR ${action} ${body?.code ?? "unknown"}: ${body?.desc || body?.data?.tip || "request failed"}`);
  }
  return body.data;
}

export async function extractPdfPages(buffer, pageNumbers) {
  const source = await PDFDocument.load(buffer);
  const requested = [...new Set(pageNumbers.map(Number).filter((page) => page >= 1 && page <= source.getPageCount()))].sort((a, b) => a - b);
  if (requested.length === 0) throw new Error("At least one valid PDF page is required for XFYUN PDF OCR");
  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, requested.map((page) => page - 1));
  copied.forEach((page) => target.addPage(page));
  return { buffer: Buffer.from(await target.save()), originalPages: requested };
}

export async function startXfyunPdfOcr(buffer, { fileName = "audit.pdf", fetchImpl = fetch } = {}) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/pdf" }), fileName);
  form.append("exportFormat", "json");
  const response = await fetchImpl(startUrl, { method: "POST", headers: authHeaders(), body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`XFYUN PDF OCR start HTTP ${response.status}: ${body?.desc || response.statusText}`);
  return parseTaskResponse(body, "start");
}

export async function getXfyunPdfOcrStatus(taskNo, { fetchImpl = fetch } = {}) {
  const url = new URL(statusUrl);
  url.searchParams.set("taskNo", taskNo);
  const response = await fetchImpl(url, { headers: authHeaders() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`XFYUN PDF OCR status HTTP ${response.status}: ${body?.desc || response.statusText}`);
  return parseTaskResponse(body, "status");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForXfyunPdfOcr(taskNo, {
  fetchImpl = fetch,
  timeoutMs = Number(process.env.XFYUN_PDF_OCR_TIMEOUT_MS || 180000),
  pollIntervalMs = Number(process.env.XFYUN_PDF_OCR_POLL_MS || 5000)
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await delay(Math.max(5000, pollIntervalMs));
    const status = await getXfyunPdfOcrStatus(taskNo, { fetchImpl });
    if (status.status === "FINISH" || status.status === "ANY_FAILED") return status;
    if (["FAILED", "STOP"].includes(status.status)) throw new Error(`XFYUN PDF OCR task ${status.status}: ${status.tip || "processing failed"}`);
  }
  throw new Error(`XFYUN PDF OCR task timed out after ${timeoutMs}ms`);
}

export async function downloadXfyunPdfOcrResult(downloadUrl, { fetchImpl = fetch } = {}) {
  const parsed = new URL(downloadUrl);
  if (!/\.(?:openstorage\.cn|xfyun\.cn)$/i.test(parsed.hostname)) {
    throw new Error("XFYUN PDF OCR returned an unexpected download host");
  }
  const response = await fetchImpl(parsed);
  if (!response.ok) throw new Error(`XFYUN PDF OCR download HTTP ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("XFYUN PDF OCR download was not valid JSON");
  }
}

export async function recognizePdfWithXfyun(buffer, { pageNumbers = [], fetchImpl = fetch } = {}) {
  const extracted = await extractPdfPages(buffer, pageNumbers);
  const task = await startXfyunPdfOcr(extracted.buffer, { fetchImpl });
  if (!task.taskNo) throw new Error("XFYUN PDF OCR start response did not include taskNo");
  const completed = await waitForXfyunPdfOcr(task.taskNo, { fetchImpl });
  if (!completed.downUrl) throw new Error("XFYUN PDF OCR completed without a download URL");
  return {
    taskNo: task.taskNo,
    originalPages: extracted.originalPages,
    pageList: completed.pageList || [],
    result: await downloadXfyunPdfOcrResult(completed.downUrl, { fetchImpl })
  };
}

function collectTextUnits(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectTextUnits(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (value.type === "text_unit" && typeof value.text === "string" && value.text.trim()) output.push(value.text.trim());
  for (const child of Object.values(value)) collectTextUnits(child, output);
  return output;
}

function collectTextLines(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectTextLines(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (value.type === "textline") {
    const text = collectTextUnits(value.content).join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      output.push({
        text,
        confidence: Math.round(Math.max(0, Math.min(1, Number(value.score ?? 1))) * 100),
        polygon: Array.isArray(value.coord) ? value.coord : []
      });
    }
    return output;
  }
  for (const child of Object.values(value)) collectTextLines(child, output);
  return output;
}

export function normalizeXfyunPdfOcrResult(result) {
  const pages = Array.isArray(result) ? result : [result];
  return pages.map((page) => {
    const lines = collectTextLines(page?.image || page);
    return {
      engineVersion: String(page?.engine_version || page?.version || ""),
      confidence: lines.length > 0 ? Math.round(lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length) : 0,
      lines,
      text: lines.map((line) => line.text).join("\n")
    };
  });
}

export async function auditPdfWithXfyunPdfOcr(buffer, {
  layout = null,
  totalPages = 0,
  pageNumbers = [],
  maxPages = Number(process.env.XFYUN_PDF_OCR_MAX_PAGES || 12)
} = {}) {
  const selected = [...new Set(pageNumbers.map(Number).filter((page) => page >= 1 && page <= totalPages))]
    .sort((a, b) => a - b)
    .slice(0, Math.max(1, Math.min(100, maxPages)));
  if (selected.length === 0) {
    return summarizeOcrAuditPages([], { engine: "xfyun-pdf-ocr", model: "cloud", totalPages });
  }
  const recognized = await recognizePdfWithXfyun(buffer, { pageNumbers: selected });
  const normalized = normalizeXfyunPdfOcrResult(recognized.result);
  const pages = recognized.originalPages.map((pageNumber, index) => {
    const page = normalized[index] || { confidence: 0, lines: [], text: "" };
    return comparePdfAndOcrPage({
      pageNumber,
      confidence: page.confidence,
      ocrText: page.text,
      ocrLines: page.lines.filter((line) => line.confidence >= 55).map((line) => line.text),
      layoutPage: layout?.pages?.find((candidate) => Number(candidate.page) === pageNumber)
    });
  });
  return summarizeOcrAuditPages(pages, {
    engine: "xfyun-pdf-ocr",
    model: normalized.find((page) => page.engineVersion)?.engineVersion || "cloud",
    totalPages,
    message: pages.length < totalPages ? "讯飞 PDF OCR 大模型按抽样/冲突页复核，未消耗整本额度。" : ""
  });
}
