import assert from "node:assert/strict";
import test from "node:test";

import { StreamingPcmEncoder } from "../src/lib/streamingPcm.js";

test("streaming PCM encoder emits 40ms 16kHz mono packets", () => {
  const encoder = new StreamingPcmEncoder();
  const samples = new Float32Array(9600).fill(0.5);
  const packets = encoder.push(samples, 48000);
  assert.equal(packets.length, 5);
  assert.equal(packets[0].byteLength, 1280);
  assert.ok(new DataView(packets[0]).getInt16(0, true) > 16000);
});

test("streaming PCM encoder buffers short chunks and flushes the remainder", () => {
  const encoder = new StreamingPcmEncoder();
  assert.equal(encoder.push(new Float32Array(600), 48000).length, 0);
  assert.equal(encoder.push(new Float32Array(600), 48000).length, 0);
  const remainder = encoder.flush();
  assert.equal(remainder.length, 1);
  assert.equal(remainder[0].byteLength, 800);
});
