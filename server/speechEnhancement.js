import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { nanoid } from "nanoid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let workerState = null;

export function getSpeechEnhancementStatus() {
  const provider = process.env.SPEECH_ENHANCEMENT_PROVIDER || "disabled";
  return {
    provider,
    enabled: provider === "gtcrn",
    abComparison: process.env.SPEECH_ENHANCEMENT_AB === "1"
  };
}

export async function enhanceSpeech(audio) {
  const provider = process.env.SPEECH_ENHANCEMENT_PROVIDER || "disabled";
  if (provider !== "gtcrn" || !audio?.length) {
    return { audio, metadata: { provider, applied: false } };
  }

  const state = ensureWorker();
  await state.ready;
  const id = nanoid();
  const arrayBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
  return new Promise((resolve, reject) => {
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

function ensureWorker() {
  if (workerState) return workerState;
  const worker = new Worker(new URL("./speechEnhancementWorker.js", import.meta.url), {
    workerData: {
      modelPath: process.env.SPEECH_ENHANCEMENT_MODEL || path.join(__dirname, "models", "gtcrn_simple.onnx")
    }
  });
  worker.unref();
  const jobs = new Map();
  let settleReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    settleReady = resolve;
    rejectReady = reject;
  });
  const state = { worker, jobs, ready };
  workerState = state;

  worker.on("message", (message) => {
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

function resetWorker(state, error, rejectReady) {
  if (workerState !== state) return;
  workerState = null;
  rejectReady(error);
  for (const job of state.jobs.values()) job.reject(error);
  state.jobs.clear();
}
