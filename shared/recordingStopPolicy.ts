export interface SpeechSegmentTiming {
  voiceDurationMs: number;
}

export interface RecordingStopPolicyInput {
  isWordItem: boolean;
  segments: SpeechSegmentTiming[];
  expectedVoiceDurationMs: number;
}

export function getAutomaticRecordingStopDelayMs({
  isWordItem,
  segments,
  expectedVoiceDurationMs
}: RecordingStopPolicyInput): number {
  if (isWordItem) {
    // Neural VAD has already observed the configured end-of-speech silence.
    // Do not add a second debounce after that confirmed endpoint.
    return 0;
  }

  const totalVoiceDurationMs = segments.reduce((sum, segment) => sum + segment.voiceDurationMs, 0);
  const durationRatio = totalVoiceDurationMs / Math.max(1, expectedVoiceDurationMs);
  const hasEnoughSpeech = durationRatio >= 0.72;
  return segments.length === 1
    ? durationRatio >= 0.72 && durationRatio <= 1.8
      ? 1100
      : 2400
    : hasEnoughSpeech
      ? 650
      : 1800;
}
