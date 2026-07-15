export const minimumEffectiveWordAccuracy = 50;

export function applyScorePolicy(result) {
  const providerSuggestedScore = Number(result?.ProviderSuggestedScore ?? result?.SuggestedScore ?? 0);
  const normalizedWords = normalizeEffectiveMissedWords(result?.Words);
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
  };
}

export function getPolicyScore(result) {
  return getMissedWordCount(result) > 0 ? 0 : Number(result?.SuggestedScore || 0);
}

export function hasValidPassedScore(attempt) {
  return Boolean(attempt?.passed) && getMissedWordCount(attempt?.result) === 0;
}

export function selectBestPassedAttempt(attempts) {
  const validAttempts = Array.isArray(attempts) ? attempts.filter(hasValidPassedScore) : [];
  return validAttempts.reduce((best, attempt) => {
    if (!best) return attempt;
    return getPolicyScore(attempt.result) >= getPolicyScore(best.result) ? attempt : best;
  }, null);
}

function getMissedWordCount(result) {
  const words = Array.isArray(result?.Words) ? result.Words : [];
  return words.filter(isEffectivelyMissedWord).length;
}

function normalizeEffectiveMissedWords(words) {
  if (!Array.isArray(words)) return [];
  const inferredMissedIndexes = new Set();

  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    const tag = Number(word?.MatchTag || 0);
    if (tag === 1) continue;
    if (tag !== 0 || Number(word?.PronAccuracy || 0) >= minimumEffectiveWordAccuracy) break;
    inferredMissedIndexes.add(index);
  }

  return words.map((word, index) => {
    if (!inferredMissedIndexes.has(index)) return word;
    return {
      ...word,
      ProviderMatchTag: Number(word.MatchTag || 0),
      MatchTag: 2,
      MatchInference: "low-accuracy-as-missed"
    };
  });
}

function isEffectivelyMissedWord(word) {
  const tag = Number(word?.MatchTag || 0);
  return tag === 2;
}
