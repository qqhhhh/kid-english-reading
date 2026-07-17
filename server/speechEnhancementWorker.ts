import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import { compareAudioSignals, decodePcm16MonoWav, encodePcm16MonoWav, measureAudioSignal } from "./audioSignal.js";
import type { AudioSignalMetrics } from "./audioSignal.js";

interface DenoiserResult {
  samples: Float32Array;
  sampleRate: number;
}

interface OfflineSpeechDenoiserInstance {
  sampleRate: number;
  run(input: { samples: Float32Array; sampleRate: number }): DenoiserResult;
}

interface OfflineSpeechDenoiserConstructor {
  new (config: unknown): OfflineSpeechDenoiserInstance;
}

interface EnhancementRequest {
  id: string;
  audio: ArrayBuffer | ArrayBufferView;
}

interface RestoredSpeechLevel {
  samples: Float32Array;
  gainDb: number;
  preGainMetrics: AudioSignalMetrics;
}

const require = createRequire(import.meta.url);
const { OfflineSpeechDenoiser } = require("sherpa-onnx-node") as {
  OfflineSpeechDenoiser: OfflineSpeechDenoiserConstructor;
};
const runtimeData = workerData as { modelPath: string };
const denoiser = new OfflineSpeechDenoiser({
  model: {
    gtcrn: { model: runtimeData.modelPath },
    numThreads: 1,
    debug: 0,
    provider: "cpu"
  }
});

if (!parentPort) throw new Error("Speech enhancement worker requires a parent port");
const port = parentPort;

port.postMessage({ type: "ready", sampleRate: denoiser.sampleRate });
port.on("message", ({ id, audio }: EnhancementRequest) => {
  const startedAt = performance.now();
  try {
    const inputAudio = audio instanceof ArrayBuffer
      ? Buffer.from(audio)
      : Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    const decoded = decodePcm16MonoWav(inputAudio);
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
    const arrayBuffer = new ArrayBuffer(output.byteLength);
    new Uint8Array(arrayBuffer).set(output);
    port.postMessage({ type: "result", id, audio: arrayBuffer, metrics }, [arrayBuffer]);
  } catch (error: unknown) {
    port.postMessage({ type: "error", id, error: error instanceof Error ? error.message : String(error) });
  }
});

function restoreSpeechLevel(
  input: Float32Array,
  output: Float32Array,
  sampleRate: number
): RestoredSpeechLevel {
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
