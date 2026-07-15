import assert from "node:assert/strict";
import test from "node:test";

import { withTencentNoAudioRetry } from "../server/providers/tencentSpeech.js";

test("retries Tencent no-audio timeout once", async () => {
  const attempts = [];
  const result = await withTencentNoAudioRetry((attempt) => {
    attempts.push(attempt);
    if (attempt === 1) {
      const error = new Error("Tencent speech error 4008");
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
    withTencentNoAudioRetry(() => {
      calls += 1;
      const error = new Error("Tencent speech error 4012");
      error.providerCode = 4012;
      throw error;
    }, 0),
    /4012/
  );
  assert.equal(calls, 1);
});
