export function getWordAccuracyMetrics(result) {
  const words = Array.isArray(result?.Words) ? result.Words : [];
  const requiredWords = words.filter((word) => Number(word.MatchTag || 0) !== 1);
  const scores = requiredWords.map(getRequiredWordScore);
  const totalCount = scores.length;
  const clearCount = scores.filter((score) => score >= 70).length;
  const averageAccuracy = totalCount ? scores.reduce((sum, score) => sum + score, 0) / totalCount : 0;
  const weakestAccuracy = totalCount ? Math.min(...scores) : 0;
  const allWordAccuracy = totalCount ? averageAccuracy * 0.7 + weakestAccuracy * 0.3 : 0;

  return {
    totalCount,
    clearCount,
    averageAccuracy: roundScore(averageAccuracy),
    weakestAccuracy: roundScore(weakestAccuracy),
    allWordAccuracy: roundScore(allWordAccuracy)
  };
}

export function getEffectiveFluency(result) {
  const rawFluency = clampScore(Number(result?.PronFluency || 0) * 100);
  const completion = Math.max(0, Math.min(1, Number(result?.PronCompletion || 0)));
  const { allWordAccuracy } = getWordAccuracyMetrics(result);
  return roundScore(Math.min(rawFluency, allWordAccuracy) * completion);
}

export function getRequiredWordScore(word) {
  const tag = Number(word?.MatchTag || 0);
  if (tag === 2 || tag === 3 || tag === 4) return 0;
  return clampScore(Number(word?.PronAccuracy || 0));
}

function clampScore(score) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function roundScore(score) {
  return Math.round(score * 10) / 10;
}
