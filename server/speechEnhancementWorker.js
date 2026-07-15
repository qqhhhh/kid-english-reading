import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import { compareAudioSignals, decodePcm16MonoWav, encodePcm16MonoWav, measureAudioSignal } from "./audioSignal.js";

const require = createRequire(import.meta.url);
const { OfflineSpeechDenoiser } = require("sherpa-onnx-node");
const denoiser = new OfflineSpeechDenoiser({
  model: {
    gtcrn: { model: workerData.modelPath },
    numThreads: 1,
    debug: 0,
    provider: "cpu"
  }
});

parentPort.postMessage({ type: "ready", sampleRate: denoiser.sampleRate });
parentPort.on("message", ({ id, audio }) => {
  const startedAt = performance.now();
  try {
    const decoded = decodePcm16MonoWav(Buffer.from(audio));
    const enhanced = denoiser.run({ samples: decoded.samples, sampleRate: decoded.sampleRate });
    const levelMatched = restoreSpeechLevel(decoded.samples, enhanced.samples, enhanced.sampleRate);
    const output = encodePcm16MonoWav(levelMatched.samples, enhanced.sampleRate);
    const metrics = {
      provider: "gtcrn",
      model: "gtcrn_simple",
      applied: true,
      processingMs: Math.round((performance.now() - startedAt) * 10) / 10,
      levelGainDb: levelMatched.gainDb,
      preGainOutput: levelMatched.preGainMetrics,
      ...compareAudioSignals(decoded.samples, levelMatched.samples, enhanced.sampleRate)
    };
    const arrayBuffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    parentPort.postMessage({ type: "result", id, audio: arrayBuffer, metrics }, [arrayBuffer]);
  } catch (error) {
    parentPort.postMessage({ type: "error", id, error: error?.message || String(error) });
  }
});

function restoreSpeechLevel(input, output, sampleRate) {
  const inputMetrics = measureAudioSignal(input, sampleRate);
  const outputMetrics = measureAudioSignal(output, sampleRate);
  const speechGain = inputMetrics.speechRms / Math.max(1e-6, outputMetrics.speechRms);
  const peakGain = 0.92 / Math.max(1e-6, outputMetrics.peak);
  const gain = Math.max(0.75, Math.min(3.2, speechGain, peakGain));
  if (Math.abs(gain - 1) < 0.02) {
    return { samples: output, gainDb: 0, preGainMetrics: outputMetrics };
  }
  const samples = new Float32Array(output.length);
  for (let index = 0; index < output.length; index += 1) {
    samples[index] = Math.max(-1, Math.min(1, output[index] * gain));
  }
  return {
    samples,
    gainDb: Math.round(20 * Math.log10(gain) * 100) / 100,
    preGainMetrics: outputMetrics
  };
}
