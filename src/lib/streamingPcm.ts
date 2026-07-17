const targetSampleRate = 16_000;
const packetDurationMs = 40;

export class StreamingPcmEncoder {
  private chunks: Float32Array[] = [];
  private bufferedSamples = 0;
  private inputSampleRate = 0;

  push(input: Float32Array, inputSampleRate: number): ArrayBuffer[] {
    if (!input.length || !Number.isFinite(inputSampleRate) || inputSampleRate <= 0) return [];
    if (this.inputSampleRate && this.inputSampleRate !== inputSampleRate) this.reset();
    this.inputSampleRate = inputSampleRate;
    this.chunks.push(new Float32Array(input));
    this.bufferedSamples += input.length;
    return this.drain(false);
  }

  flush(): ArrayBuffer[] {
    return this.drain(true);
  }

  reset() {
    this.chunks = [];
    this.bufferedSamples = 0;
    this.inputSampleRate = 0;
  }

  private drain(flush: boolean): ArrayBuffer[] {
    if (!this.inputSampleRate || !this.bufferedSamples) return [];
    const packetSamples = Math.max(1, Math.round(this.inputSampleRate * packetDurationMs / 1000));
    if (!flush && this.bufferedSamples < packetSamples) return [];

    const merged = new Float32Array(this.bufferedSamples);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const packets: ArrayBuffer[] = [];
    let consumed = 0;
    while (merged.length - consumed >= packetSamples || (flush && merged.length > consumed)) {
      const length = Math.min(packetSamples, merged.length - consumed);
      packets.push(encodePcm16(resampleBlock(merged.subarray(consumed, consumed + length), this.inputSampleRate)));
      consumed += length;
    }
    const remainder = merged.slice(consumed);
    this.chunks = remainder.length ? [remainder] : [];
    this.bufferedSamples = remainder.length;
    if (flush) this.reset();
    return packets;
  }
}

function resampleBlock(input: Float32Array, inputSampleRate: number) {
  if (inputSampleRate === targetSampleRate) return input;
  const outputLength = Math.max(1, Math.round(input.length * targetSampleRate / inputSampleRate));
  const output = new Float32Array(outputLength);
  const ratio = inputSampleRate / targetSampleRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(input.length - 1, index * ratio);
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(input.length - 1, leftIndex + 1);
    const fraction = sourceIndex - leftIndex;
    output[index] = input[leftIndex] * (1 - fraction) + input[rightIndex] * fraction;
  }
  return output;
}

function encodePcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}
