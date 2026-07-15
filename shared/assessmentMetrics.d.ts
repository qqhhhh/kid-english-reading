export type AssessmentWordLike = {
  MatchTag: number;
  PronAccuracy: number;
};

export type AssessmentResultLike = {
  PronFluency: number;
  PronCompletion: number;
  Words: AssessmentWordLike[];
};

export type WordAccuracyMetrics = {
  totalCount: number;
  clearCount: number;
  averageAccuracy: number;
  weakestAccuracy: number;
  allWordAccuracy: number;
};

export function getWordAccuracyMetrics(result: AssessmentResultLike): WordAccuracyMetrics;
export function getEffectiveFluency(result: AssessmentResultLike): number;
export function getRequiredWordScore(word: AssessmentWordLike): number;
