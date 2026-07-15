import assert from "node:assert/strict";
import test from "node:test";

import { assessPdfImportQuality, getPdfPublicationBlockers } from "../server/pdfImportQuality.js";

function makeChapter(sentences) {
  return {
    id: "chapter-1",
    title: "Unit 1",
    sections: [
      {
        id: "section-1",
        title: "Let's talk",
        sentences
      }
    ],
    sentences
  };
}

test("PDF quality report leaves clean imported dialogue alone", () => {
  const report = assessPdfImportQuality([
    makeChapter([
      { id: "sentence-1", text: "Can you help?" },
      { id: "sentence-2", text: "Yes, I can help." }
    ])
  ]);

  assert.equal(report.status, "good");
  assert.equal(report.totalSentences, 2);
  assert.equal(report.cleanSentences, 2);
  assert.deepEqual(report.issues, []);
});

test("PDF quality report treats imported vocabulary as valid practice items", () => {
  const vocabulary = [
    { id: "word-1", text: "doctor" },
    { id: "word-2", text: "office worker" }
  ];
  const report = assessPdfImportQuality([
    {
      id: "chapter-1",
      title: "Unit 1",
      sections: [
        {
          id: "words-1",
          title: "Words",
          type: "vocabulary",
          partKind: "vocabulary",
          sentences: vocabulary
        }
      ],
      sentences: vocabulary
    }
  ]);

  assert.equal(report.status, "good");
  assert.equal(report.totalSentences, 2);
  assert.deepEqual(report.issues, []);
});

test("PDF quality report finds fragments, punctuation, long and short sentences with locations", () => {
  const report = assessPdfImportQuality([
    makeChapter([
      { id: "sentence-1", text: "No, it isn" },
      { id: "sentence-2", text: "We can read this unusually long imported sentence with far too many words because two different dialogue bubbles may have been merged together by the PDF layout engine." },
      { id: "sentence-3", text: "Really?" },
      { id: "sentence-4", text: "That sounds fun！！" }
    ])
  ]);

  assert.equal(report.status, "warning");
  assert.equal(report.totalSentences, 4);
  assert.equal(report.issueSentences, 4);
  assert.ok(report.issues.some((issue) => issue.code === "dangling-fragment" && issue.severity === "high"));
  assert.ok(report.issues.some((issue) => issue.code === "missing-punctuation" && issue.sentenceId === "sentence-1"));
  assert.ok(report.issues.some((issue) => issue.code === "long-sentence" && issue.sentenceId === "sentence-2"));
  assert.ok(report.issues.some((issue) => issue.code === "short-sentence" && issue.sentenceId === "sentence-3"));
  assert.ok(report.issues.some((issue) => issue.code === "repeated-punctuation" && issue.sentenceId === "sentence-4"));
  assert.equal(report.issues[0].chapterTitle, "Unit 1");
  assert.equal(report.issues[0].sectionTitle, "Let's talk");
});

test("PDF quality report cross-checks source coverage and imported structure", () => {
  const sentence = { id: "sentence-1", text: "Can you help?" };
  const chapters = [makeChapter([sentence])];
  const structure = {
    toc: [{ unitNumber: 1, title: "Unit 1" }],
    units: [
      {
        title: "Unit 1 Helping at home",
        pageStart: 5,
        pageEnd: 5,
        sections: [
          {
            title: "Let's talk",
            blocks: [
              {
                text: "Can you help?",
                page: 5,
                candidate: true,
                layout: { page: 5, lineIds: ["line-2"] }
              }
            ]
          }
        ]
      }
    ]
  };
  const layout = {
    pages: [
      {
        page: 4,
        lines: [{ id: "line-1", text: "Contents", items: [] }]
      },
      {
        page: 5,
        lines: [
          { id: "line-1", text: "Let's talk", items: [] },
          { id: "line-2", text: "Can you help?", items: [] },
          { id: "line-3", text: "This sentence was not imported.", items: [], x: 40, top: 120 }
        ]
      }
    ]
  };

  const report = assessPdfImportQuality(chapters, { layout, structure });

  assert.equal(report.coverage.classifiedLines, 2);
  assert.equal(report.coverage.unclassifiedLines, 1);
  assert.equal(report.coverage.pages.some((page) => page.page === 4), false);
  assert.deepEqual(report.coverage.pages[0].unclassified.map((line) => line.text), ["This sentence was not imported."]);
  assert.equal(report.consistency.checks.every((check) => check.passed), true);
});

test("PDF quality report flags structural count mismatches", () => {
  const chapters = [makeChapter([{ id: "sentence-1", text: "Can you help?" }])];
  const structure = {
    toc: [
      { unitNumber: 1, title: "Unit 1" },
      { unitNumber: 2, title: "Unit 2" }
    ],
    units: [
      {
        title: "Unit 1",
        sections: [
          {
            title: "Words",
            partKind: "vocabulary",
            activityKey: "vocabulary",
            blocks: [{ text: "doctor", candidate: true }]
          }
        ]
      }
    ]
  };

  const report = assessPdfImportQuality(chapters, { structure });

  assert.equal(report.status, "warning");
  assert.equal(report.consistency.checks.find((check) => check.code === "unit-count").passed, false);
  assert.equal(report.consistency.checks.find((check) => check.code === "vocabulary-count").passed, false);
});

test("PDF quality report carries the independent OCR audit into the publication gate", () => {
  const chapters = [makeChapter([{ id: "sentence-1", text: "Can you help?" }])];
  const ocr = {
    status: "warning",
    engine: "tesseract.js-eng",
    pagesProcessed: 1,
    totalPages: 1,
    tokenAgreement: 0,
    reviewPages: [1],
    criticalPages: [1],
    pages: []
  };

  const report = assessPdfImportQuality(chapters, { ocr });

  assert.equal(report.status, "warning");
  assert.equal(report.ocr, ocr);
});

test("a completed OCR conflict marks otherwise clean content for review without blocking it", () => {
  const chapters = [makeChapter([{ id: "sentence-1", text: "Can you help?" }])];
  const report = assessPdfImportQuality(chapters, {
    ocr: {
      status: "review",
      engine: "tesseract.js-eng",
      pagesProcessed: 1,
      totalPages: 1,
      tokenAgreement: 72,
      reviewPages: [1],
      criticalPages: [],
      pages: []
    }
  });

  assert.equal(report.status, "review");
});

test("publication blocks real high-risk findings but allows coverage review warnings", () => {
  const reviewOnly = {
    status: "warning",
    counts: { high: 0, medium: 3, low: 5 },
    coverage: { percent: 67, lowConfidencePages: [7] },
    consistency: { checks: [{ passed: true }] },
    ocr: { status: "review", truncated: false, criticalPages: [], providers: [{ engine: "tesseract.js-eng", status: "good" }] }
  };
  assert.deepEqual(getPdfPublicationBlockers(reviewOnly), []);
  assert.deepEqual(
    getPdfPublicationBlockers({ ...reviewOnly, ocr: { ...reviewOnly.ocr, criticalPages: [12] } }),
    ["ocr-critical-pages"]
  );
});
