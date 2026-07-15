import assert from "node:assert/strict";
import test from "node:test";

import { comparePdfAndOcrPage } from "../server/pdfOcrAudit.js";

function layoutPage(lines) {
  return {
    page: 1,
    lines: lines.map((text, index) => ({ id: `line-${index + 1}`, text }))
  };
}

test("OCR audit accepts matching PDF and image text despite punctuation differences", () => {
  const result = comparePdfAndOcrPage({
    pageNumber: 1,
    confidence: 91,
    ocrText: "Can you help\nYes, I can help!",
    layoutPage: layoutPage(["Can you help?", "Yes, I can help!"])
  });

  assert.equal(result.missingTextLayer, false);
  assert.equal(result.needsReview, false);
  assert.equal(result.tokenAgreement, 100);
  assert.deepEqual(result.ocrOnly, []);
});

test("OCR audit identifies English visible in the image but absent from the PDF text layer", () => {
  const result = comparePdfAndOcrPage({
    pageNumber: 7,
    confidence: 88,
    ocrText: "This sentence only exists in the page image.",
    layoutPage: layoutPage([])
  });

  assert.equal(result.missingTextLayer, true);
  assert.equal(result.needsReview, true);
  assert.equal(result.ocrOnly.length, 1);
});

test("OCR audit does not treat low-confidence OCR noise as a missing text layer", () => {
  const result = comparePdfAndOcrPage({
    pageNumber: 3,
    confidence: 31,
    ocrText: "random visual noise words here",
    layoutPage: layoutPage([])
  });

  assert.equal(result.missingTextLayer, false);
  assert.equal(result.needsReview, false);
});
