import assert from "node:assert/strict";
import test from "node:test";

import { getAutomaticRecordingStopDelayMs } from "../shared/recordingStopPolicy.js";

test("word practice adds no delay after VAD confirms the child finished", () => {
  assert.equal(
    getAutomaticRecordingStopDelayMs({
      isWordItem: true,
      segments: [{ voiceDurationMs: 180 }],
      expectedVoiceDurationMs: 520
    }),
    0
  );
});

test("a restarted word segment also stops without a second debounce", () => {
  assert.equal(
    getAutomaticRecordingStopDelayMs({
      isWordItem: true,
      segments: [{ voiceDurationMs: 180 }, { voiceDurationMs: 360 }],
      expectedVoiceDurationMs: 520
    }),
    0
  );
});

test("sentence practice keeps the conservative completion thresholds", () => {
  assert.equal(
    getAutomaticRecordingStopDelayMs({
      isWordItem: false,
      segments: [{ voiceDurationMs: 400 }],
      expectedVoiceDurationMs: 1000
    }),
    2400
  );
  assert.equal(
    getAutomaticRecordingStopDelayMs({
      isWordItem: false,
      segments: [{ voiceDurationMs: 800 }],
      expectedVoiceDurationMs: 1000
    }),
    1100
  );
});
