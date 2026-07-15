import assert from "node:assert/strict";
import test from "node:test";

import { selectHistoricalAttempt } from "../src/lib/historicalAttempt.ts";

test("uses the latest failed attempt when no passed best exists", () => {
  assert.deepEqual(
    selectHistoricalAttempt({ latestAttemptId: "failed-latest" }),
    { attemptId: "failed-latest", kind: "latest" }
  );
  assert.deepEqual(
    selectHistoricalAttempt({ bestAttemptId: "passed-best", latestAttemptId: "failed-after-pass" }),
    { attemptId: "passed-best", kind: "best" }
  );
  assert.equal(selectHistoricalAttempt(undefined), null);
});
