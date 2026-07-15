export type AutomaticScoreAction = "next" | "complete" | "retry" | "stop-failed";
export type AutomaticRecordingFailureAction = "retry" | "stop-no-speech" | "stop-interrupted" | "stop-error";

export function decideAutomaticScoreOutcome(input: {
  passed: boolean;
  required: boolean;
  hasNext: boolean;
  failedCount: number;
}): { action: AutomaticScoreAction; failedCount: number; noSpeechCount: number };

export function decideAutomaticRecordingFailure(input: {
  kind: "no-speech" | "capture-gap" | "error";
  noSpeechCount: number;
}): { action: AutomaticRecordingFailureAction; noSpeechCount: number };
