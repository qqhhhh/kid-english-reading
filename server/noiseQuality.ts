import type { AssessmentResultLike } from "../shared/assessmentTypes.js";

export type NoiseGateReason =
  | "residual-noise-too-high"
  | "speech-over-suppressed"
  | "raw-enhanced-assessment-diverged"
  | null;

export interface SpeechEnhancementMetricsLike {
  applied?: boolean;
  output?: {
    estimatedSnrDb?: number;
    rms?: number;
  } | null;
  speechRetentionDb?: number;
  overallReductionDb?: number;
  noiseFloorReductionDb?: number;
}

export interface NoiseGateInput {
  enhancement?: SpeechEnhancementMetricsLike | null;
  enhancedResult?: AssessmentResultLike | null;
  rawResult?: AssessmentResultLike | null;
}

export interface NoiseGateResult {
  rejected: boolean | null | undefined;
  reason: NoiseGateReason;
  outputSnrDb?: number;
  speechRetentionDb?: number;
  overallReductionDb?: number;
  scoreDelta?: number;
  completionDelta?: number;
}

export function evaluateNoiseGate({ enhancement, enhancedResult, rawResult }: NoiseGateInput): NoiseGateResult {
  if (!enhancement?.applied) {
    return { rejected: false, reason: null };
  }

  const outputSnrDb = Number(enhancement.output?.estimatedSnrDb || 0);
  const speechRetentionDb = Number(enhancement.speechRetentionDb || 0);
  const overallReductionDb = Number(enhancement.overallReductionDb || 0);
  const enhancedScore = Number(enhancedResult?.SuggestedScore || 0);
  const rawScore = Number(rawResult?.SuggestedScore || 0);
  const enhancedCompletion = Number(enhancedResult?.PronCompletion || 0);
  const rawCompletion = Number(rawResult?.PronCompletion || 0);
  const scoreDelta = rawResult ? enhancedScore - rawScore : 0;
  const completionDelta = rawResult ? enhancedCompletion - rawCompletion : 0;
  const outputStillNoisy = outputSnrDb < 7 && Number(enhancement.output?.rms || 0) >= 0.012;
  const speechWasOverSuppressed = speechRetentionDb < -12;
  const unstableAssessment = rawResult && (Math.abs(scoreDelta) > 30 || Math.abs(completionDelta) > 0.4);
  const enhancementWasAggressive =
    overallReductionDb > 9 || Number(enhancement.noiseFloorReductionDb || 0) > 14;
  const rejected = outputStillNoisy || speechWasOverSuppressed || (unstableAssessment && enhancementWasAggressive);

  return {
    rejected,
    reason: outputStillNoisy
      ? "residual-noise-too-high"
      : speechWasOverSuppressed
        ? "speech-over-suppressed"
        : rejected
          ? "raw-enhanced-assessment-diverged"
          : null,
    outputSnrDb,
    speechRetentionDb,
    overallReductionDb,
    scoreDelta: Math.round(scoreDelta * 100) / 100,
    completionDelta: Math.round(completionDelta * 1000) / 1000
  };
}
