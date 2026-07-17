import type { AssessmentResultLike } from "../shared/assessmentTypes.js";

export type AssessmentRejection = "no-speech-detected" | null;

export interface AssessmentValidityInput {
  referenceText?: string | null;
  result?: AssessmentResultLike | null;
  gate?: { severeIssues?: number } | null;
  recordingQuality?: { rms?: number } | null;
}

export function getAssessmentRejection({
  referenceText,
  result,
  gate,
  recordingQuality
}: AssessmentValidityInput): AssessmentRejection {
  const rms = Number(recordingQuality?.rms);
  if (!Number.isFinite(rms)) return null;

  const words = Array.isArray(result?.Words) ? result.Words : [];
  const referenceWordCount = Math.max(
    1,
    countReferenceWords(referenceText),
    words.filter((word) => word.MatchTag !== 1).length
  );
  const matchedWordCount = words.filter((word) => Number(word.MatchTag || 0) === 0).length;
  const severeIssues = Number(gate?.severeIssues || 0);
  const completion = Number(result?.PronCompletion || 0);
  const lowEnergy = rms < 0.006;
  const mostlyMissing = severeIssues >= Math.ceil(referenceWordCount * 0.5);
  const onlySparseMatch = matchedWordCount <= Math.max(1, Math.floor(referenceWordCount * 0.4));

  if (lowEnergy && completion <= 0.4 && mostlyMissing && onlySparseMatch) {
    return "no-speech-detected";
  }
  return null;
}

function countReferenceWords(text?: string | null): number {
  return String(text || "").match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.length || 0;
}
