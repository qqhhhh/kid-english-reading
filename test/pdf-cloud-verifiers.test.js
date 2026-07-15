import assert from "node:assert/strict";
import test from "node:test";

import { describeOptionalProviderFailure, mergeVerificationAudits, optionalProviderErrorDetail } from "../server/pdfImportVerification.js";
import { normalizeXfyunOcrResponse } from "../server/providers/xfyunOcr.js";
import { createXfyunPdfOcrSignature, normalizeXfyunPdfOcrResult } from "../server/providers/xfyunPdfOcr.js";
import { buildSenseNovaReviewRequest, createSenseNovaToken, parseSenseNovaReviewResponse } from "../server/providers/sensenovaVision.js";
import { buildHunyuanOcrRequest, normalizeHunyuanOcrText, probeHunyuanOcr } from "../server/providers/hunyuanOcr.js";

function audit(overrides = {}) {
  return {
    status: "good",
    engine: "test",
    model: "test",
    totalPages: 2,
    pagesProcessed: 2,
    tokenAgreement: 100,
    reviewPages: [],
    criticalPages: [],
    pages: [],
    ...overrides
  };
}

test("normalizes XFYUN line and word confidence results", () => {
  const encoded = Buffer.from(JSON.stringify({
    version: "4.5",
    pages: [{
      lines: [{
        content: "Can you help?",
        conf: 0.98,
        coord: [{ x: 1, y: 2 }],
        words: [{ content: "Can", conf: 0.97, coord: [{ x: 1, y: 2 }] }]
      }]
    }]
  })).toString("base64");
  const result = normalizeXfyunOcrResponse({
    header: { code: 0 },
    payload: { ocr_output_text: { text: encoded } }
  });
  assert.equal(result.engineVersion, "4.5");
  assert.equal(result.confidence, 98);
  assert.equal(result.lines[0].words[0].confidence, 97);
  assert.equal(result.text, "Can you help?");
});

test("normalizes XFYUN PDF OCR layout lines and creates stable task signatures", () => {
  assert.equal(
    createXfyunPdfOcrSignature({ appId: "app", secret: "secret", timestamp: "123" }),
    createXfyunPdfOcrSignature({ appId: "app", secret: "secret", timestamp: "123" })
  );
  const [page] = normalizeXfyunPdfOcrResult({
    engine_version: "pdf-ocr-test",
    image: [{ content: [[{
      type: "textline",
      score: 0.97,
      coord: [{ x: 1, y: 2 }],
      content: [[{ type: "text_unit", text: "Can you help?" }]]
    }]] }]
  });
  assert.equal(page.engineVersion, "pdf-ocr-test");
  assert.equal(page.text, "Can you help?");
  assert.equal(page.lines[0].confidence, 97);
});

test("SenseNova review accepts fenced JSON and AK/SK creates a JWT", () => {
  const token = createSenseNovaToken({ accessKeyId: "ak", secretAccessKey: "sk" });
  assert.equal(token.split(".").length, 3);
  const review = parseSenseNovaReviewResponse("```json\n{\"page\":3,\"status\":\"review\",\"missing_lines\":[\"Hello\"],\"reading_order_issue\":true}\n```", 3);
  assert.equal(review.page, 3);
  assert.deepEqual(review.missingLines, ["Hello"]);
  assert.equal(review.readingOrderIssue, true);
});

test("SenseNova Token Plan uses the OpenAI-compatible vision payload", () => {
  const request = buildSenseNovaReviewRequest({
    image: Buffer.from("png"),
    prompt: "check",
    apiUrl: "https://token.sensenova.cn/v1/chat/completions",
    model: "sensenova-6.7-flash-lite"
  });
  assert.equal(request.max_tokens, 1200);
  assert.equal(request.max_new_tokens, undefined);
  assert.equal(request.messages[0].content[0].type, "text");
  assert.match(request.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(request.thinking, undefined);
});

test("HunyuanOCR uses a local OpenAI-compatible vision request and normalizes markdown", async () => {
  const request = buildHunyuanOcrRequest({ image: Buffer.from("png") });
  assert.equal(request.model, "HYVL");
  assert.equal(request.temperature, 0);
  assert.match(request.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  const normalized = normalizeHunyuanOcrText("# Listen and chant\n\n- Can you help?\n\nYes, I can.");
  assert.deepEqual(normalized.lines, ["Listen and chant", "Can you help?", "Yes, I can."]);

  const online = await probeHunyuanOcr({
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ok" }) })
  });
  assert.equal(online, true);
});

test("visual model warning requests review but does not become an automatic blocking warning", () => {
  const result = mergeVerificationAudits(audit(), [], {
    status: "warning",
    engine: "sensenova-vision",
    pagesProcessed: 1,
    totalPages: 2,
    pages: []
  });
  assert.equal(result.status, "review");
});

test("advisory HunyuanOCR findings request review without becoming publication blockers", () => {
  const result = mergeVerificationAudits(audit(), [audit({
    engine: "hunyuan-ocr-local",
    advisory: true,
    status: "warning",
    reviewPages: [2],
    criticalPages: [2]
  })]);
  assert.equal(result.status, "review");
  assert.deepEqual(result.reviewPages, [2]);
  assert.deepEqual(result.criticalPages, []);
  assert.equal(result.providers[1].advisory, true);
});

test("an independent deterministic OCR missing-text result blocks publication", () => {
  const result = mergeVerificationAudits(audit(), [audit({
    engine: "xfyun",
    status: "warning",
    criticalPages: [2]
  })]);
  assert.equal(result.status, "warning");
  assert.deepEqual(result.criticalPages, [2]);
  assert.equal(result.providers.length, 2);
});

test("paid cloud verification failures are friendly and explicitly non-blocking", () => {
  const message = describeOptionalProviderFailure("讯飞云校验", new Error("10003: insufficient balance"));
  assert.match(message, /额度不足/);
  assert.match(message, /可以继续/);
  assert.equal(optionalProviderErrorDetail(new Error("  code 10003\ninsufficient balance  ")), "code 10003 insufficient balance");
});
