import type { AssessmentResultLike, AssessmentWordLike } from "../../shared/assessmentTypes.js";
import type { PassGateResult } from "./scoring.js";

export type SpeechAssessmentItemType = "word" | "sentence" | "paragraph";

export interface ProviderPhoneResult {
  Phone: string;
  ReferencePhone: string;
  ReferenceLetter: string;
  PronAccuracy: number;
  MatchTag: number;
  MemBeginTime?: number;
  MemEndTime?: number;
  NBestPhonemes?: Array<{ Phone: string; Score: number }>;
}

export interface ProviderWordResult extends AssessmentWordLike {
  Word: string;
  ReferenceWord: string;
  PronAccuracy: number;
  PronFluency: number;
  MatchTag: number;
  MemBeginTime?: number;
  MemEndTime?: number;
  PhoneInfos: ProviderPhoneResult[];
  ProviderErrorType?: string;
  ProviderDpMessage?: number;
  ProviderProperty?: number;
}

export interface ProviderAssessmentResult extends AssessmentResultLike {
  SuggestedScore: number;
  ProviderSuggestedScore?: number;
  PronAccuracy: number;
  PronFluency: number;
  PronCompletion: number;
  ProviderPronCompletion?: number;
  ProviderRawScores?: Record<string, number | undefined>;
  ProviderRejected?: boolean;
  ProviderExceptionCode?: number;
  RecognizedText?: string;
  Words: ProviderWordResult[];
}

export interface SpeechAssessmentRequest {
  audio: Uint8Array;
  referenceText: string;
  durationMs?: number;
  provider?: string;
  itemType?: SpeechAssessmentItemType;
}

export type SpeechAssessor = (request: SpeechAssessmentRequest) => Promise<ProviderAssessmentResult>;

export interface SpeechProviderComparisonStatus {
  enabled: boolean;
  mode: "shadow" | "disabled";
  primaryProvider: string;
  shadowProvider?: string;
  timeoutMs: number;
  configured: boolean;
}

export interface SpeechProviderSummary {
  passed: boolean;
  suggestedScore: number;
  providerSuggestedScore: number;
  pronAccuracy: number;
  pronFluency: number;
  pronCompletion: number;
  severeIssues: number;
  lowAccuracyIssues: number;
  providerRejected: boolean;
  providerExceptionCode: number;
}

export interface SpeechComparisonInput {
  primaryProvider: string;
  primaryResult: ProviderAssessmentResult;
  primaryGate: Pick<PassGateResult, "passed"> & Partial<PassGateResult>;
  primaryDurationMs: number;
  referenceText: string;
  itemType?: SpeechAssessmentItemType;
  durationMs: number;
  audio: Uint8Array;
  minScore: number;
  assess: SpeechAssessor;
}

export interface TtsVoice {
  id: string;
  provider: "tencent";
  name: string;
  description: string;
  modelType: number;
  voiceType: number;
  primaryLanguage: number;
  category: string;
  subtitleSupport: "timed" | "none";
}

export interface TtsSynthesisRequest {
  text: string;
  sentenceId: string;
  voice?: TtsVoice | null;
}

export interface TtsSynthesisResult {
  audio: Buffer;
  subtitles: unknown[];
  subtitleFallback: boolean;
  contentType: "audio/wav" | "audio/mpeg";
  extension: "wav" | "mp3";
}
