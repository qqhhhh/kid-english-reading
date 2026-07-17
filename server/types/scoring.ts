import type { AssessmentResultLike } from "../../shared/assessmentTypes.js";

export interface PassGateResult {
  passed: boolean;
  severeIssues: number;
  extraIssues: number;
  unscoredIssues: number;
  lowAccuracyIssues: number;
  minWordAccuracy: number | null;
}

export interface AssessmentGateLike {
  passed: boolean;
  severeIssues?: number;
  unscoredIssues?: number;
}

export interface AttemptCandidateLike {
  result: AssessmentResultLike;
  gate: AssessmentGateLike;
}

export interface ScoredAttemptLike {
  passed?: boolean;
  result?: AssessmentResultLike | null;
}
