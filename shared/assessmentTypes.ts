export interface AssessmentWordLike {
  Word?: string;
  ReferenceWord?: string;
  MatchTag?: number;
  PronAccuracy?: number;
  ProviderMatchTag?: number;
  MatchInference?: string;
}

export interface AssessmentResultLike {
  SuggestedScore?: number;
  ProviderSuggestedScore?: number;
  PronAccuracy?: number;
  PronFluency?: number;
  PronCompletion?: number;
  ProviderPronCompletion?: number;
  Words?: AssessmentWordLike[];
}
