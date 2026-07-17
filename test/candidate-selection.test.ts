import assert from "node:assert/strict";
import test from "node:test";
import { selectAttemptCandidate } from "../server/candidateSelection.js";
import type { AttemptCandidateLike } from "../server/types/scoring.js";

interface CandidateOptions {
  passed?: boolean;
  score?: number;
  accuracy?: number;
  completion?: number;
  severeIssues?: number;
}

function candidate(
  id: string,
  { passed = false, score = 70, accuracy = 70, completion = 0.8, severeIssues = 0 }: CandidateOptions = {}
): AttemptCandidateLike & { id: string } {
  return {
    id,
    gate: { passed, severeIssues, unscoredIssues: 0 },
    result: {
      SuggestedScore: score,
      PronAccuracy: accuracy,
      PronCompletion: completion
    }
  };
}

test("selects the latest complete contiguous candidate instead of a later full-session score", () => {
  const latestRestart = candidate("latest-restart", { passed: true, score: 82, accuracy: 84, completion: 1 });
  const fullSession = candidate("full-session", { passed: true, score: 96, accuracy: 96, completion: 1 });

  assert.equal(selectAttemptCandidate([latestRestart, fullSession])?.id, "latest-restart");
});

test("falls back to the full session when isolated speech segments are incomplete", () => {
  const lastHalf = candidate("last-half", { completion: 0.45 });
  const firstHalf = candidate("first-half", { completion: 0.55 });
  const fullSession = candidate("full-session", { passed: true, score: 88, accuracy: 90, completion: 1 });

  assert.equal(selectAttemptCandidate([lastHalf, firstHalf, fullSession])?.id, "full-session");
});

test("when nothing passes, returns the candidate with the clearest useful feedback", () => {
  const unrelatedSpeech = candidate("unrelated", { score: 18, accuracy: 15, completion: 0.6 });
  const incompleteReading = candidate("incomplete", { score: 68, accuracy: 78, completion: 0.88 });

  assert.equal(selectAttemptCandidate([unrelatedSpeech, incompleteReading])?.id, "incomplete");
});
