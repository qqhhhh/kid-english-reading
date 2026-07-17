import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { nanoid } from "nanoid";

import type { AudioSignalComparison, AudioSignalMetrics } from "./audioSignal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export interface SpeechEnhancementStatus {
  provider: string;
  enabled: boolean;
  abComparison: boolean;
}

export interface SpeechEnhancementMetadata extends Partial<AudioSignalComparison> {
  provider: string;
  applied: boolean;
  model?: string;
  processingMs?: number;
  levelGainDb?: number;
  preGainOutput?: AudioSignalMetrics;
  error?: string;
}

export interface SpeechEnhancementResult {
  audio: Buffer;
  metadata: SpeechEnhancementMetadata;
}

interface WorkerReadyMessage {
  type: "ready";
  sampleRate: number;
}

interface WorkerResultMessage {
  type: "result";
  id: string;
  audio: ArrayBuffer;
  metrics: SpeechEnhancementMetadata;
}

interface WorkerErrorMessage {
  type: "error";
  id: string;
  error?: string;
}

type EnhancementWorkerMessage = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage;

interface EnhancementJob {
  resolve(message: WorkerResultMessage): void;
  reject(error: Error): void;
}

interface EnhancementWorkerState {
  worker: Worker;
  jobs: Map<string, EnhancementJob>;
  ready: Promise<WorkerReadyMessage>;
}

let workerState: EnhancementWorkerState | null = null;

export function getSpeechEnhancementStatus(): SpeechEnhancementStatus {
  const provider = process.env.SPEECH_ENHANCEMENT_PROVIDER || "disabled";
  return {
    provider,
    enabled: provider === "gtcrn",
    abComparison: process.env.SPEECH_ENHANCEMENT_AB === "1"
  };
}

export async function enhanceSpeech(audio: Buffer): Promise<SpeechEnhancementResult> {
  const provider = process.env.SPEECH_ENHANCEMENT_PROVIDER || "disabled";
  if (provider !== "gtcrn" || !audio?.length) {
    return { audio, metadata: { provider, applied: false } };
  }

  const state = ensureWorker();
  await state.ready;
  const id = nanoid();
  const arrayBuffer = new ArrayBuffer(audio.byteLength);
  new Uint8Array(arrayBuffer).set(audio);
  return new Promise<SpeechEnhancementResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.jobs.delete(id);
      reject(new Error("Speech enhancement timed out"));
    }, 12000);
    state.jobs.set(id, {
      resolve: (message) => {
        clearTimeout(timeout);
        resolve({ audio: Buffer.from(message.audio), metadata: message.metrics });
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });
    state.worker.postMessage({ id, audio: arrayBuffer }, [arrayBuffer]);
  });
}

function ensureWorker(): EnhancementWorkerState {
  if (workerState) return workerState;
  const localModelPath = path.join(__dirname, "models", "gtcrn_simple.onnx");
  const sourceModelPath = path.resolve(__dirname, "..", "..", "server", "models", "gtcrn_simple.onnx");
  const worker = new Worker(new URL("./speechEnhancementWorker.js", import.meta.url), {
    workerData: {
      modelPath: process.env.SPEECH_ENHANCEMENT_MODEL || (existsSync(localModelPath) ? localModelPath : sourceModelPath)
    }
  });
  worker.unref();
  const jobs = new Map<string, EnhancementJob>();
  let settleReady!: (message: WorkerReadyMessage) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<WorkerReadyMessage>((resolve, reject) => {
    settleReady = resolve;
    rejectReady = reject;
  });
  const state = { worker, jobs, ready };
  workerState = state;

  worker.on("message", (message: EnhancementWorkerMessage) => {
    if (message.type === "ready") {
      settleReady(message);
      return;
    }
    const job = jobs.get(message.id);
    if (!job) return;
    jobs.delete(message.id);
    if (message.type === "result") job.resolve(message);
    else job.reject(new Error(message.error || "Speech enhancement failed"));
  });
  worker.on("error", (error) => resetWorker(state, error, rejectReady));
  worker.on("exit", (code) => {
    if (code !== 0) resetWorker(state, new Error(`Speech enhancement worker exited with code ${code}`), rejectReady);
  });
  return state;
}

function resetWorker(
  state: EnhancementWorkerState,
  error: Error,
  rejectReady: (error: Error) => void
): void {
  if (workerState !== state) return;
  workerState = null;
  rejectReady(error);
  for (const job of state.jobs.values()) job.reject(error);
  state.jobs.clear();
}
