import crypto from "node:crypto";

import { PDFParse } from "pdf-parse";

const defaultApiUrl = "https://token.sensenova.cn/v1/chat/completions";
const defaultModel = "sensenova-6.7-flash-lite";
const defaultRenderWidth = 1400;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createSenseNovaToken({ accessKeyId, secretAccessKey, lifetimeSeconds = 1800 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ typ: "JWT", alg: "HS256" }));
  const payload = base64Url(JSON.stringify({ iss: accessKeyId, exp: now + lifetimeSeconds, nbf: now - 5 }));
  const signature = crypto.createHmac("sha256", secretAccessKey).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function getAuthorizationToken() {
  const apiKey = process.env.SENSENOVA_API_KEY?.trim();
  if (apiKey) return apiKey;
  const accessKeyId = process.env.SENSENOVA_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.SENSENOVA_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("SENSENOVA_API_KEY or SENSENOVA_ACCESS_KEY_ID/SENSENOVA_SECRET_ACCESS_KEY is required");
  }
  return createSenseNovaToken({ accessKeyId, secretAccessKey });
}

function extractResponseText(body) {
  const message = body?.data?.choices?.[0]?.message ?? body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map((item) => item?.text || item?.content || "").join("");
  return String(message?.content || message?.text || "");
}

export function parseSenseNovaReviewResponse(value, pageNumber) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("SenseNova review did not return valid JSON");
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  }
  const status = ["good", "review", "warning"].includes(parsed.status) ? parsed.status : "review";
  return {
    page: Number(parsed.page || pageNumber),
    status,
    missingLines: Array.isArray(parsed.missing_lines) ? parsed.missing_lines.map(String).slice(0, 12) : [],
    incorrectLines: Array.isArray(parsed.incorrect_lines) ? parsed.incorrect_lines.map(String).slice(0, 12) : [],
    readingOrderIssue: parsed.reading_order_issue === true,
    sectionIssue: parsed.section_issue === true,
    notes: String(parsed.notes || "").slice(0, 1000)
  };
}

export function buildSenseNovaReviewRequest({ image, prompt, apiUrl = defaultApiUrl, model = defaultModel }) {
  const imageBase64 = Buffer.from(image).toString("base64");
  if (!apiUrl.includes("/v1/llm/")) {
    return {
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } }
        ]
      }],
      max_tokens: 1200,
      reasoning_effort: "low",
      temperature: 0.1,
      top_p: 0.2,
      stream: false
    };
  }
  return {
    model,
    messages: [{
      role: "user",
      content: [
        { type: "image_base64", image_base64: imageBase64 },
        { type: "text", text: prompt }
      ]
    }],
    max_new_tokens: 1200,
    temperature: 0.1,
    top_p: 0.2,
    stream: false,
    thinking: { enabled: false },
    user: "kid-english-pdf-audit"
  };
}

async function reviewImage({ image, pageNumber, pdfLines }) {
  const model = process.env.SENSENOVA_MODEL?.trim() || defaultModel;
  const apiUrl = process.env.SENSENOVA_API_URL?.trim() || defaultApiUrl;
  const timeoutMs = Number(process.env.SENSENOVA_TIMEOUT_MS || 45000);
  const prompt = [
    "你是教材PDF导入复核器。只检查图片中可见的英文，不补写、不改写教材。",
    `这是第 ${pageNumber} 页。PDF文字层当前提取行：`,
    pdfLines.length > 0 ? pdfLines.join("\n") : "（空）",
    "请核对：是否漏英文行、文字是否明显错误、阅读顺序是否错误、标题/栏目是否被误当正文。",
    "只返回JSON：{\"page\":数字,\"status\":\"good|review|warning\",\"missing_lines\":[],\"incorrect_lines\":[],\"reading_order_issue\":false,\"section_issue\":false,\"notes\":\"\"}。",
    "warning仅用于确认存在明显漏识别；不确定时用review。"
  ].join("\n");
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const request = buildSenseNovaReviewRequest({ image, prompt, apiUrl, model });
      if (!apiUrl.includes("/v1/llm/")) request.max_tokens = attempt === 0 ? 2000 : 3200;
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthorizationToken()}`
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`SenseNova HTTP ${response.status}: ${body?.error?.message || response.statusText}`);
      try {
        return parseSenseNovaReviewResponse(extractResponseText(body), pageNumber);
      } catch (error) {
        const finishReason = body?.choices?.[0]?.finish_reason;
        lastError = new Error(`SenseNova response JSON invalid${finishReason ? ` (finish_reason=${finishReason})` : ""}`);
        if (attempt === 0) continue;
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("SenseNova review failed");
}

export async function reviewPdfWithSenseNova(buffer, {
  layout = null,
  totalPages = 0,
  pageNumbers = [],
  maxPages = Number(process.env.SENSENOVA_REVIEW_MAX_PAGES || 12)
} = {}) {
  const pageCount = Math.max(Number(totalPages || 0), Number(layout?.stats?.pages || layout?.pages?.length || 0));
  const selected = [...new Set(pageNumbers.map(Number).filter((page) => page >= 1 && page <= pageCount))]
    .sort((a, b) => a - b)
    .slice(0, Math.max(1, maxPages));
  if (selected.length === 0) {
    return { status: "good", engine: "sensenova-vision", model: process.env.SENSENOVA_MODEL?.trim() || defaultModel, pagesProcessed: 0, totalPages: pageCount, pages: [] };
  }
  const parser = new PDFParse({ data: buffer });
  const pages = [];
  try {
    const screenshots = await parser.getScreenshot({ partial: selected, desiredWidth: defaultRenderWidth, imageBuffer: true, imageDataUrl: false });
    const rendered = screenshots.pages || [];
    const concurrency = Math.max(1, Math.min(3, Number(process.env.SENSENOVA_REVIEW_CONCURRENCY || 2)));
    await Promise.all(Array.from({ length: concurrency }, async (_unused, workerIndex) => {
      for (let index = workerIndex; index < rendered.length; index += concurrency) {
        const screenshot = rendered[index];
        const pageNumber = Number(screenshot.pageNumber || selected[index]);
        if (!screenshot.data) continue;
        const layoutPage = layout?.pages?.find((page) => Number(page.page) === pageNumber);
        const pdfLines = (layoutPage?.lines || []).map((line) => String(line.text || "").trim()).filter(Boolean);
        pages.push(await reviewImage({ image: screenshot.data, pageNumber, pdfLines }));
      }
    }));
  } finally {
    await parser.destroy();
  }
  pages.sort((left, right) => left.page - right.page);
  return {
    status: pages.some((page) => page.status === "warning") ? "warning" : pages.some((page) => page.status === "review") ? "review" : "good",
    engine: "sensenova-vision",
    model: process.env.SENSENOVA_MODEL?.trim() || defaultModel,
    pagesProcessed: pages.length,
    totalPages: pageCount,
    pages
  };
}
