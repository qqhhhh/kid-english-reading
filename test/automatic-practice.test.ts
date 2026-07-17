import test from "node:test";
import assert from "node:assert/strict";
import { decideAutomaticRecordingFailure, decideAutomaticScoreOutcome } from "../shared/automaticPractice.js";

test("passed required content advances and resets automatic counters", () => {
  assert.deepEqual(
    decideAutomaticScoreOutcome({ passed: true, required: true, suggestedScore: 90, hasNext: true, failedCount: 2 }),
    { action: "next", failedCount: 0, noSpeechCount: 0 }
  );
});

test("a non-zero optional score advances without blocking", () => {
  assert.equal(
    decideAutomaticScoreOutcome({ passed: false, required: false, suggestedScore: 45, hasNext: true, failedCount: 0 }).action,
    "next"
  );
});

test("a zero-score optional word pauses instead of being skipped", () => {
  assert.equal(
    decideAutomaticScoreOutcome({ passed: false, required: false, suggestedScore: 0, hasNext: true, failedCount: 0 }).action,
    "pause-failed"
  );
});

test("required content pauses after the first scored failure", () => {
  assert.deepEqual(
    decideAutomaticScoreOutcome({ passed: false, required: true, suggestedScore: 60, hasNext: true, failedCount: 0 }),
    { action: "pause-failed", failedCount: 1, noSpeechCount: 0 }
  );
});

test("course completion is distinct from advancing", () => {
  assert.equal(
    decideAutomaticScoreOutcome({ passed: true, required: true, suggestedScore: 90, hasNext: false, failedCount: 0 }).action,
    "complete"
  );
});

test("three consecutive unusable recordings stop automatic practice", () => {
  assert.deepEqual(decideAutomaticRecordingFailure({ kind: "no-speech", noSpeechCount: 2 }), {
    action: "stop-no-speech",
    noSpeechCount: 3
  });
});

test("capture interruption stops immediately without consuming silence count", () => {
  assert.deepEqual(decideAutomaticRecordingFailure({ kind: "capture-gap", noSpeechCount: 1 }), {
    action: "stop-interrupted",
    noSpeechCount: 1
  });
});
