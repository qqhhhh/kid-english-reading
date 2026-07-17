import assert from "node:assert/strict";
import test from "node:test";
import { compareAudioSignals, decodePcm16MonoWav, encodePcm16MonoWav } from "../server/audioSignal.js";

test("PCM WAV encoding and decoding preserve a mono speech signal", () => {
  const samples = Float32Array.from([0, 0.25, -0.5, 0.9, -1]);
  const wav = encodePcm16MonoWav(samples, 16000);
  const decoded = decodePcm16MonoWav(wav);

  assert.equal(decoded.sampleRate, 16000);
  assert.equal(decoded.samples.length, samples.length);
  assert.ok(Math.abs(decoded.samples[2] + 0.5) < 0.0001);
  assert.ok(Math.abs(decoded.samples[3] - 0.9) < 0.0001);
});

test("enhancement metrics report lower noise while retaining speech", () => {
  const sampleRate = 16000;
  const raw = new Float32Array(sampleRate);
  const enhanced = new Float32Array(sampleRate);
  for (let index = 0; index < sampleRate; index += 1) {
    const speech = index >= sampleRate / 2 ? Math.sin((index / sampleRate) * Math.PI * 2 * 220) * 0.2 : 0;
    const noise = index % 2 === 0 ? 0.03 : -0.03;
    raw[index] = speech + noise;
    enhanced[index] = speech + noise * 0.1;
  }

  const metrics = compareAudioSignals(raw, enhanced, sampleRate);
  assert.ok(metrics.noiseFloorReductionDb > 15);
  assert.ok(metrics.speechRetentionDb > -2);
  assert.ok(metrics.output.estimatedSnrDb > metrics.input.estimatedSnrDb);
});
