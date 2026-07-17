export interface SequentialAudioElement {
  currentTime: number;
  onended: unknown;
  onerror: unknown;
  pause(): void;
  preload: string;
  src: string;
}

type PreparationResult = { ok: true } | { ok: false; error: unknown };

/**
 * Reuse one media element while changing sources between sequential clips.
 * WebKit grants audible playback permission to the element started by the
 * user's gesture, so replacing the element for every clip can lose that grant.
 */
export function prepareSequentialAudio<T extends SequentialAudioElement>(
  currentElement: T | null,
  source: string,
  createElement: () => T
): T {
  const audio = currentElement || createElement();
  audio.pause();
  audio.currentTime = 0;
  audio.onended = null;
  audio.onerror = null;
  audio.preload = "auto";
  audio.src = source;
  return audio;
}

/**
 * Start recorder preparation only after audible playback has started, then
 * wait for both preparation and playback before allowing capture to begin.
 * Preparation failures are converted to a result immediately so a long clip
 * cannot leave a rejected promise unhandled.
 */
export async function prepareDuringPlayback(
  play: (onPlaybackStarted: () => void) => Promise<boolean>,
  prepare: () => Promise<void>
): Promise<boolean> {
  const state: { preparation: Promise<PreparationResult> | null } = { preparation: null };
  const startPreparation = () => {
    if (state.preparation) return;
    state.preparation = prepare().then<PreparationResult, PreparationResult>(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error })
    );
  };

  let playbackCompleted: boolean;
  try {
    playbackCompleted = await play(startPreparation);
  } catch (error) {
    if (state.preparation) await state.preparation;
    throw error;
  }
  if (playbackCompleted && !state.preparation) startPreparation();
  if (state.preparation) {
    const result = await state.preparation;
    if (!result.ok) throw result.error;
  }
  return playbackCompleted;
}
