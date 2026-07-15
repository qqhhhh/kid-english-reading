export function decideAutomaticScoreOutcome({ passed, required, hasNext, failedCount }) {
  if (passed || required === false) {
    return {
      action: hasNext ? "next" : "complete",
      failedCount: 0,
      noSpeechCount: 0
    };
  }

  const nextFailedCount = failedCount + 1;
  return {
    action: nextFailedCount >= 3 ? "stop-failed" : "retry",
    failedCount: nextFailedCount,
    noSpeechCount: 0
  };
}

export function decideAutomaticRecordingFailure({ kind, noSpeechCount }) {
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
