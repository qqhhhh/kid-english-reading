import type { AssessmentResult, WordAssessment } from "./types";
export { getEffectiveFluency, getRequiredWordScore, getWordAccuracyMetrics } from "../../shared/assessmentMetrics.js";

export type WordFeedbackKind = "extra" | "missed" | "misread" | "unscored" | "unclear" | "passed";

export function matchTagLabel(tag: number): string {
  switch (tag) {
    case 1:
      return "多读";
    case 2:
      return "漏读";
    case 3:
      return "错读";
    case 4:
      return "未收录";
    default:
      return "通过";
  }
}

export function getWordFeedbackKind(word: WordAssessment): WordFeedbackKind {
  switch (word.MatchTag) {
    case 1:
      return "extra";
    case 2:
      return "missed";
    case 3:
      return "misread";
    case 4:
      return "unscored";
    default:
      return word.PronAccuracy < 70 ? "unclear" : "passed";
  }
}

export function getAssessmentWordText(word: WordAssessment) {
  return cleanAssessmentToken(word.Word) || cleanAssessmentToken(word.ReferenceWord) || word.Word || word.ReferenceWord || "";
}

export function getAssessmentPhonetic(word: WordAssessment) {
  const phones = word.PhoneInfos.map((phone) => phone.ReferencePhone || phone.Phone || "")
    .map((phone) => phone.trim())
    .filter(Boolean);

  return phones.length ? `/${phones.join(" ")}/` : "";
}

export function getProblemWords(result: AssessmentResult) {
  return result.Words.filter((word) => getWordFeedbackKind(word) !== "passed");
}

export function scoreTone(score: number) {
  if (score >= 85) return "great";
  if (score >= 75) return "ok";
  return "retry";
}

function cleanAssessmentToken(value: string) {
  return value.replace(/_\d+$/u, "").trim();
}
