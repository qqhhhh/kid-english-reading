import test from "node:test";
import assert from "node:assert/strict";
import { prepareDuringPlayback, prepareSequentialAudio } from "../shared/sequentialAudio.js";

function createFakeAudio() {
  return {
    currentTime: 8,
    onended: () => undefined,
    onerror: () => undefined,
    pauseCount: 0,
    preload: "none",
    src: "",
    pause() {
      this.pauseCount += 1;
    }
  };
}

test("sequential reference clips reuse the media element unlocked by the first tap", () => {
  let createdCount = 0;
  const createElement = () => {
    createdCount += 1;
    return createFakeAudio();
  };

  const first = prepareSequentialAudio(null, "/api/tts/first", createElement);
  first.currentTime = 2;
  first.onended = () => undefined;
  first.onerror = () => undefined;

  const second = prepareSequentialAudio(first, "/api/tts/second", createElement);

  assert.equal(second, first);
  assert.equal(createdCount, 1);
  assert.equal(second.src, "/api/tts/second");
  assert.equal(second.currentTime, 0);
  assert.equal(second.onended, null);
  assert.equal(second.onerror, null);
  assert.equal(second.preload, "auto");
});

test("microphone preparation overlaps playback and capture waits for the example to end", async () => {
  const events: string[] = [];
  let endPlayback: () => void = () => undefined;
  let finishPreparation: () => void = () => undefined;
  const playbackEnded = new Promise<void>((resolve) => {
    endPlayback = resolve;
  });
  const preparationFinished = new Promise<void>((resolve) => {
    finishPreparation = resolve;
  });

  const ready = prepareDuringPlayback(
    async (onPlaybackStarted) => {
      events.push("playback-started");
      onPlaybackStarted();
      events.push("playback-running");
      await playbackEnded;
      events.push("playback-ended");
      return true;
    },
    async () => {
      events.push("preparation-started");
      await preparationFinished;
      events.push("preparation-finished");
    }
  ).then((completed) => {
    events.push("capture-ready");
    return completed;
  });

  await Promise.resolve();
  assert.deepEqual(events, ["playback-started", "preparation-started", "playback-running"]);

  endPlayback();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ["playback-started", "preparation-started", "playback-running", "playback-ended"]);

  finishPreparation();
  assert.equal(await ready, true);
  assert.deepEqual(events, [
    "playback-started",
    "preparation-started",
    "playback-running",
    "playback-ended",
    "preparation-finished",
    "capture-ready"
  ]);
});

test("blocked playback does not open the microphone before the child taps continue", async () => {
  let preparationCount = 0;
  const completed = await prepareDuringPlayback(
    async () => false,
    async () => {
      preparationCount += 1;
    }
  );

  assert.equal(completed, false);
  assert.equal(preparationCount, 0);
});
