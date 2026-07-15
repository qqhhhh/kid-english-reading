import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePass } from "../server/passGate.js";

function assessment(overrides = {}) {
  return {
    SuggestedScore: 90,
    PronAccuracy: 90,
    PronFluency: 0.9,
    PronCompletion: 1,
    Words: [
      { ReferenceWord: "Yes", PronAccuracy: 92, MatchTag: 0 },
      { ReferenceWord: "I", PronAccuracy: 90, MatchTag: 0 },
      { ReferenceWord: "can", PronAccuracy: 88, MatchTag: 0 }
    ],
    ...overrides
  };
}

test("unrelated continuous speech does not pass because accuracy and completion are low", () => {
  const gate = evaluatePass(
    assessment({ SuggestedScore: 12.8, PronAccuracy: 14.9, PronFluency: 0.842, PronCompletion: 0.625 }),
    75
  );

  assert.equal(gate.passed, false);
});

test("a high average score cannot hide one very inaccurate required word", () => {
  const gate = evaluatePass(
    assessment({
      SuggestedScore: 84.2,
      PronAccuracy: 84.2,
      PronCompletion: 1,
      Words: [
        { ReferenceWord: "Yes", PronAccuracy: 94.8, MatchTag: 0 },
        { ReferenceWord: "clean", PronAccuracy: 33.8, MatchTag: 0 },
        { ReferenceWord: "room", PronAccuracy: 92.1, MatchTag: 0 }
      ]
    }),
    75
  );

  assert.equal(gate.passed, false);
  assert.equal(gate.lowAccuracyIssues, 1);
  assert.equal(gate.minWordAccuracy, 33.8);
});

test("a complete clear reading passes", () => {
  assert.equal(evaluatePass(assessment(), 75).passed, true);
});

test("any missed, misread, or unscored word blocks the sentence", () => {
  for (const tag of [2, 3, 4]) {
    const gate = evaluatePass(
      assessment({ Words: [{ ReferenceWord: "can", PronAccuracy: 92, MatchTag: tag }] }),
      75
    );
    assert.equal(gate.passed, false);
  }
});

test("one alignment extra is tolerated but multiple extra words are rejected", () => {
  const oneExtra = assessment({
    Words: [...assessment().Words, { ReferenceWord: "*", PronAccuracy: 0, MatchTag: 1 }]
  });
  const twoExtras = assessment({
    Words: [
      ...assessment().Words,
      { ReferenceWord: "*", PronAccuracy: 0, MatchTag: 1 },
      { ReferenceWord: "*", PronAccuracy: 0, MatchTag: 1 }
    ]
  });

  assert.equal(evaluatePass(oneExtra, 75).passed, true);
  assert.equal(evaluatePass(twoExtras, 75).passed, false);
});
