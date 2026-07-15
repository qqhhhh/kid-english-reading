import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAzureResult } from "../server/providers/azureSpeech.js";

test("normalizes Azure 0-100 metrics to the canonical score scales", () => {
  const result = normalizeAzureResult({
    DisplayText: "Can you help?",
    NBest: [
      {
        Display: "Can you help?",
        PronunciationAssessment: {
          AccuracyScore: 88,
          FluencyScore: 76,
          CompletenessScore: 67,
          PronScore: 81,
          ProsodyScore: 72
        },
        Words: [
          {
            Word: "can",
            Offset: 1_000_000,
            Duration: 2_000_000,
            PronunciationAssessment: { AccuracyScore: 92, ErrorType: "None" },
            Phonemes: [
              {
                Phoneme: "k",
                Offset: 1_000_000,
                Duration: 500_000,
                PronunciationAssessment: {
                  AccuracyScore: 95,
                  NBestPhonemes: [{ Phoneme: "k", Score: 98 }]
                }
              }
            ]
          },
          {
            Word: "you",
            Offset: 3_000_000,
            Duration: 1_000_000,
            PronunciationAssessment: { AccuracyScore: 0, ErrorType: "Omission" }
          },
          {
            Word: "please",
            Offset: 4_000_000,
            Duration: 1_000_000,
            PronunciationAssessment: { AccuracyScore: 40, ErrorType: "Insertion" }
          },
          {
            Word: "help",
            Offset: 5_000_000,
            Duration: 2_000_000,
            PronunciationAssessment: { AccuracyScore: 35, ErrorType: "Mispronunciation" }
          }
        ]
      }
    ]
  });

  assert.equal(result.SuggestedScore, 81);
  assert.equal(result.PronAccuracy, 88);
  assert.equal(result.PronFluency, 0.76);
  assert.equal(result.PronCompletion, 0.67);
  assert.deepEqual(result.Words.map((word) => word.MatchTag), [0, 2, 1, 3]);
  assert.equal(result.Words[2].ReferenceWord, "*");
  assert.equal(result.Words[0].MemBeginTime, 100);
  assert.equal(result.Words[0].MemEndTime, 300);
  assert.equal(result.Words[0].PhoneInfos[0].ReferencePhone, "k");
});

test("rejects Azure payloads without detailed pronunciation data", () => {
  assert.throws(() => normalizeAzureResult({ NBest: [] }), /did not include/);
});
