import assert from "node:assert/strict";
import test from "node:test";
import { applyScorePolicy, getPolicyScore, hasValidPassedScore, selectBestPassedAttempt } from "../server/scoringPolicy.js";

test("any missed word forces the displayed and stored total score to zero", () => {
  const result = applyScorePolicy({
    SuggestedScore: 83,
    Words: [
      { ReferenceWord: "can", MatchTag: 0 },
      { ReferenceWord: "you", MatchTag: 0 },
      { ReferenceWord: "help", MatchTag: 2 }
    ]
  });

  assert.equal(result.SuggestedScore, 0);
  assert.equal(result.ProviderSuggestedScore, 83);
  assert.equal(result.ScorePolicy, "zero-on-missed-word");
});

test("a misread word still fails the gate but does not use the missing-word zero rule", () => {
  const result = applyScorePolicy({
    SuggestedScore: 62,
    Words: [{ ReferenceWord: "help", MatchTag: 3 }]
  });

  assert.equal(result.SuggestedScore, 62);
  assert.equal(result.ProviderSuggestedScore, 62);
  assert.equal(result.ScorePolicy, undefined);
});

test("historical failed or missing-word attempts do not contribute a best score", () => {
  const attempt = {
    passed: true,
    result: { SuggestedScore: 83, Words: [{ ReferenceWord: "help", MatchTag: 2 }] }
  };

  assert.equal(getPolicyScore(attempt.result), 0);
  assert.equal(hasValidPassedScore(attempt), false);
});

test("forced-aligned low scoring suffix words are inferred as missed", () => {
  const result = applyScorePolicy({
    SuggestedScore: 49.96,
    PronCompletion: 1,
    Words: [
      { ReferenceWord: "can", PronAccuracy: 89.54, MatchTag: 0 },
      { ReferenceWord: "you", PronAccuracy: 41.48, MatchTag: 0 },
      { ReferenceWord: "help", PronAccuracy: 24.51, MatchTag: 0 }
    ]
  });

  assert.equal(result.SuggestedScore, 0);
  assert.equal(result.ProviderSuggestedScore, 49.96);
  assert.equal(result.PronCompletion, 0.333);
  assert.equal(result.ProviderPronCompletion, 1);
  assert.deepEqual(
    result.Words.map((word) => ({ tag: word.MatchTag, inference: word.MatchInference })),
    [
      { tag: 0, inference: undefined },
      { tag: 2, inference: "low-accuracy-as-missed" },
      { tag: 2, inference: "low-accuracy-as-missed" }
    ]
  );
});

test("low scoring words inside a complete sentence stay unclear instead of becoming missed", () => {
  const result = applyScorePolicy({
    SuggestedScore: 76.29,
    PronCompletion: 1,
    Words: [
      { ReferenceWord: "mum", PronAccuracy: 77, MatchTag: 0 },
      { ReferenceWord: "are", PronAccuracy: 23.5, MatchTag: 0 },
      { ReferenceWord: "busy", PronAccuracy: 23.8, MatchTag: 0 },
      { ReferenceWord: "what", PronAccuracy: 98, MatchTag: 0 }
    ]
  });

  assert.equal(result.SuggestedScore, 76.29);
  assert.equal(result.PronCompletion, 1);
  assert.deepEqual(result.Words.map((word) => word.MatchTag), [0, 0, 0, 0]);
  assert.equal(result.ScorePolicy, undefined);
});

test("best attempt selection keeps the highest valid score and uses the latest on a tie", () => {
  const attempts = [
    { id: "failed-high", passed: false, result: { SuggestedScore: 98, Words: [] } },
    { id: "valid-79-old", passed: true, result: { SuggestedScore: 79, Words: [] } },
    { id: "valid-76", passed: true, result: { SuggestedScore: 76, Words: [] } },
    { id: "valid-79-new", passed: true, result: { SuggestedScore: 79, Words: [] } }
  ];

  assert.equal(selectBestPassedAttempt(attempts)?.id, "valid-79-new");
});
