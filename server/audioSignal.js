export function decodePcm16MonoWav(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44) {
    throw new Error("A PCM WAV buffer is required");
  }
  if (audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Unsupported WAV container");
  }

  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkOffset = offset + 8;
    if (chunkOffset + chunkSize > audio.length) throw new Error("Invalid WAV chunk size");
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: audio.readUInt16LE(chunkOffset),
        channels: audio.readUInt16LE(chunkOffset + 2),
        sampleRate: audio.readUInt32LE(chunkOffset + 4),
        bitsPerSample: audio.readUInt16LE(chunkOffset + 14)
      };
    }
    if (chunkId === "data") {
      data = { offset: chunkOffset, size: chunkSize };
      break;
    }
    offset = chunkOffset + chunkSize + (chunkSize % 2);
  }

  if (!format || !data || format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error("Only mono 16-bit PCM WAV audio is supported");
  }

  const sampleCount = Math.floor(data.size / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = audio.readInt16LE(data.offset + index * 2) / 32768;
  }
  return { samples, sampleRate: format.sampleRate };
}

export function encodePcm16MonoWav(samples, sampleRate) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const output = Buffer.alloc(44 + source.length * 2);
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
  output.writeUInt32LE(source.length * 2, 40);
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(source[index]) || 0));
    output.writeInt16LE(Math.round(sample < 0 ? sample * 32768 : sample * 32767), 44 + index * 2);
  }
  return output;
}

export function measureAudioSignal(samples, sampleRate, frameMs = 20) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  if (source.length === 0) {
    return {
      durationMs: 0,
      peak: 0,
      rms: 0,
      noiseFloorRms: 0,
      speechRms: 0,
      estimatedSnrDb: 0,
      clippedPercent: 0
    };
  }

  const frameSize = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const frameRms = [];
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  for (let start = 0; start < source.length; start += frameSize) {
    const end = Math.min(source.length, start + frameSize);
    let frameSquares = 0;
    for (let index = start; index < end; index += 1) {
      const value = Number(source[index]) || 0;
      peak = Math.max(peak, Math.abs(value));
      if (Math.abs(value) >= 0.98) clipped += 1;
      frameSquares += value * value;
      sumSquares += value * value;
    }
    frameRms.push(Math.sqrt(frameSquares / Math.max(1, end - start)));
  }

  const sorted = [...frameRms].sort((left, right) => left - right);
  const noiseFloorRms = percentile(sorted, 0.2);
  const speechRms = percentile(sorted, 0.8);
  return {
    durationMs: round((source.length / sampleRate) * 1000),
    peak: round(peak, 5),
    rms: round(Math.sqrt(sumSquares / source.length), 5),
    noiseFloorRms: round(noiseFloorRms, 6),
    speechRms: round(speechRms, 6),
    estimatedSnrDb: round(dbRatio(speechRms, noiseFloorRms), 2),
    clippedPercent: round((clipped / source.length) * 100, 3)
  };
}

export function compareAudioSignals(input, output, sampleRate) {
  const inputMetrics = measureAudioSignal(input, sampleRate);
  const outputMetrics = measureAudioSignal(output, sampleRate);
  return {
    input: inputMetrics,
    output: outputMetrics,
    overallReductionDb: round(dbRatio(inputMetrics.rms, outputMetrics.rms), 2),
    noiseFloorReductionDb: round(dbRatio(inputMetrics.noiseFloorRms, outputMetrics.noiseFloorRms), 2),
    speechRetentionDb: round(dbRatio(outputMetrics.speechRms, inputMetrics.speechRms), 2)
  };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

function dbRatio(numerator, denominator) {
  return 20 * Math.log10(Math.max(1e-8, numerator) / Math.max(1e-8, denominator));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}
