import type { MicVAD } from "@ricky0123/vad-web";
import type { RecordingQuality } from "./types";

export type { RecordingQuality } from "./types";

export type SpeechSegmentSummary = {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  voiceDurationMs: number;
};

export type RecordingCandidate = SpeechSegmentSummary & {
  blob: Blob;
  quality: RecordingQuality;
  kind: "speech-segment";
};

export type WavRecording = {
  blob: Blob;
  durationMs: number;
  quality: RecordingQuality;
  candidates: RecordingCandidate[];
};

export type RecordingQualityErrorCode = "no-speech" | "too-short" | "too-quiet" | "capture-gap";

export type WavRecorderCallbacks = {
  onSpeechStart?: () => void;
  onSpeechEnd?: (segment: SpeechSegmentSummary, segments: SpeechSegmentSummary[]) => void;
  onVADMisfire?: () => void;
};

type CapturedSpeechSegment = SpeechSegmentSummary & {
  samples: Float32Array;
};

type RecorderProcessor = AudioWorkletNode | ScriptProcessorNode;

type RecorderState = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: RecorderProcessor;
  captureMode: "audio-worklet" | "script-processor";
  flushCaptureResolve: (() => void) | null;
  vad: MicVAD | null;
  fallbackVad: {
    speaking: boolean;
    positiveFrames: number;
    segmentStartChunk: number;
    lastSpeechAt: number;
  };
  chunks: Float32Array[];
  segments: CapturedSpeechSegment[];
  startedAt: number;
  capturing: boolean;
  recorderConnected: boolean;
  speechActive: boolean;
  audioInput: NonNullable<RecordingQuality["audioInput"]>;
};

export class RecordingQualityError extends Error {
  code: RecordingQualityErrorCode;

  constructor(code: RecordingQualityErrorCode) {
    super(code);
    this.name = "RecordingQualityError";
    this.code = code;
  }
}

const outputSampleRate = 16000;
const stopTailMs = 250;
const analysisFrameMs = 20;
const leadingPaddingMs = 250;
const trailingPaddingMs = 350;
const maxAlternateCandidates = 2;
const captureGapMinimumMs = 450;
const captureGapMaximumRatio = 0.08;

function normalizeBooleanCapability(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const booleans = value.filter((item): item is boolean => typeof item === "boolean");
  return booleans.length > 0 ? booleans : undefined;
}

export class WavRecorder {
  private state: RecorderState | null = null;
  private callbacks: WavRecorderCallbacks;

  constructor(callbacks: WavRecorderCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async prepare() {
    if (this.state) return;

    const supported = navigator.mediaDevices.getSupportedConstraints();
    const audioConstraints: MediaTrackConstraints = { channelCount: 1 };
    if (supported.echoCancellation) audioConstraints.echoCancellation = true;
    if (supported.autoGainControl) audioConstraints.autoGainControl = true;
    if (supported.noiseSuppression) audioConstraints.noiseSuppression = true;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });
    const audioTrack = stream.getAudioTracks()[0];
    const settings = audioTrack?.getSettings?.() || {};
    const capabilities = audioTrack?.getCapabilities?.();
    const audioInput: NonNullable<RecordingQuality["audioInput"]> = {
      supported: {
        echoCancellation: Boolean(supported.echoCancellation),
        noiseSuppression: Boolean(supported.noiseSuppression),
        autoGainControl: Boolean(supported.autoGainControl),
        sampleRate: Boolean(supported.sampleRate),
        channelCount: Boolean(supported.channelCount)
      },
      applied: {
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount,
        sampleSize: settings.sampleSize,
        latency: settings.latency
      },
      capabilities: capabilities
        ? {
            echoCancellation: normalizeBooleanCapability(capabilities.echoCancellation),
            noiseSuppression: normalizeBooleanCapability(capabilities.noiseSuppression),
            autoGainControl: normalizeBooleanCapability(capabilities.autoGainControl),
            sampleRateMin: capabilities.sampleRate?.min,
            sampleRateMax: capabilities.sampleRate?.max,
            channelCountMin: capabilities.channelCount?.min,
            channelCountMax: capabilities.channelCount?.max
          }
        : undefined
    };
    const context = new AudioContext();

    try {
      if (context.state === "suspended") {
        await context.resume();
      }

      const source = context.createMediaStreamSource(stream);
      let processor: RecorderProcessor;
      let captureMode: RecorderState["captureMode"];
      try {
        if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") throw new Error("AudioWorklet unavailable");
        await context.audioWorklet.addModule("/recorder.worklet.js");
        processor = new AudioWorkletNode(context, "kid-reading-recorder", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1]
        });
        captureMode = "audio-worklet";
      } catch (error) {
        console.warn("AudioWorklet recorder could not start; using ScriptProcessor fallback.", error);
        processor = context.createScriptProcessor(4096, 1, 1);
        captureMode = "script-processor";
      }
      const state: RecorderState = {
        stream,
        context,
        source,
        processor,
        captureMode,
        flushCaptureResolve: null,
        vad: null,
        fallbackVad: {
          speaking: false,
          positiveFrames: 0,
          segmentStartChunk: 0,
          lastSpeechAt: 0
        },
        chunks: [],
        segments: [],
        startedAt: 0,
        capturing: false,
        recorderConnected: false,
        speechActive: false,
        audioInput
      };

      const captureChunk = (input: Float32Array) => {
        if (!state.capturing) return;
        const chunk = new Float32Array(input);
        state.chunks.push(chunk);
        if (!state.vad) {
          processFallbackVoiceFrame(state, chunk, this.callbacks);
        }
      };

      if (captureMode === "audio-worklet") {
        (processor as AudioWorkletNode).port.onmessage = (event: MessageEvent<{ type?: string; samples?: ArrayBuffer }>) => {
          if (event.data?.type === "audio" && event.data.samples) {
            captureChunk(new Float32Array(event.data.samples));
          }
          if (event.data?.type === "flushed") {
            state.flushCaptureResolve?.();
            state.flushCaptureResolve = null;
          }
        };
      } else {
        (processor as ScriptProcessorNode).onaudioprocess = (event) => captureChunk(event.inputBuffer.getChannelData(0));
      }

      try {
        const { MicVAD } = await import("@ricky0123/vad-web");
        state.vad = await MicVAD.new({
          audioContext: context,
          getStream: async () => stream,
          pauseStream: async () => undefined,
          resumeStream: async () => stream,
          startOnLoad: false,
          model: "legacy",
          baseAssetPath: "/vad/",
          onnxWASMBasePath: "/vad/",
          positiveSpeechThreshold: 0.58,
          negativeSpeechThreshold: 0.35,
          redemptionMs: 900,
          preSpeechPadMs: leadingPaddingMs,
          minSpeechMs: 280,
          submitUserSpeechOnPause: false,
          ortConfig: (ort) => {
            ort.env.wasm.numThreads = 1;
            ort.env.logLevel = "error";
          },
          onSpeechRealStart: () => {
            if (this.state !== state || !state.capturing) return;
            state.speechActive = true;
            this.callbacks.onSpeechStart?.();
          },
          onSpeechEnd: (audio) => {
            if (this.state !== state || !state.capturing || state.startedAt <= 0) return;
            captureSpeechSegment(state, audio, this.callbacks);
          },
          onVADMisfire: () => {
            if (this.state === state && state.capturing) {
              this.callbacks.onVADMisfire?.();
            }
          }
        });
      } catch (error) {
        console.warn("Neural VAD could not start; using the compatible audio-level fallback.", error);
        state.vad = null;
      }

      this.state = state;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  async start() {
    await this.prepare();
    const state = this.state;
    if (!state || state.capturing) return;

    state.chunks = [];
    state.segments = [];
    state.fallbackVad = { speaking: false, positiveFrames: 0, segmentStartChunk: 0, lastSpeechAt: 0 };
    state.startedAt = performance.now();
    state.capturing = true;
    state.speechActive = false;
    state.source.connect(state.processor);
    state.processor.connect(state.context.destination);
    state.recorderConnected = true;

    try {
      await state.vad?.start();
    } catch (error) {
      console.warn("Neural VAD failed during microphone startup; using the compatible audio-level fallback.", error);
      await state.vad?.destroy().catch(() => undefined);
      state.vad = null;
    }
  }

  async stop(): Promise<WavRecording> {
    const state = this.state;
    if (!state?.capturing) {
      throw new Error("Recorder has not started");
    }

    await delay(stopTailMs);
    await flushRecorderCapture(state);
    state.capturing = false;
    const rawDurationMs = performance.now() - state.startedAt;
    const inputSampleRate = state.context.sampleRate;
    this.state = null;

    disconnectRecorderNodes(state);
    await state.vad?.destroy().catch(() => undefined);
    state.stream.getTracks().forEach((track) => track.stop());

    const sourceSamples = mergeChunks(state.chunks);
    const capturedDurationMs = (sourceSamples.length / inputSampleRate) * 1000;
    const captureGapMs = Math.max(0, rawDurationMs - capturedDurationMs);
    const centered = removeDcOffset(sourceSamples);
    const resampled = resample(centered, inputSampleRate, outputSampleRate);
    await state.context.close().catch(() => undefined);

    const full = processRecording(resampled, inputSampleRate, rawDurationMs);
    full.quality.captureMode = state.captureMode;
    full.quality.capturedDurationMs = round(capturedDurationMs);
    full.quality.captureGapMs = round(captureGapMs);
    full.quality.audioInput = state.audioInput;
    assertRecordingQuality(full.quality, full.hasVoice, state.segments.length > 0 || state.speechActive);

    const candidates = state.segments.length > 1 ? buildAlternateCandidates(state.segments) : [];
    candidates.forEach((candidate) => {
      candidate.quality.audioInput = state.audioInput;
    });
    return {
      blob: encodeWav(normalizeQuietRecording(full.samples, full.quality.peak), outputSampleRate),
      durationMs: full.quality.processedDurationMs,
      quality: {
        ...full.quality,
        vadSegmentCount: state.segments.length,
        candidateCount: candidates.length + 1
      },
      candidates
    };
  }

  async cancel() {
    const state = this.state;
    if (!state) return;
    this.state = null;
    state.capturing = false;
    disconnectRecorderNodes(state);
    await state.vad?.destroy().catch(() => undefined);
    state.stream.getTracks().forEach((track) => track.stop());
    await state.context.close().catch(() => undefined);
  }
}

function processFallbackVoiceFrame(state: RecorderState, chunk: Float32Array, callbacks: WavRecorderCallbacks) {
  const frameRms = measureSamples(chunk).rms;
  const now = performance.now();
  const isStrongSpeech = frameRms >= 0.012;
  const isPossibleSpeech = frameRms >= 0.007;

  if (!state.fallbackVad.speaking) {
    state.fallbackVad.positiveFrames = isStrongSpeech ? state.fallbackVad.positiveFrames + 1 : 0;
    if (state.fallbackVad.positiveFrames >= 2) {
      state.fallbackVad.speaking = true;
      state.fallbackVad.segmentStartChunk = Math.max(0, state.chunks.length - 4);
      state.fallbackVad.lastSpeechAt = now;
      state.speechActive = true;
      callbacks.onSpeechStart?.();
    }
    return;
  }

  if (isPossibleSpeech) {
    state.fallbackVad.lastSpeechAt = now;
    return;
  }

  if (now - state.fallbackVad.lastSpeechAt < 900) return;
  const sourceSamples = mergeChunks(state.chunks.slice(state.fallbackVad.segmentStartChunk));
  const centered = removeDcOffset(sourceSamples);
  const audio = resample(centered, state.context.sampleRate, outputSampleRate);
  captureSpeechSegment(state, audio, callbacks);
  state.fallbackVad = { speaking: false, positiveFrames: 0, segmentStartChunk: state.chunks.length, lastSpeechAt: 0 };
}

function captureSpeechSegment(state: RecorderState, audio: Float32Array, callbacks: WavRecorderCallbacks) {
  const endedAtMs = performance.now() - state.startedAt;
  const durationMs = (audio.length / outputSampleRate) * 1000;
  const voiceDurationMs = trimAndInspect(audio, outputSampleRate).voiceDurationMs;
  const segment: CapturedSpeechSegment = {
    id: `segment-${state.segments.length + 1}`,
    startedAtMs: round(Math.max(0, endedAtMs - durationMs)),
    endedAtMs: round(endedAtMs),
    durationMs: round(durationMs),
    voiceDurationMs: round(voiceDurationMs),
    samples: new Float32Array(audio)
  };
  state.segments.push(segment);
  state.speechActive = false;
  callbacks.onSpeechEnd?.(toSegmentSummary(segment), state.segments.map(toSegmentSummary));
}

function buildAlternateCandidates(segments: CapturedSpeechSegment[]) {
  const candidates: RecordingCandidate[] = [];
  const latestSegments = segments.slice(-maxAlternateCandidates).reverse();

  for (const segment of latestSegments) {
    const processed = processRecording(removeDcOffset(segment.samples), outputSampleRate, segment.durationMs);
    try {
      assertRecordingQuality(processed.quality, processed.hasVoice, true);
    } catch {
      continue;
    }

    candidates.push({
      ...toSegmentSummary(segment),
      kind: "speech-segment",
      durationMs: processed.quality.processedDurationMs,
      quality: processed.quality,
      blob: encodeWav(normalizeQuietRecording(processed.samples, processed.quality.peak), outputSampleRate)
    });
  }

  return candidates;
}

function processRecording(samples: Float32Array, inputSampleRate: number, rawDurationMs: number) {
  const processed = trimAndInspect(samples, outputSampleRate);
  const quality: RecordingQuality = {
    inputSampleRate,
    rawDurationMs: round(rawDurationMs),
    processedDurationMs: round((processed.samples.length / outputSampleRate) * 1000),
    voiceDurationMs: round(processed.voiceDurationMs),
    peak: round(processed.peak, 4),
    rms: round(processed.rms, 4),
    silenceTrimmedMs: round(Math.max(0, rawDurationMs - (processed.samples.length / outputSampleRate) * 1000))
  };

  return { ...processed, quality };
}

function assertRecordingQuality(quality: RecordingQuality, hasVoice: boolean, confirmedSpeech: boolean) {
  const allowedCaptureGapMs = Math.max(captureGapMinimumMs, quality.rawDurationMs * captureGapMaximumRatio);
  if (Number(quality.captureGapMs || 0) > allowedCaptureGapMs) {
    throw new RecordingQualityError("capture-gap");
  }
  if (!confirmedSpeech) {
    throw new RecordingQualityError("no-speech");
  }
  if (quality.peak < 0.02 || quality.rms < 0.005 || !hasVoice) {
    throw new RecordingQualityError("too-quiet");
  }
  if (quality.voiceDurationMs < 350 || quality.processedDurationMs < 500) {
    throw new RecordingQualityError("too-short");
  }
}

function toSegmentSummary(segment: CapturedSpeechSegment): SpeechSegmentSummary {
  return {
    id: segment.id,
    startedAtMs: segment.startedAtMs,
    endedAtMs: segment.endedAtMs,
    durationMs: segment.durationMs,
    voiceDurationMs: segment.voiceDurationMs
  };
}

function disconnectRecorderNodes(state: RecorderState) {
  if (!state.recorderConnected) return;
  state.processor.disconnect();
  if (state.captureMode === "audio-worklet") {
    (state.processor as AudioWorkletNode).port.onmessage = null;
    (state.processor as AudioWorkletNode).port.close();
  } else {
    (state.processor as ScriptProcessorNode).onaudioprocess = null;
  }
  state.source.disconnect();
  state.recorderConnected = false;
}

async function flushRecorderCapture(state: RecorderState) {
  if (state.captureMode !== "audio-worklet") return;
  const processor = state.processor as AudioWorkletNode;
  await Promise.race([
    new Promise<void>((resolve) => {
      state.flushCaptureResolve = resolve;
      processor.port.postMessage({ type: "flush" });
    }),
    delay(150)
  ]);
  state.flushCaptureResolve = null;
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));
}

function mergeChunks(chunks: Float32Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
}

function removeDcOffset(samples: Float32Array) {
  if (samples.length === 0) return samples;
  let sum = 0;
  for (const sample of samples) sum += sample;
  const mean = sum / samples.length;
  const centered = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    centered[index] = samples[index] - mean;
  }
  return centered;
}

function resample(samples: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate || samples.length === 0) return samples;
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);

  if (inputRate > outputRate) {
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = outputIndex * ratio;
      const end = Math.min(samples.length, (outputIndex + 1) * ratio);
      const firstSourceIndex = Math.floor(start);
      const lastSourceIndex = Math.min(samples.length - 1, Math.ceil(end) - 1);
      let weightedSum = 0;
      let totalWeight = 0;
      for (let sourceIndex = firstSourceIndex; sourceIndex <= lastSourceIndex; sourceIndex += 1) {
        const overlap = Math.max(0, Math.min(end, sourceIndex + 1) - Math.max(start, sourceIndex));
        weightedSum += samples[sourceIndex] * overlap;
        totalWeight += overlap;
      }
      output[outputIndex] = totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
    return output;
  }

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourceIndex = outputIndex * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = sourceIndex - left;
    output[outputIndex] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return output;
}

function trimAndInspect(samples: Float32Array, sampleRate: number) {
  const frameSize = Math.max(1, Math.round((sampleRate * analysisFrameMs) / 1000));
  const frameRms: number[] = [];
  let peak = 0;
  let sumSquares = 0;

  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let frameSumSquares = 0;
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
      const square = samples[index] * samples[index];
      frameSumSquares += square;
      sumSquares += square;
    }
    frameRms.push(Math.sqrt(frameSumSquares / Math.max(1, end - start)));
  }

  const sortedRms = [...frameRms].sort((left, right) => left - right);
  const noiseFloor = sortedRms[Math.floor(sortedRms.length * 0.2)] || 0;
  const strongestFrame = sortedRms.at(-1) || 0;
  const voiceThreshold = Math.min(strongestFrame * 0.5, Math.max(0.0045, noiseFloor * 2.5, strongestFrame * 0.08));
  const voiceFrames = frameRms.map((value, index) => ({ value, index })).filter((frame) => frame.value >= voiceThreshold);

  if (voiceFrames.length === 0) {
    return {
      samples,
      voiceDurationMs: 0,
      peak,
      rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
      hasVoice: false
    };
  }

  const leadingFrames = Math.ceil(leadingPaddingMs / analysisFrameMs);
  const trailingFrames = Math.ceil(trailingPaddingMs / analysisFrameMs);
  const trimStart = Math.max(0, (voiceFrames[0].index - leadingFrames) * frameSize);
  const trimEnd = Math.min(samples.length, (voiceFrames.at(-1)!.index + trailingFrames + 1) * frameSize);
  const trimmedSamples = samples.slice(trimStart, trimEnd);
  const trimmedMetrics = measureSamples(trimmedSamples);

  return {
    samples: trimmedSamples,
    voiceDurationMs: voiceFrames.length * analysisFrameMs,
    peak: trimmedMetrics.peak,
    rms: trimmedMetrics.rms,
    hasVoice: true
  };
}

function measureSamples(samples: Float32Array) {
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  return { peak, rms: Math.sqrt(sumSquares / Math.max(1, samples.length)) };
}

function normalizeQuietRecording(samples: Float32Array, peak: number) {
  if (peak <= 0 || peak >= 0.55) return samples;
  const gain = Math.min(2, 0.72 / peak);
  if (gain <= 1.05) return samples;
  const normalized = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    normalized[index] = Math.max(-1, Math.min(1, samples[index] * gain));
  }
  return normalized;
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
