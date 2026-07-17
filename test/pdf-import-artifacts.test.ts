import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { buildPdfImportDifferences, buildPdfImportSnapshot, renderPdfPageAssets } from "../server/pdfImportArtifacts.js";
import type { PdfImportQualityReport, PdfLayout } from "../server/types/pdf.js";

const chapters = [{ id: "unit-1", title: "Unit 1", text: "Can you help?", sentences: [{ id: "s1", text: "Can you help?" }] }];

test("keeps local, upstream, differences and final PDF import layers separate", () => {
  const quality: PdfImportQualityReport = {
    status: "review",
    totalSentences: 1,
    cleanSentences: 1,
    issueSentences: 0,
    counts: { high: 0, medium: 0, low: 0 },
    issues: [],
    coverage: null,
    consistency: null,
    ocr: {
      status: "review",
      engine: "multi-provider",
      pagesProcessed: 1,
      totalPages: 1,
      tokenAgreement: 80,
      reviewPages: [1],
      criticalPages: [],
      pages: [],
      providers: [
        { engine: "tesseract.js-eng", status: "good", pagesProcessed: 1, totalPages: 1, tokenAgreement: 100, reviewPages: [], criticalPages: [], pages: [] },
        {
          engine: "upstream-ocr-test",
          model: "test",
          status: "review",
          pagesProcessed: 1,
          totalPages: 1,
          tokenAgreement: 80,
          reviewPages: [1],
          criticalPages: [],
          pages: [{
            page: 1,
            confidence: 96,
            pdfLines: 0,
            ocrLines: 1,
            pdfTokens: 0,
            ocrTokens: 3,
            matchedTokens: 0,
            tokenAgreement: 80,
            missingTextLayer: false,
            needsReview: true,
            pdfTextLines: [],
            ocrTextLines: ["Can you help?"],
            pdfOnly: [],
            ocrOnly: [{ text: "Can you help?", closest: "", similarity: 0 }]
          }]
        }
      ],
      visualReview: null
    }
  };
  const snapshot = buildPdfImportSnapshot({
    importId: "pdf-test",
    householdId: "household-test",
    title: "Test",
    rule: "pep-textbook",
    layout: {
      version: 2,
      pageCount: 1,
      pages: [{
        page: 1,
        width: 300,
        height: 400,
        items: [],
        overlays: [],
        lines: [{ id: "line-1", text: "Can you help?", x: 0, y: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, itemCount: 0, items: [] }],
        text: "Can you help?"
      }],
      stats: { pages: 1, items: 0, lines: 1, overlayAlternatives: 0 }
    } satisfies PdfLayout,
    structure: { units: [], frontMatter: [], stats: {} },
    chapters,
    quality,
    pageAssets: [{ id: "page-1", pageNumber: 1, url: "/page-1.png" }],
    extractedAt: "2026-07-14T00:00:00.000Z"
  });

  assert.equal(snapshot.layers.local.pages[0].blocks[0].text, "Can you help?");
  const upstreamProvider = snapshot.layers.upstream.providers[0] as {
    pages: Array<{ blocks: Array<{ text: string }> }>;
  };
  assert.equal(upstreamProvider.pages[0]?.blocks[0]?.text, "Can you help?");
  assert.equal(snapshot.layers.differences.total, 1);
  assert.equal(snapshot.layers.final.chapters, chapters);
  assert.equal(snapshot.layers.final.reviewStatus, "pending-review");
});

test("normalizes visual review findings into pending differences", () => {
  const differences = buildPdfImportDifferences({
    status: "review",
    engine: "multi-provider",
    pagesProcessed: 1,
    totalPages: 1,
    tokenAgreement: 0,
    reviewPages: [3],
    criticalPages: [],
    pages: [],
    providers: [],
    visualReview: {
      engine: "legacy-visual-review",
      status: "review",
      pages: [{ page: 3, missingLines: ["Missing sentence."], incorrectLines: [], readingOrderIssue: true, sectionIssue: false, notes: "Swap lines" }]
    }
  });
  assert.equal(differences.total, 2);
  assert.deepEqual(differences.pages, [3]);
  assert.ok(differences.items.every((item) => item.status === "pending"));
});

test("renders durable page image assets from an uploaded PDF", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 400]);
  page.drawText("Can you help?", { x: 30, y: 320, size: 20 });
  const buffer = Buffer.from(await document.save());
  const importDir = await fs.mkdtemp(path.join(os.tmpdir(), "kid-pdf-assets-"));
  try {
    const assets = await renderPdfPageAssets(buffer, { importDir, importId: "pdf-test", totalPages: 1, desiredWidth: 600 });
    assert.equal(assets.length, 1);
    assert.equal(assets[0].pageNumber, 1);
    assert.equal(assets[0].url, "/api/import/pdf/artifacts/pdf-test/pages/page-001.png");
    const image = await fs.readFile(path.join(importDir, "pages", "page-001.png"));
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally {
    await fs.rm(importDir, { recursive: true, force: true });
  }
});
