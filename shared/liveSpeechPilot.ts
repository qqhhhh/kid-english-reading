export interface LiveSpeechTestProgressInput {
  final: boolean;
  suggestedScore: number;
  completion: number;
  wordCount: number;
  endRequestedAtMs: number;
  receivedAtMs: number;
}

export interface LiveSpeechTestFinalResult {
  suggestedScore: number;
  completionPercent: number;
  wordCount: number;
  finalLatencyMs: number;
}

export function getLiveSpeechTestFinalResult(
  input: LiveSpeechTestProgressInput
): LiveSpeechTestFinalResult | null {
  if (!input.final || input.endRequestedAtMs <= 0) return null;
  const completionRatio = input.completion > 1.5 ? input.completion / 100 : input.completion;
  return {
    suggestedScore: Number.isFinite(input.suggestedScore) ? input.suggestedScore : 0,
    completionPercent: Math.max(0, Math.min(100, completionRatio * 100)),
    wordCount: Math.max(0, input.wordCount),
    finalLatencyMs: Math.max(0, input.receivedAtMs - input.endRequestedAtMs)
  };
}

export function getLiveSpeechTestScoreDelta(streamingScore: number | undefined, batchScore: number | undefined) {
  if (streamingScore === undefined || batchScore === undefined) return undefined;
  return batchScore - streamingScore;
}
