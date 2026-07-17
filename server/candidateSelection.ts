import type { AttemptCandidateLike } from "./types/scoring.js";

export function selectAttemptCandidate<T extends AttemptCandidateLike>(candidates: readonly T[]): T | undefined {
  const passedCandidate = candidates.find((candidate) => candidate.gate.passed);
  if (passedCandidate) return passedCandidate;

  return [...candidates].sort((left, right) => getCandidateFeedbackRank(right) - getCandidateFeedbackRank(left))[0];
}

export function getCandidateFeedbackRank(candidate: AttemptCandidateLike): number {
  const result = candidate.result;
  const gate = candidate.gate;
  return (
    Number(result.PronCompletion || 0) * 45 +
    Number(result.PronAccuracy || 0) * 0.35 +
    Number(result.SuggestedScore || 0) * 0.2 -
    Number(gate.severeIssues || 0) * 12 -
    Number(gate.unscoredIssues || 0) * 8
  );
}
