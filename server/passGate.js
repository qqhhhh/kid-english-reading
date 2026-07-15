import { minimumEffectiveWordAccuracy } from "./scoringPolicy.js";

export const passGateThresholds = Object.freeze({
  minAccuracy: 70,
  minCompletion: 0.95,
  minRequiredWordAccuracy: minimumEffectiveWordAccuracy,
  maxExtraIssues: 1
});

export function evaluatePass(result, minScore) {
  const words = Array.isArray(result?.Words) ? result.Words : [];
  const severeIssues = words.filter((word) => word.MatchTag === 2 || word.MatchTag === 3).length;
  const extraIssues = words.filter((word) => word.MatchTag === 1).length;
  const unscoredIssues = words.filter((word) => word.MatchTag === 4).length;
  const matchedRequiredWords = words.filter((word) => Number(word.MatchTag || 0) === 0);
  const lowAccuracyIssues = matchedRequiredWords.filter(
    (word) => Number(word.PronAccuracy || 0) < passGateThresholds.minRequiredWordAccuracy
  ).length;
  const minWordAccuracy = matchedRequiredWords.length
    ? Math.min(...matchedRequiredWords.map((word) => Number(word.PronAccuracy || 0)))
    : null;

  return {
    passed:
      Number(result?.SuggestedScore || 0) >= Number(minScore || 75) &&
      Number(result?.PronAccuracy || 0) >= passGateThresholds.minAccuracy &&
      Number(result?.PronCompletion || 0) >= passGateThresholds.minCompletion &&
      severeIssues === 0 &&
      unscoredIssues === 0 &&
      lowAccuracyIssues === 0 &&
      extraIssues <= passGateThresholds.maxExtraIssues,
    severeIssues,
    extraIssues,
    unscoredIssues,
    lowAccuracyIssues,
    minWordAccuracy
  };
}
