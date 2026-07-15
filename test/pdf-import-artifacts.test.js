import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { buildPdfImportDifferences, buildPdfImportSnapshot, renderPdfPageAssets } from "../server/pdfImportArtifacts.js";

const chapters = [{ id: "unit-1", title: "Unit 1", text: "Can you help?", sentences: [{ id: "s1", text: "Can you help?" }] }];

test("keeps local, upstream, differences and final PDF import layers separate", () => {
  const quality = {
    status: "review",
    ocr: {
      providers: [
        { engine: "tesseract.js-eng", status: "good", pagesProcessed: 1, totalPages: 1, pages: [] },
        {
          engine: "xfyun-pdf-ocr",
          model: "test",
          status: "review",
          pagesProcessed: 1,
          totalPages: 1,
          pages: [{ page: 1, confidence: 96, tokenAgreement: 80, needsReview: true, ocrTextLines: ["Can you help?"], pdfOnly: [], ocrOnly: [{ text: "Can you help?", closest: "", similarity: 0 }] }]
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
    layout: { pages: [{ page: 1, lines: [{ text: "Can you help?" }] }] },
    structure: { units: [], frontMatter: [], stats: {} },
    chapters,
    quality,
    pageAssets: [{ id: "page-1", pageNumber: 1, url: "/page-1.png" }],
    extractedAt: "2026-07-14T00:00:00.000Z"
  });

  assert.equal(snapshot.layers.local.pages[0].blocks[0].text, "Can you help?");
  assert.equal(snapshot.layers.upstream.providers[0].pages[0].blocks[0].text, "Can you help?");
  assert.equal(snapshot.layers.differences.total, 1);
  assert.equal(snapshot.layers.final.chapters, chapters);
  assert.equal(snapshot.layers.final.reviewStatus, "pending-review");
});

test("normalizes visual review findings into pending differences", () => {
  const differences = buildPdfImportDifferences({
    providers: [],
    visualReview: {
      engine: "sensenova-vision",
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
