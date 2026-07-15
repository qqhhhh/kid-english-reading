import { createRequire } from "node:module";

import { PDFParse } from "pdf-parse";
import { createWorker, PSM } from "tesseract.js";

const require = createRequire(import.meta.url);
const englishLanguageData = require("@tesseract.js-data/eng");

const defaultRenderWidth = 1400;
const defaultMaxPages = 160;
const englishWordPattern = /[A-Za-z]{2,}/;

function normalizeEnglishText(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^A-Za-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitEnglishLines(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => englishWordPattern.test(line));
}

function getConfidentOcrLines(resultData) {
  const blockLines = (resultData?.blocks || []).flatMap((block) =>
    (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || [])
  );
  if (blockLines.length === 0) return splitEnglishLines(resultData?.text || "");
  return blockLines
    .filter((line) => Number(line.confidence || 0) >= 55)
    .map((line) => String(line.text || "").replace(/\s+/g, " ").trim())
    .filter((line) => englishWordPattern.test(line));
}

function tokenize(value = "") {
  const normalized = normalizeEnglishText(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function countTokenIntersection(leftTokens, rightTokens) {
  const left = countTokens(leftTokens);
  const right = countTokens(rightTokens);
  let matched = 0;
  for (const [token, count] of left) matched += Math.min(count, right.get(token) || 0);
  return matched;
}

function tokenDice(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  return (2 * countTokenIntersection(leftTokens, rightTokens)) / (leftTokens.length + rightTokens.length);
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[right.length];
}

function lineSimilarity(left, right) {
  const normalizedLeft = normalizeEnglishText(left);
  const normalizedRight = normalizeEnglishText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  const characterSimilarity = maxLength > 0 ? 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength : 1;
  const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
  const containmentSimilarity = shorterLength >= 6 && (
    normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)
  ) ? 0.72 + 0.25 * (shorterLength / maxLength) : 0;
  return Math.max(tokenDice(normalizedLeft, normalizedRight), characterSimilarity, containmentSimilarity);
}

function findBestMatch(line, candidates) {
  let best = { similarity: 0, text: "" };
  for (const candidate of candidates) {
    const similarity = lineSimilarity(line, candidate);
    if (similarity > best.similarity) best = { similarity, text: candidate };
  }
  return best;
}

function summarizeUnmatched(lines, candidates) {
  return lines
    .map((sourceText) => ({ sourceText, best: findBestMatch(sourceText, candidates) }))
    .filter((item) => item.best.similarity < 0.68)
    .map((item) => ({
      text: item.sourceText,
      closest: item.best.similarity >= 0.32 ? item.best.text : "",
      similarity: Math.round(item.best.similarity * 100)
    }));
}

function getPdfEnglishLines(layoutPage) {
  return (layoutPage?.lines || [])
    .map((line) => String(line.text || "").replace(/\s+/g, " ").trim())
    .filter((line) => englishWordPattern.test(line));
}

export function comparePdfAndOcrPage({ pageNumber, confidence, ocrText, ocrLines: providedOcrLines, layoutPage }) {
  const pdfLines = getPdfEnglishLines(layoutPage);
  const ocrLines = providedOcrLines || splitEnglishLines(ocrText);
  const pdfTokens = tokenize(pdfLines.join(" "));
  const ocrTokens = tokenize(ocrLines.join(" "));
  const matchedTokens = countTokenIntersection(pdfTokens, ocrTokens);
  const tokenAgreement = Math.max(pdfTokens.length, ocrTokens.length) > 0
    ? Math.round((matchedTokens / Math.max(pdfTokens.length, ocrTokens.length)) * 100)
    : 100;
  const pdfOnly = summarizeUnmatched(pdfLines, ocrLines);
  const ocrOnly = summarizeUnmatched(ocrLines, pdfLines);
  const credibleOcrOnly = ocrOnly.filter((line) => tokenize(line.text).length >= 3 && line.similarity < 35);
  const missingTextLayer = confidence >= 65 && pdfTokens.length === 0 && ocrTokens.length >= 5;
  const needsReview = missingTextLayer || (
    confidence >= 60 && credibleOcrOnly.length > 0 && tokenAgreement < 75
  );

  return {
    page: pageNumber,
    confidence: Math.round(Number(confidence || 0)),
    pdfLines: pdfLines.length,
    ocrLines: ocrLines.length,
    pdfTokens: pdfTokens.length,
    ocrTokens: ocrTokens.length,
    matchedTokens,
    tokenAgreement,
    missingTextLayer,
    needsReview,
    pdfTextLines: pdfLines,
    ocrTextLines: ocrLines,
    pdfOnly: pdfOnly.slice(0, 8),
    ocrOnly: ocrOnly.slice(0, 8)
  };
}

export function buildUnavailableOcrAudit(message = "OCR unavailable") {
  return {
    status: "unavailable",
    engine: "tesseract.js-eng",
    message: String(message || "OCR unavailable"),
    pagesProcessed: 0,
    totalPages: 0,
    tokenAgreement: 0,
    reviewPages: [],
    criticalPages: [],
    pages: []
  };
}

export function summarizeOcrAuditPages(pages, {
  engine = "unknown",
  model = "",
  totalPages = pages.length,
  message = ""
} = {}) {
  const sortedPages = [...pages].sort((left, right) => left.page - right.page);
  const pdfTokens = sortedPages.reduce((sum, page) => sum + page.pdfTokens, 0);
  const ocrTokens = sortedPages.reduce((sum, page) => sum + page.ocrTokens, 0);
  const matchedTokens = sortedPages.reduce((sum, page) => sum + page.matchedTokens, 0);
  const tokenAgreement = Math.max(pdfTokens, ocrTokens) > 0
    ? Math.round((matchedTokens / Math.max(pdfTokens, ocrTokens)) * 100)
    : 100;
  const criticalPages = sortedPages.filter((page) => page.missingTextLayer).map((page) => page.page);
  const reviewPages = sortedPages.filter((page) => page.needsReview).map((page) => page.page);

  return {
    status: criticalPages.length > 0 ? "warning" : reviewPages.length > 0 ? "review" : "good",
    engine,
    ...(model ? { model } : {}),
    ...(message ? { message } : {}),
    totalPages,
    pagesProcessed: sortedPages.length,
    truncated: sortedPages.length < totalPages,
    pdfTokens,
    ocrTokens,
    matchedTokens,
    tokenAgreement,
    reviewPages,
    criticalPages,
    pages: sortedPages
  };
}

export async function auditPdfWithOcr(buffer, {
  layout = null,
  totalPages = 0,
  maxPages = defaultMaxPages,
  pageNumbers = null
} = {}) {
  const pageCount = Math.max(Number(totalPages || 0), Number(layout?.stats?.pages || layout?.pages?.length || 0));
  if (pageCount <= 0) return buildUnavailableOcrAudit("PDF page count is unavailable");

  const requestedPages = Array.isArray(pageNumbers) && pageNumbers.length > 0
    ? [...new Set(pageNumbers.map(Number).filter((page) => page >= 1 && page <= pageCount))].sort((a, b) => a - b)
    : Array.from({ length: pageCount }, (_, index) => index + 1);
  const pagesToProcess = requestedPages.slice(0, maxPages);
  const parser = new PDFParse({ data: buffer });
  const workers = [];
  const pages = [];

  try {
    for (let index = 0; index < 2; index += 1) {
      workers.push(await createWorker("eng", 1, {
        langPath: englishLanguageData.langPath,
        gzip: englishLanguageData.gzip,
        cacheMethod: "readOnly"
      }));
    }
    await Promise.all(workers.map((worker) => worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300"
    })));

    for (let start = 0; start < pagesToProcess.length; start += 8) {
      const batch = pagesToProcess.slice(start, start + 8);
      const screenshots = await parser.getScreenshot({
        partial: batch,
        desiredWidth: defaultRenderWidth,
        imageBuffer: true,
        imageDataUrl: false
      });

      const renderedPages = screenshots.pages || [];
      await Promise.all(workers.map(async (worker, workerIndex) => {
        for (let index = workerIndex; index < renderedPages.length; index += workers.length) {
          const screenshot = renderedPages[index];
          const pageNumber = Number(screenshot.pageNumber || batch[index] || pages.length + 1);
          const result = await worker.recognize(screenshot.data, {}, { blocks: true, text: true });
          pages.push(comparePdfAndOcrPage({
            pageNumber,
            confidence: result.data.confidence,
            ocrText: result.data.text,
            ocrLines: getConfidentOcrLines(result.data),
            layoutPage: layout?.pages?.find((page) => Number(page.page) === pageNumber)
          }));
        }
      }));
    }
  } finally {
    await Promise.allSettled([...workers.map((worker) => worker.terminate()), parser.destroy()]);
  }

  return summarizeOcrAuditPages(pages, {
    engine: "tesseract.js-eng",
    model: "eng-4.0.0",
    totalPages: pageCount
  });
}
