import crypto from "node:crypto";

import { PDFParse } from "pdf-parse";

import { comparePdfAndOcrPage, summarizeOcrAuditPages } from "../pdfOcrAudit.js";
import type { OcrAuditOptions, OcrLineDetail } from "../types/ocr.js";
import type { OcrAudit, OcrAuditPage } from "../types/pdf.js";

const defaultHost = "cn-east-1.api.xf-yun.com";
const defaultPath = "/v1/ocr";
const defaultRenderWidth = 1400;

interface XfyunOcrRawWord {
  content?: unknown;
  conf?: unknown;
  coord?: unknown[];
}

interface XfyunOcrRawLine extends XfyunOcrRawWord {
  words?: XfyunOcrRawWord[];
}

interface XfyunOcrDecodedPayload {
  version?: unknown;
  pages?: Array<{ lines?: XfyunOcrRawLine[] }>;
}

interface XfyunOcrRawResponse {
  header?: { code?: unknown; message?: unknown };
  payload?: { ocr_output_text?: { text?: unknown } };
  message?: unknown;
  code?: unknown;
  error?: { message?: unknown };
}

interface XfyunOcrResult {
  engineVersion: string;
  confidence: number;
  lines: OcrLineDetail[];
  text: string;
}

interface XfyunOcrImageOptions {
  appId?: string;
  apiKey?: string;
  apiSecret?: string;
  language?: string;
  timeoutMs?: number;
}

function requiredCredential(primaryName: string, fallbackName: string): string {
  const value = process.env[primaryName]?.trim() || process.env[fallbackName]?.trim();
  if (!value) throw new Error(`${primaryName} (or ${fallbackName}) is required for XFYUN OCR`);
  return value;
}

function buildSignedUrl(
  apiKey: string,
  apiSecret: string,
  host = defaultHost,
  pathname = defaultPath
): string {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nPOST ${pathname} HTTP/1.1`;
  const signature = crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");
  return `https://${host}${pathname}?${new URLSearchParams({ authorization, date, host }).toString()}`;
}

export function normalizeXfyunOcrResponse(response: unknown): XfyunOcrResult {
  const raw = (response && typeof response === "object" ? response : {}) as XfyunOcrRawResponse;
  if (Number(raw.header?.code || 0) !== 0) {
    throw new Error(`XFYUN OCR ${raw.header?.code}: ${raw.header?.message || "request failed"}`);
  }
  const encoded = raw.payload?.ocr_output_text?.text;
  if (!encoded) throw new Error("XFYUN OCR response did not include text data");
  const decoded = JSON.parse(Buffer.from(String(encoded), "base64").toString("utf8")) as XfyunOcrDecodedPayload;
  const page = decoded?.pages?.[0] || {};
  const details: OcrLineDetail[] = (page.lines || [])
    .map((line): OcrLineDetail => ({
      text: String(line.content || "").replace(/\s+/g, " ").trim(),
      confidence: Math.round(Number(line.conf || 0) * 100),
      polygon: Array.isArray(line.coord) ? line.coord : [],
      words: (line.words || []).map((word): OcrLineDetail => ({
        text: String(word.content || "").trim(),
        confidence: Math.round(Number(word.conf || 0) * 100),
        polygon: Array.isArray(word.coord) ? word.coord : []
      }))
    }))
    .filter((line) => line.text);
  const confidence = details.length > 0
    ? Math.round(details.reduce((sum, line) => sum + line.confidence, 0) / details.length)
    : 0;
  return {
    engineVersion: String(decoded?.version || ""),
    confidence,
    lines: details,
    text: details.map((line) => line.text).join("\n")
  };
}

export async function recognizeXfyunOcrImage(imageBuffer: Uint8Array, {
  appId = requiredCredential("XFYUN_OCR_APP_ID", "XFYUN_APP_ID"),
  apiKey = requiredCredential("XFYUN_OCR_API_KEY", "XFYUN_API_KEY"),
  apiSecret = requiredCredential("XFYUN_OCR_API_SECRET", "XFYUN_API_SECRET"),
  language = process.env.XFYUN_OCR_LANGUAGE?.trim() || "en",
  timeoutMs = Number(process.env.XFYUN_OCR_TIMEOUT_MS || 30000)
}: XfyunOcrImageOptions = {}): Promise<XfyunOcrResult> {
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
    const body = await response.json().catch(() => ({})) as XfyunOcrRawResponse;
    if (!response.ok) {
      const detail = body.message || body.header?.message || body.error?.message || response.statusText;
      const code = body?.header?.code || body?.code || "";
      throw new Error(`XFYUN OCR HTTP ${response.status}${code ? `/${code}` : ""}: ${detail}`);
    }
    return normalizeXfyunOcrResponse(body);
  } finally {
    clearTimeout(timer);
  }
}

export async function auditPdfWithXfyunOcr(buffer: Buffer, {
  layout = null,
  totalPages = 0,
  pageNumbers = null,
  maxPages = Number(process.env.XFYUN_OCR_MAX_PAGES || 160)
}: OcrAuditOptions = {}): Promise<OcrAudit> {
  const pageCount = Math.max(Number(totalPages || 0), Number(layout?.stats?.pages || layout?.pages?.length || 0));
  const requested = Array.isArray(pageNumbers) && pageNumbers.length > 0
    ? [...new Set(pageNumbers.map(Number).filter((page) => page >= 1 && page <= pageCount))].sort((a, b) => a - b)
    : Array.from({ length: pageCount }, (_, index) => index + 1);
  const pagesToProcess = requested.slice(0, Math.max(1, maxPages));
  const parser = new PDFParse({ data: buffer });
  const pages: OcrAuditPage[] = [];
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
