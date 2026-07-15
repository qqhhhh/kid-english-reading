import assert from "node:assert/strict";
import test from "node:test";
import { cropAttemptPlaybackAudio } from "../server/attemptPlaybackAudio.js";

function createSilentWav(durationMs, sampleRate = 16000) {
  const sampleCount = Math.round((durationMs / 1000) * sampleRate);
  const output = Buffer.alloc(44 + sampleCount * 2);
  output.write("RIFF", 0);
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(sampleCount * 2, 40);
  return output;
}

test("playback audio drops noise outside the assessed word timing window", () => {
  const original = createSilentWav(2440);
  const cropped = cropAttemptPlaybackAudio(original, {
    Words: [
      { MatchTag: 0, MemBeginTime: 350, MemEndTime: 850 },
      { MatchTag: 0, MemBeginTime: 850, MemEndTime: 1200 },
      { MatchTag: 0, MemBeginTime: 1200, MemEndTime: 2270 }
    ]
  });

  assert.equal(cropped.toString("ascii", 0, 4), "RIFF");
  assert.equal(cropped.readUInt32LE(40), 67200);
  assert.equal(cropped.length, 67244);
  assert.equal(cropped.readUInt32LE(4), cropped.length - 8);
});

test("playback audio stays unchanged when assessment timings are unavailable", () => {
  const original = createSilentWav(1000);
  assert.equal(cropAttemptPlaybackAudio(original, { Words: [] }), original);
});
