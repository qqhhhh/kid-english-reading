import assert from "node:assert/strict";
import test from "node:test";

import { buildTencentUrl, withTencentNoAudioRetry } from "../server/providers/tencentSpeech.js";

interface ProviderError extends Error {
  providerCode: number;
}

test("retries Tencent no-audio timeout once", async () => {
  const attempts: number[] = [];
  const result = await withTencentNoAudioRetry(async (attempt) => {
    attempts.push(attempt);
    if (attempt === 1) {
      const error = new Error("Tencent speech error 4008") as ProviderError;
      error.providerCode = 4008;
      throw error;
    }
    return "ok";
  }, 0);

  assert.equal(result, "ok");
  assert.deepEqual(attempts, [1, 2]);
});

test("does not retry unrelated Tencent errors", async () => {
  let calls = 0;
  await assert.rejects(
    withTencentNoAudioRetry(async () => {
      calls += 1;
      const error = new Error("Tencent speech error 4012") as ProviderError;
      error.providerCode = 4012;
      throw error;
    }, 0),
    /4012/
  );
  assert.equal(calls, 1);
});

test("builds Tencent word modes without changing sentence batch defaults", () => {
  const previous = {
    appId: process.env.TENCENT_APP_ID,
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY
  };
  process.env.TENCENT_APP_ID = "app";
  process.env.TENCENT_SECRET_ID = "secret-id";
  process.env.TENCENT_SECRET_KEY = "secret-key";
  const streaming = new URL(buildTencentUrl({ referenceText: "apple", streaming: true, itemType: "word" }));
  assert.equal(streaming.searchParams.get("rec_mode"), "0");
  assert.equal(streaming.searchParams.get("eval_mode"), "7");
  assert.equal(streaming.searchParams.get("sentence_info_enabled"), "1");
  const wordBatch = new URL(buildTencentUrl({ referenceText: "apple", itemType: "word" }));
  assert.equal(wordBatch.searchParams.get("rec_mode"), "1");
  assert.equal(wordBatch.searchParams.get("eval_mode"), "0");
  assert.equal(wordBatch.searchParams.get("sentence_info_enabled"), "0");
  const batch = new URL(buildTencentUrl({ referenceText: "Read this sentence." }));
  assert.equal(batch.searchParams.get("rec_mode"), "1");
  assert.equal(batch.searchParams.get("eval_mode"), "1");
  assert.equal(batch.searchParams.get("sentence_info_enabled"), "0");
  const paragraph = new URL(buildTencentUrl({
    referenceText: "This is a longer reading paragraph.",
    streaming: true,
    itemType: "paragraph"
  }));
  assert.equal(paragraph.searchParams.get("rec_mode"), "0");
  assert.equal(paragraph.searchParams.get("eval_mode"), "2");
  if (previous.appId === undefined) delete process.env.TENCENT_APP_ID;
  else process.env.TENCENT_APP_ID = previous.appId;
  if (previous.secretId === undefined) delete process.env.TENCENT_SECRET_ID;
  else process.env.TENCENT_SECRET_ID = previous.secretId;
  if (previous.secretKey === undefined) delete process.env.TENCENT_SECRET_KEY;
  else process.env.TENCENT_SECRET_KEY = previous.secretKey;
});
