import assert from "node:assert/strict";
import test from "node:test";

import { getLiveSpeechTestFinalResult, getLiveSpeechTestScoreDelta } from "../shared/liveSpeechPilot.js";

test("streaming test never treats an interim assessment as the final result", () => {
  assert.equal(getLiveSpeechTestFinalResult({
    final: false,
    suggestedScore: 99,
    completion: 1,
    wordCount: 1,
    endRequestedAtMs: 1000,
    receivedAtMs: 1100
  }), null);
});

test("streaming test records only the result returned after the end signal", () => {
  assert.deepEqual(getLiveSpeechTestFinalResult({
    final: true,
    suggestedScore: 83.5,
    completion: 1,
    wordCount: 1,
    endRequestedAtMs: 1000,
    receivedAtMs: 1260
  }), {
    suggestedScore: 83.5,
    completionPercent: 100,
    wordCount: 1,
    finalLatencyMs: 260
  });
});

test("streaming test compares its final score with the complete WAV score", () => {
  assert.equal(getLiveSpeechTestScoreDelta(82, 86), 4);
  assert.equal(getLiveSpeechTestScoreDelta(undefined, 86), undefined);
});
