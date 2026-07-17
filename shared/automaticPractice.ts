export type AutomaticScoreAction = "next" | "complete" | "pause-failed";
export type AutomaticRecordingFailureAction = "retry" | "stop-no-speech" | "stop-interrupted" | "stop-error";
export type AutomaticRecordingFailureKind = "no-speech" | "capture-gap" | "error";

export interface AutomaticScoreInput {
  passed: boolean;
  required: boolean;
  suggestedScore: number;
  hasNext: boolean;
  failedCount: number;
}

export interface AutomaticScoreOutcome {
  action: AutomaticScoreAction;
  failedCount: number;
  noSpeechCount: number;
}

export interface AutomaticRecordingFailureInput {
  kind: AutomaticRecordingFailureKind;
  noSpeechCount: number;
}

export interface AutomaticRecordingFailureOutcome {
  action: AutomaticRecordingFailureAction;
  noSpeechCount: number;
}

export function decideAutomaticScoreOutcome({
  passed,
  required,
  suggestedScore,
  hasNext,
  failedCount
}: AutomaticScoreInput): AutomaticScoreOutcome {
  if (passed || (required === false && suggestedScore > 0)) {
    return {
      action: hasNext ? "next" : "complete",
      failedCount: 0,
      noSpeechCount: 0
    };
  }

  const nextFailedCount = failedCount + 1;
  return {
    action: "pause-failed",
    failedCount: nextFailedCount,
    noSpeechCount: 0
  };
}

export function decideAutomaticRecordingFailure({
  kind,
  noSpeechCount
}: AutomaticRecordingFailureInput): AutomaticRecordingFailureOutcome {
  if (kind === "capture-gap") {
    return { action: "stop-interrupted", noSpeechCount };
  }
  if (kind !== "no-speech") {
    return { action: "stop-error", noSpeechCount };
  }

  const nextNoSpeechCount = noSpeechCount + 1;
  return {
    action: nextNoSpeechCount >= 3 ? "stop-no-speech" : "retry",
    noSpeechCount: nextNoSpeechCount
  };
}
