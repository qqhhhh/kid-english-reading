import assert from "node:assert/strict";
import test from "node:test";
import { getAssessmentRejection } from "../server/assessmentValidity.js";

test("rejects the captured silent-room regression instead of showing a pronunciation score", () => {
  const rejection = getAssessmentRejection({
    referenceText: "Can you help?",
    recordingQuality: { rms: 0.0043 },
    result: {
      SuggestedScore: 42.05,
      PronAccuracy: 75.69,
      PronCompletion: 1 / 3,
      Words: [
        { ReferenceWord: "can", MatchTag: 2 },
        { ReferenceWord: "you", MatchTag: 0 },
        { ReferenceWord: "help", MatchTag: 2 }
      ]
    },
    gate: { severeIssues: 2 }
  });

  assert.equal(rejection, "no-speech-detected");
});

test("does not reject a quiet but complete reading", () => {
  const rejection = getAssessmentRejection({
    referenceText: "Can you help?",
    recordingQuality: { rms: 0.0048 },
    result: {
      PronCompletion: 1,
      Words: [
        { ReferenceWord: "can", MatchTag: 0 },
        { ReferenceWord: "you", MatchTag: 0 },
        { ReferenceWord: "help", MatchTag: 0 }
      ]
    },
    gate: { severeIssues: 0 }
  });

  assert.equal(rejection, null);
});

test("does not relabel a clearly audible partial reading as silence", () => {
  const rejection = getAssessmentRejection({
    referenceText: "Can you help?",
    recordingQuality: { rms: 0.018 },
    result: {
      PronCompletion: 1 / 3,
      Words: [
        { ReferenceWord: "can", MatchTag: 0 },
        { ReferenceWord: "you", MatchTag: 2 },
        { ReferenceWord: "help", MatchTag: 2 }
      ]
    },
    gate: { severeIssues: 2 }
  });

  assert.equal(rejection, null);
});
