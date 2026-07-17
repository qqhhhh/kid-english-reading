import assert from "node:assert/strict";
import test from "node:test";

import { describeOptionalProviderFailure, mergeVerificationAudits, optionalProviderErrorDetail } from "../server/pdfImportVerification.js";
import { normalizeXfyunOcrResponse } from "../server/providers/xfyunOcr.js";
import { buildHunyuanOcrRequest, normalizeHunyuanOcrText, probeHunyuanOcr } from "../server/providers/hunyuanOcr.js";
import { probePaddleOcr, recognizeImageWithPaddle } from "../server/providers/paddleOcr.js";
import type { FetchResponseLike } from "../server/types/ocr.js";
import type { OcrAudit } from "../server/types/pdf.js";

function audit(overrides: Partial<OcrAudit> = {}): OcrAudit {
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

function fetchResponse(body: unknown): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body
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
  assert.equal(result.lines[0]?.words?.[0]?.confidence, 97);
  assert.equal(result.text, "Can you help?");
});

test("HunyuanOCR uses a local OpenAI-compatible vision request and normalizes markdown", async () => {
  const request = buildHunyuanOcrRequest({ image: Buffer.from("png") });
  assert.equal(request.model, "HYVL");
  assert.equal(request.temperature, 0);
  const imageContent = request.messages[0]?.content[1];
  assert.equal(imageContent?.type, "image_url");
  if (!imageContent || imageContent.type !== "image_url") assert.fail("Expected an image request part.");
  assert.match(imageContent.image_url.url, /^data:image\/png;base64,/);
  const normalized = normalizeHunyuanOcrText("# Listen and chant\n\n- Can you help?\n\nYes, I can.");
  assert.deepEqual(normalized.lines, ["Listen and chant", "Can you help?", "Yes, I can."]);

  const online = await probeHunyuanOcr({
    fetchImpl: async () => fetchResponse({ status: "ok" })
  });
  assert.equal(online, true);
});

test("PaddleOCR probes its local service and preserves line coordinates", async () => {
  const online = await probePaddleOcr({
    fetchImpl: async () => fetchResponse({ status: "ok", engine: "paddleocr" })
  });
  assert.equal(online, true);

  const recognized = await recognizeImageWithPaddle(Buffer.from("png"), {
    fetchImpl: async (_url, request) => {
      assert.equal(request?.method, "POST");
      assert.equal((JSON.parse(String(request?.body)) as { image: string }).image, Buffer.from("png").toString("base64"));
      return fetchResponse({
        durationMs: 712,
        lines: [{ text: "That's for sure!", confidence: 0.99, box: [1, 2, 3, 4], wordBoxes: [[1, 2, 3, 4]] }]
      });
    }
  });
  assert.equal(recognized.text, "That's for sure!");
  assert.equal(recognized.durationMs, 712);
  assert.deepEqual(recognized.details[0].box, [1, 2, 3, 4]);
});

test("visual model warning requests review but does not become an automatic blocking warning", () => {
  const result = mergeVerificationAudits(audit(), [], {
    status: "warning",
    engine: "legacy-visual-review",
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
  assert.equal(result.providers?.[1]?.advisory, true);
});

test("advisory PaddleOCR findings request review without becoming publication blockers", () => {
  const result = mergeVerificationAudits(audit(), [audit({
    engine: "paddle-ocr-local",
    advisory: true,
    status: "warning",
    reviewPages: [2],
    criticalPages: [2]
  })]);
  assert.equal(result.status, "review");
  assert.deepEqual(result.reviewPages, [2]);
  assert.deepEqual(result.criticalPages, []);
});

test("an independent deterministic OCR missing-text result blocks publication", () => {
  const result = mergeVerificationAudits(audit(), [audit({
    engine: "xfyun",
    status: "warning",
    criticalPages: [2]
  })]);
  assert.equal(result.status, "warning");
  assert.deepEqual(result.criticalPages, [2]);
  assert.equal(result.providers?.length, 2);
});

test("paid cloud verification failures are friendly and explicitly non-blocking", () => {
  const message = describeOptionalProviderFailure("讯飞云校验", new Error("10003: insufficient balance"));
  assert.match(message, /额度不足/);
  assert.match(message, /可以继续/);
  assert.equal(optionalProviderErrorDetail(new Error("  code 10003\ninsufficient balance  ")), "code 10003 insufficient balance");
});
