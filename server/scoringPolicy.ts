import type { AssessmentResultLike, AssessmentWordLike } from "../shared/assessmentTypes.js";
import type { ScoredAttemptLike } from "./types/scoring.js";

export const minimumEffectiveWordAccuracy = 50;

export interface ScorePolicyResult extends AssessmentResultLike {
  Words: AssessmentWordLike[];
  ProviderSuggestedScore: number;
  SuggestedScore: number;
  PronCompletion: number;
  ScorePolicy?: "zero-on-missed-word";
}

export function applyScorePolicy<T extends AssessmentResultLike>(result: T): T & ScorePolicyResult {
  const providerSuggestedScore = Number(result?.ProviderSuggestedScore ?? result?.SuggestedScore ?? 0);
  const normalizedWords = Array.isArray(result?.Words) ? result.Words : [];
  const missedWordCount = getMissedWordCount({ Words: normalizedWords });
  const requiredWordCount = normalizedWords.filter((word) => Number(word.MatchTag) !== 1).length;
  const providerCompletion = Number(result?.ProviderPronCompletion ?? result?.PronCompletion ?? 0);
  const effectiveCompletion = requiredWordCount
    ? Math.min(providerCompletion, (requiredWordCount - missedWordCount) / requiredWordCount)
    : providerCompletion;
  const completionWasAdjusted = effectiveCompletion < providerCompletion;

  return {
    ...result,
    Words: normalizedWords,
    ProviderSuggestedScore: providerSuggestedScore,
    SuggestedScore: missedWordCount > 0 ? 0 : providerSuggestedScore,
    ...(completionWasAdjusted ? { ProviderPronCompletion: providerCompletion } : {}),
    PronCompletion: Number(effectiveCompletion.toFixed(3)),
    ...(missedWordCount > 0 ? { ScorePolicy: "zero-on-missed-word" } : {})
  } as T & ScorePolicyResult;
}

export function getPolicyScore(result?: AssessmentResultLike | null): number {
  return getMissedWordCount(result) > 0 ? 0 : Number(result?.SuggestedScore || 0);
}

export function hasValidPassedScore(attempt?: ScoredAttemptLike | null): boolean {
  return Boolean(attempt?.passed) && getMissedWordCount(attempt?.result) === 0;
}

export function selectBestPassedAttempt<T extends ScoredAttemptLike>(attempts?: readonly T[] | null): T | null {
  const validAttempts = Array.isArray(attempts) ? attempts.filter(hasValidPassedScore) : [];
  return validAttempts.reduce<T | null>((best, attempt) => {
    if (!best) return attempt;
    return getPolicyScore(attempt.result) >= getPolicyScore(best.result) ? attempt : best;
  }, null);
}

function getMissedWordCount(result?: AssessmentResultLike | null): number {
  const words = Array.isArray(result?.Words) ? result.Words : [];
  return words.filter(isEffectivelyMissedWord).length;
}

function isEffectivelyMissedWord(word: AssessmentWordLike): boolean {
  const tag = Number(word?.MatchTag || 0);
  return tag === 2;
}
