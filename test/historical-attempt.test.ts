import assert from "node:assert/strict";
import test from "node:test";

import { selectHistoricalAttempt } from "../src/lib/historicalAttempt.ts";

test("uses the latest failed attempt when no passed best exists", () => {
  assert.deepEqual(
    selectHistoricalAttempt({ sentenceId: "sentence-1", attempts: 1, passed: false, bestScore: 0, latestAttemptId: "failed-latest" }),
    { attemptId: "failed-latest", kind: "latest" }
  );
  assert.deepEqual(
    selectHistoricalAttempt({ sentenceId: "sentence-1", attempts: 2, passed: true, bestScore: 88, bestAttemptId: "passed-best", latestAttemptId: "failed-after-pass" }),
    { attemptId: "passed-best", kind: "best" }
  );
  assert.equal(selectHistoricalAttempt(undefined), null);
});
