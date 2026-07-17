import assert from "node:assert/strict";
import test from "node:test";

import {
  attachLiveSpeechTestResult,
  recordLiveSpeechTestResult,
  waitForLiveSpeechResult
} from "../server/liveSpeech.js";

test("live speech final results attach only to their matching attempt identity", () => {
  const runId = `live-test-server-${Date.now()}`;
  const finalReceivedAt = Date.now();
  const comparison = recordLiveSpeechTestResult({
    runId,
    householdId: "household-live",
    childId: "child-live",
    sentenceId: "word-live",
    itemType: "word",
    result: {
      SuggestedScore: 88.5,
      PronAccuracy: 88.5,
      PronFluency: 0.91,
      PronCompletion: 1,
      Words: [{
        Word: "PE",
        ReferenceWord: "pe_0",
        PronAccuracy: 88.5,
        PronFluency: 0.91,
        MatchTag: 0,
        PhoneInfos: []
      }]
    },
    endRequestedAt: finalReceivedAt - 240,
    finalReceivedAt,
    interimCount: 2,
    audioBytes: 9_600,
    audioChunks: 3
  });

  assert.equal(comparison.evalMode, 7);
  assert.equal(comparison.finalLatencyMs, 240);
  assert.equal(comparison.suggestedScore, 88.5);
  assert.deepEqual(comparison.words[0], {
    word: "PE",
    referenceWord: "pe_0",
    accuracy: 88.5,
    matchTag: 0
  });

  assert.equal(attachLiveSpeechTestResult({
    runId,
    householdId: "household-live",
    childId: "another-child",
    sentenceId: "word-live",
    attemptId: "attempt-live"
  }), null);

  const attached = attachLiveSpeechTestResult({
    runId,
    householdId: "household-live",
    childId: "child-live",
    sentenceId: "word-live",
    attemptId: "attempt-live"
  });
  assert.equal(attached?.runId, runId);
  assert.equal(attached?.audioSource, "raw-stream");

  assert.equal(attachLiveSpeechTestResult({
    runId,
    householdId: "household-live",
    childId: "child-live",
    sentenceId: "word-live",
    attemptId: "different-attempt"
  }), null);
});

test("live speech primary wait reuses one final result and normalizes duplicate single-word branches", async () => {
  const runId = `live-test-primary-${Date.now()}`;
  const waiting = waitForLiveSpeechResult({
    runId,
    householdId: "household-primary",
    childId: "child-primary",
    sentenceId: "word-primary",
    attemptId: "attempt-primary"
  }, 500);

  recordLiveSpeechTestResult({
    runId,
    householdId: "household-primary",
    childId: "child-primary",
    sentenceId: "word-primary",
    itemType: "word",
    referenceText: "PE",
    audio: Buffer.alloc(96, 1),
    result: {
      SuggestedScore: 77.39,
      PronAccuracy: 77.39,
      PronFluency: 0.81,
      PronCompletion: 1,
      Words: [
        { Word: "pe", ReferenceWord: "pe", PronAccuracy: 82.49, PronFluency: 0.82, MatchTag: 0, PhoneInfos: [] },
        { Word: "pe", ReferenceWord: "pe", PronAccuracy: 72.3, PronFluency: 0.8, MatchTag: 0, PhoneInfos: [] }
      ]
    },
    endRequestedAt: Date.now() - 95,
    interimCount: 6,
    audioBytes: 116_054,
    audioChunks: 91
  });

  const primary = await waiting;
  assert.equal(primary?.comparison.suggestedScore, 77.39);
  assert.equal(primary?.comparison.words.length, 1);
  assert.equal(primary?.result.Words.length, 1);
  assert.equal(primary?.result.Words[0].PronAccuracy, 72.3);
  assert.equal(primary?.audio.length, 96);
});

test("paragraph live results use Tencent paragraph mode", () => {
  const comparison = recordLiveSpeechTestResult({
    runId: `live-test-paragraph-${Date.now()}`,
    householdId: "household-paragraph",
    childId: "child-paragraph",
    sentenceId: "reading-paragraph",
    itemType: "paragraph",
    referenceText: "This is a paragraph.",
    result: {
      SuggestedScore: 90,
      PronAccuracy: 90,
      PronFluency: 0.9,
      PronCompletion: 1,
      Words: [{ Word: "this", ReferenceWord: "this", PronAccuracy: 90, PronFluency: 0.9, MatchTag: 0, PhoneInfos: [] }]
    },
    endRequestedAt: Date.now() - 100,
    interimCount: 1,
    audioBytes: 12_800,
    audioChunks: 10
  });
  assert.equal(comparison.evalMode, 2);
});
