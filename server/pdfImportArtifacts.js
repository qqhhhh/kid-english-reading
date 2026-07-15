import fs from "node:fs/promises";
import path from "node:path";

import { PDFParse } from "pdf-parse";

const snapshotSchemaVersion = 1;
const renderBatchSize = 8;

function normalizeLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pageBlocks(lines = [], source, page = null) {
  return lines.map((line, index) => ({
    id: `${source}-${index + 1}`,
    text: normalizeLine(typeof line === "string" ? line : line?.text),
    source,
    x: Number(line?.x || 0),
    top: Number(line?.top ?? line?.y ?? 0),
    width: Number(line?.width || 0),
    height: Number(line?.height || line?.fontSize || 0),
    pageWidth: Number(page?.width || 0),
    pageHeight: Number(page?.height || 0)
  })).filter((block) => block.text);
}

function buildLocalPages(layout, pageAssets) {
  return pageAssets.map((asset) => {
    const page = layout?.pages?.find((candidate) => Number(candidate.page) === asset.pageNumber);
    return {
      pageNumber: asset.pageNumber,
      imageAssetId: asset.id,
      imageUrl: asset.url,
      width: Number(page?.width || 0),
      height: Number(page?.height || 0),
      blocks: pageBlocks(page?.lines || [], "pdf-text-layer", page)
    };
  });
}

function buildProviderLayer(provider) {
  return {
    provider: provider.engine,
    model: provider.model || "",
    advisory: provider.advisory === true,
    status: provider.status,
    message: provider.message || "",
    detail: provider.detail || "",
    pagesProcessed: Number(provider.pagesProcessed || 0),
    totalPages: Number(provider.totalPages || 0),
    pages: (provider.pages || []).map((page) => ({
      pageNumber: Number(page.page || 0),
      status: page.needsReview ? "review" : "good",
      confidence: Number(page.confidence || 0),
      tokenAgreement: Number(page.tokenAgreement || 0),
      blocks: pageBlocks(page.ocrTextLines || page.ocrOnly?.map((line) => line.text) || [], provider.engine),
      localOnly: page.pdfOnly || [],
      upstreamOnly: page.ocrOnly || []
    }))
  };
}

export function buildPdfImportDifferences(ocr) {
  const items = [];
  for (const provider of ocr?.providers || []) {
    if (provider.engine === "tesseract.js-eng" || provider.status === "unavailable") continue;
    for (const page of provider.pages || []) {
      for (const entry of page.pdfOnly || []) items.push({
        id: `${provider.engine}-${page.page}-local-${items.length + 1}`,
        provider: provider.engine,
        pageNumber: Number(page.page || 0),
        kind: "local-only",
        localText: entry.text,
        upstreamText: entry.closest || "",
        similarity: Number(entry.similarity || 0),
        status: "pending"
      });
      for (const entry of page.ocrOnly || []) items.push({
        id: `${provider.engine}-${page.page}-upstream-${items.length + 1}`,
        provider: provider.engine,
        pageNumber: Number(page.page || 0),
        kind: "upstream-only",
        localText: entry.closest || "",
        upstreamText: entry.text,
        similarity: Number(entry.similarity || 0),
        status: "pending"
      });
    }
  }
  for (const page of ocr?.visualReview?.pages || []) {
    for (const text of page.missingLines || []) items.push({
      id: `sensenova-${page.page}-missing-${items.length + 1}`,
      provider: ocr.visualReview.engine,
      pageNumber: Number(page.page || 0),
      kind: "upstream-only",
      localText: "",
      upstreamText: text,
      similarity: 0,
      status: "pending"
    });
    for (const text of page.incorrectLines || []) items.push({
      id: `sensenova-${page.page}-incorrect-${items.length + 1}`,
      provider: ocr.visualReview.engine,
      pageNumber: Number(page.page || 0),
      kind: "incorrect",
      localText: text,
      upstreamText: "",
      similarity: 0,
      status: "pending"
    });
    if (page.readingOrderIssue) items.push({
      id: `sensenova-${page.page}-order-${items.length + 1}`,
      provider: ocr.visualReview.engine,
      pageNumber: Number(page.page || 0),
      kind: "reading-order",
      localText: "",
      upstreamText: page.notes || "阅读顺序需要复核",
      similarity: 0,
      status: "pending"
    });
    if (page.sectionIssue) items.push({
      id: `sensenova-${page.page}-section-${items.length + 1}`,
      provider: ocr.visualReview.engine,
      pageNumber: Number(page.page || 0),
      kind: "section",
      localText: "",
      upstreamText: page.notes || "栏目归属需要复核",
      similarity: 0,
      status: "pending"
    });
  }
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    pages: [...new Set(items.map((item) => item.pageNumber))].sort((a, b) => a - b),
    items
  };
}

export function buildPdfImportSnapshot({ importId, householdId, title, rule, layout, structure, chapters, quality, pageAssets, extractedAt }) {
  const ocr = quality?.ocr || null;
  const upstreamProviders = (ocr?.providers || [])
    .filter((provider) => provider.engine !== "tesseract.js-eng")
    .map(buildProviderLayer);
  const visualReview = ocr?.visualReview ? {
    provider: ocr.visualReview.engine,
    model: ocr.visualReview.model || "",
    status: ocr.visualReview.status,
    message: ocr.visualReview.message || "",
    detail: ocr.visualReview.detail || "",
    pagesProcessed: Number(ocr.visualReview.pagesProcessed || 0),
    totalPages: Number(ocr.visualReview.totalPages || 0),
    pages: ocr.visualReview.pages || []
  } : null;
  const differences = buildPdfImportDifferences(ocr);
  const successfulUpstreams = upstreamProviders.filter((provider) => provider.status !== "unavailable").map((provider) => provider.provider);
  if (visualReview?.status && visualReview.status !== "unavailable") successfulUpstreams.push(visualReview.provider);
  return {
    schemaVersion: snapshotSchemaVersion,
    importId,
    householdId,
    title,
    rule,
    extractedAt,
    pageAssets,
    layers: {
      local: {
        provider: "local-pdf",
        status: quality?.status || "review",
        pages: buildLocalPages(layout, pageAssets),
        structure,
        chapters,
        validation: (ocr?.providers || []).find((provider) => provider.engine === "tesseract.js-eng") || null
      },
      upstream: {
        providers: upstreamProviders,
        visualReview
      },
      differences,
      final: {
        strategy: "local-base-with-reviewed-upstream",
        reviewStatus: differences.pending > 0 ? "pending-review" : "verified",
        verifiedBy: successfulUpstreams,
        appliedDifferenceIds: [],
        pendingDifferenceIds: differences.items.map((item) => item.id),
        structure,
        chapters
      }
    }
  };
}

export async function renderPdfPageAssets(buffer, { importDir, importId, totalPages, desiredWidth = 1400 }) {
  const pagesDir = path.join(importDir, "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  const parser = new PDFParse({ data: buffer });
  const assets = [];
  try {
    for (let start = 1; start <= totalPages; start += renderBatchSize) {
      const pageNumbers = Array.from({ length: Math.min(renderBatchSize, totalPages - start + 1) }, (_, index) => start + index);
      const screenshots = await parser.getScreenshot({ partial: pageNumbers, desiredWidth, imageBuffer: true, imageDataUrl: false });
      for (let index = 0; index < (screenshots.pages || []).length; index += 1) {
        const screenshot = screenshots.pages[index];
        const pageNumber = Number(screenshot.pageNumber || pageNumbers[index]);
        const fileName = `page-${String(pageNumber).padStart(3, "0")}.png`;
        await fs.writeFile(path.join(pagesDir, fileName), screenshot.data);
        assets.push({
          id: `${importId}-page-${String(pageNumber).padStart(3, "0")}`,
          pageNumber,
          fileName,
          url: `/api/import/pdf/artifacts/${importId}/pages/${fileName}`,
          width: Number(screenshot.width || desiredWidth),
          height: Number(screenshot.height || 0),
          mimeType: "image/png",
          uses: []
        });
      }
    }
  } finally {
    await parser.destroy();
  }
  return assets.sort((left, right) => left.pageNumber - right.pageNumber);
}
