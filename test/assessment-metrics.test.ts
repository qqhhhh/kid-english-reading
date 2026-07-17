import assert from "node:assert/strict";
import test from "node:test";
import { getEffectiveFluency, getRequiredWordScore, getWordAccuracyMetrics } from "../shared/assessmentMetrics.js";

test("word precision assigns zero to missed and misread required words", () => {
  assert.equal(getRequiredWordScore({ MatchTag: 2, PronAccuracy: -1 }), 0);
  assert.equal(getRequiredWordScore({ MatchTag: 3, PronAccuracy: 85 }), 0);
  assert.equal(getRequiredWordScore({ MatchTag: 0, PronAccuracy: 82.4 }), 82.4);
});

test("breaks precision down across every required word", () => {
  const metrics = getWordAccuracyMetrics({
    PronFluency: 0.85,
    PronCompletion: 1 / 3,
    Words: [
      { MatchTag: 2, PronAccuracy: -1 },
      { MatchTag: 0, PronAccuracy: 76 },
      { MatchTag: 2, PronAccuracy: -1 }
    ]
  });

  assert.deepEqual(metrics, {
    totalCount: 3,
    clearCount: 1,
    averageAccuracy: 25.3,
    weakestAccuracy: 0,
    allWordAccuracy: 17.7
  });
});

test("effective fluency cannot stay high when words are missing", () => {
  const effectiveFluency = getEffectiveFluency({
    PronFluency: 0.85,
    PronCompletion: 1 / 3,
    Words: [
      { MatchTag: 2, PronAccuracy: -1 },
      { MatchTag: 0, PronAccuracy: 76 },
      { MatchTag: 2, PronAccuracy: -1 }
    ]
  });

  assert.equal(effectiveFluency, 5.9);
});

test("effective fluency remains intuitive for a complete accurate reading", () => {
  const effectiveFluency = getEffectiveFluency({
    PronFluency: 0.92,
    PronCompletion: 1,
    Words: [
      { MatchTag: 0, PronAccuracy: 94 },
      { MatchTag: 0, PronAccuracy: 88 },
      { MatchTag: 0, PronAccuracy: 91 }
    ]
  });

  assert.equal(effectiveFluency, 90.1);
});
