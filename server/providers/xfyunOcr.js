import crypto from "node:crypto";

import { PDFParse } from "pdf-parse";

import { comparePdfAndOcrPage, summarizeOcrAuditPages } from "../pdfOcrAudit.js";

const defaultHost = "cn-east-1.api.xf-yun.com";
const defaultPath = "/v1/ocr";
const defaultRenderWidth = 1400;

function requiredCredential(primaryName, fallbackName) {
  const value = process.env[primaryName]?.trim() || process.env[fallbackName]?.trim();
  if (!value) throw new Error(`${primaryName} (or ${fallbackName}) is required for XFYUN OCR`);
  return value;
}

function buildSignedUrl(apiKey, apiSecret, host = defaultHost, pathname = defaultPath) {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nPOST ${pathname} HTTP/1.1`;
  const signature = crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");
  return `https://${host}${pathname}?${new URLSearchParams({ authorization, date, host }).toString()}`;
}

export function normalizeXfyunOcrResponse(response) {
  if (Number(response?.header?.code || 0) !== 0) {
    throw new Error(`XFYUN OCR ${response?.header?.code}: ${response?.header?.message || "request failed"}`);
  }
  const encoded = response?.payload?.ocr_output_text?.text;
  if (!encoded) throw new Error("XFYUN OCR response did not include text data");
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const page = decoded?.pages?.[0] || {};
  const lines = (page.lines || [])
    .map((line) => ({
      text: String(line.content || "").replace(/\s+/g, " ").trim(),
      confidence: Math.round(Number(line.conf || 0) * 100),
      polygon: Array.isArray(line.coord) ? line.coord : [],
      words: (line.words || []).map((word) => ({
        text: String(word.content || "").trim(),
        confidence: Math.round(Number(word.conf || 0) * 100),
        polygon: Array.isArray(word.coord) ? word.coord : []
      }))
    }))
    .filter((line) => line.text);
  const confidence = lines.length > 0
    ? Math.round(lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length)
    : 0;
  return {
    engineVersion: String(decoded?.version || ""),
    confidence,
    lines,
    text: lines.map((line) => line.text).join("\n")
  };
}

export async function recognizeXfyunOcrImage(imageBuffer, {
  appId = requiredCredential("XFYUN_OCR_APP_ID", "XFYUN_APP_ID"),
  apiKey = requiredCredential("XFYUN_OCR_API_KEY", "XFYUN_API_KEY"),
  apiSecret = requiredCredential("XFYUN_OCR_API_SECRET", "XFYUN_API_SECRET"),
  language = process.env.XFYUN_OCR_LANGUAGE?.trim() || "en",
  timeoutMs = Number(process.env.XFYUN_OCR_TIMEOUT_MS || 30000)
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildSignedUrl(apiKey, apiSecret), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        header: { app_id: appId, status: 3 },
        parameter: {
          ocr: {
            language,
            ocr_output_text: { encoding: "utf8", compress: "raw", format: "json" }
          }
        },
        payload: {
          image: { encoding: "png", image: Buffer.from(imageBuffer).toString("base64"), status: 3 }
        }
      }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.message || body?.header?.message || body?.error?.message || response.statusText;
      const code = body?.header?.code || body?.code || "";
      throw new Error(`XFYUN OCR HTTP ${response.status}${code ? `/${code}` : ""}: ${detail}`);
    }
    return normalizeXfyunOcrResponse(body);
  } finally {
    clearTimeout(timer);
  }
}

export async function auditPdfWithXfyunOcr(buffer, {
  layout = null,
  totalPages = 0,
  pageNumbers = null,
  maxPages = Number(process.env.XFYUN_OCR_MAX_PAGES || 160)
} = {}) {
  const pageCount = Math.max(Number(totalPages || 0), Number(layout?.stats?.pages || layout?.pages?.length || 0));
  const requested = Array.isArray(pageNumbers) && pageNumbers.length > 0
    ? [...new Set(pageNumbers.map(Number).filter((page) => page >= 1 && page <= pageCount))].sort((a, b) => a - b)
    : Array.from({ length: pageCount }, (_, index) => index + 1);
  const pagesToProcess = requested.slice(0, Math.max(1, maxPages));
  const parser = new PDFParse({ data: buffer });
  const pages = [];
  let engineVersion = "";
  try {
    for (let start = 0; start < pagesToProcess.length; start += 4) {
      const batch = pagesToProcess.slice(start, start + 4);
      const screenshots = await parser.getScreenshot({
        partial: batch,
        desiredWidth: defaultRenderWidth,
        imageBuffer: true,
        imageDataUrl: false
      });
      for (const screenshot of screenshots.pages || []) {
        const pageNumber = Number(screenshot.pageNumber || batch[pages.length] || 0);
        const recognized = await recognizeXfyunOcrImage(screenshot.data);
        engineVersion ||= recognized.engineVersion;
        pages.push(comparePdfAndOcrPage({
          pageNumber,
          confidence: recognized.confidence,
          ocrText: recognized.text,
          ocrLines: recognized.lines.filter((line) => line.confidence >= 55).map((line) => line.text),
          layoutPage: layout?.pages?.find((page) => Number(page.page) === pageNumber)
        }));
      }
    }
  } finally {
    await parser.destroy();
  }
  return summarizeOcrAuditPages(pages, {
    engine: "xfyun-multilingual-printed-ocr",
    model: engineVersion || "cloud",
    totalPages: pageCount,
    message: pages.length < pageCount ? "云端按抽样/冲突页模式复核，未消耗整本额度。" : ""
  });
}
