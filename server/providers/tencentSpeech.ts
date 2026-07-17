import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { nanoid } from "nanoid";

import type {
  ProviderAssessmentResult,
  ProviderPhoneResult,
  ProviderWordResult,
  SpeechAssessmentRequest,
  SpeechAssessmentItemType
} from "../types/providers.js";

const TENCENT_HOST = "soe.cloud.tencent.com";
const TENCENT_PATH = "/soe/api";

interface TencentRawPhone {
  Phone?: unknown;
  ReferencePhone?: unknown;
  ReferenceLetter?: unknown;
  PronAccuracy?: unknown;
  MatchTag?: unknown;
  MemBeginTime?: unknown;
  MemEndTime?: unknown;
}

interface TencentRawWord {
  Word?: unknown;
  ReferenceWord?: unknown;
  PronAccuracy?: unknown;
  PronFluency?: unknown;
  MatchTag?: unknown;
  MemBeginTime?: unknown;
  MemEndTime?: unknown;
  PhoneInfos?: TencentRawPhone[];
}

interface TencentRawResult {
  SuggestedScore?: unknown;
  PronAccuracy?: unknown;
  PronFluency?: unknown;
  PronCompletion?: unknown;
  Words?: TencentRawWord[];
}

interface TencentSocketMessage {
  code?: unknown;
  message?: unknown;
  result?: unknown;
  final?: unknown;
}

interface TencentSpeechAttempt extends SpeechAssessmentRequest {
  attempt: number;
}

interface TencentSpeechError extends Error {
  providerCode: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Tencent speech provider`);
  }
  return value;
}

function signTencentUrl(appId: string, secretKey: string, params: Record<string, string>): string {
  const sortedQuery = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const source = `${TENCENT_HOST}${TENCENT_PATH}/${appId}?${sortedQuery}`;
  return crypto.createHmac("sha1", secretKey).update(source).digest("base64");
}

export function buildTencentUrl({
  referenceText,
  streaming = false,
  itemType = "sentence"
}: Pick<SpeechAssessmentRequest, "referenceText"> & { streaming?: boolean; itemType?: SpeechAssessmentItemType }): string {
  const appId = requiredEnv("TENCENT_APP_ID");
  const secretId = requiredEnv("TENCENT_SECRET_ID");
  const secretKey = requiredEnv("TENCENT_SECRET_KEY");
  const now = Math.floor(Date.now() / 1000);
  const evalMode = itemType === "word" ? (streaming ? "7" : "0") : itemType === "paragraph" ? "2" : "1";
  const params = {
    eval_mode: evalMode,
    expired: String(now + 3600),
    nonce: String(Math.floor(Math.random() * 1000000000)),
    rec_mode: streaming ? "0" : "1",
    ref_text: referenceText,
    score_coeff: process.env.TENCENT_SCORE_COEFF || "1.0",
    secretid: secretId,
    sentence_info_enabled: streaming ? "1" : "0",
    server_engine_type: process.env.TENCENT_ENGINE_TYPE || "16k_en",
    text_mode: "0",
    timestamp: String(now),
    voice_format: "1",
    voice_id: nanoid()
  };
  const signature = signTencentUrl(appId, secretKey, params);
  const requestParams = new URLSearchParams({ ...params, signature });
  return `wss://${TENCENT_HOST}${TENCENT_PATH}/${appId}?${requestParams.toString()}`;
}

export function normalizeTencentResult(result: unknown): ProviderAssessmentResult {
  if (!result || typeof result !== "object") {
    throw new Error("Tencent response did not include an assessment result");
  }
  const raw = result as TencentRawResult;

  return {
    SuggestedScore: Number(raw.SuggestedScore || 0),
    PronAccuracy: Number(raw.PronAccuracy || 0),
    PronFluency: Number(raw.PronFluency || 0),
    PronCompletion: Number(raw.PronCompletion || 0),
    Words: Array.isArray(raw.Words)
      ? raw.Words.map((word): ProviderWordResult => ({
          Word: String(word.Word || ""),
          ReferenceWord: String(word.ReferenceWord || word.Word || ""),
          PronAccuracy: Number(word.PronAccuracy || 0),
          PronFluency: Number(word.PronFluency || 0),
          MatchTag: Number(word.MatchTag || 0),
          MemBeginTime: Number(word.MemBeginTime || 0),
          MemEndTime: Number(word.MemEndTime || 0),
          PhoneInfos: Array.isArray(word.PhoneInfos)
            ? word.PhoneInfos.map((phone): ProviderPhoneResult => ({
                Phone: String(phone.Phone || ""),
                ReferencePhone: String(phone.ReferencePhone || ""),
                ReferenceLetter: String(phone.ReferenceLetter || ""),
                PronAccuracy: Number(phone.PronAccuracy || 0),
                MatchTag: Number(phone.MatchTag || 0),
                MemBeginTime: Number(phone.MemBeginTime || 0),
                MemEndTime: Number(phone.MemEndTime || 0)
              }))
            : []
        }))
      : []
  };
}

export interface TencentStreamingAssessmentSession {
  sendAudio(audio: Buffer): void;
  finish(): void;
  cancel(): void;
}

export function createTencentStreamingAssessment({
  referenceText,
  itemType,
  onResult,
  onError
}: {
  referenceText: string;
  itemType: SpeechAssessmentItemType;
  onResult: (result: ProviderAssessmentResult, isFinal: boolean) => void;
  onError: (error: Error) => void;
}): TencentStreamingAssessmentSession {
  const socket = new WebSocket(buildTencentUrl({ referenceText, streaming: true, itemType }));
  const pendingAudio: Buffer[] = [];
  let pendingAudioBytes = 0;
  let opened = false;
  let ending = false;
  let settled = false;
  let latestResult: unknown = null;
  const timeout = setTimeout(() => fail(new Error("Tencent streaming speech provider timed out")), 70_000);

  function closeSocket() {
    clearTimeout(timeout);
    try {
      socket.close();
    } catch {
      // Socket may already be closed.
    }
  }

  function fail(error: Error) {
    if (settled) return;
    settled = true;
    closeSocket();
    onError(error);
  }

  function sendEnd() {
    if (!opened || settled) return;
    socket.send(JSON.stringify({ type: "end" }));
  }

  socket.addEventListener("open", () => {
    if (settled) return;
    opened = true;
    console.info(`[speech-live] provider=tencent status=open refChars=${referenceText.length} itemType=${itemType}`);
    for (const chunk of pendingAudio.splice(0)) socket.send(chunk);
    pendingAudioBytes = 0;
    if (ending) sendEnd();
  });

  socket.addEventListener("message", async (event) => {
    try {
      const message = await parseTencentMessage(event.data);
      if (message.code !== undefined && Number(message.code) !== 0) {
        fail(createTencentSpeechError(message.code, message.message));
        return;
      }
      if (message.result) {
        latestResult = typeof message.result === "string" ? JSON.parse(message.result) : message.result;
        onResult(normalizeTencentResult(latestResult), Number(message.final) === 1);
      }
      if (Number(message.final) === 1 && !settled) {
        settled = true;
        closeSocket();
      }
    } catch (error: unknown) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });

  socket.addEventListener("error", (event) => {
    const details = event as Event & { message?: string; error?: unknown };
    const message = details.message || (details.error instanceof Error ? details.error.message : "Tencent streaming WebSocket error");
    fail(new Error(message));
  });

  socket.addEventListener("close", (event) => {
    if (!settled) fail(new Error(`Tencent streaming WebSocket closed early (${event.code || "unknown"})`));
  });

  return {
    sendAudio(audio) {
      if (settled || ending || !audio.length) return;
      if (opened) {
        socket.send(audio);
        return;
      }
      if (pendingAudioBytes + audio.length > 2 * 1024 * 1024) {
        fail(new Error("Tencent streaming audio buffer exceeded its limit"));
        return;
      }
      pendingAudio.push(Buffer.from(audio));
      pendingAudioBytes += audio.length;
    },
    finish() {
      if (settled || ending) return;
      ending = true;
      sendEnd();
    },
    cancel() {
      if (settled) return;
      settled = true;
      closeSocket();
    }
  };
}

async function parseTencentMessage(data: unknown): Promise<TencentSocketMessage> {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = Buffer.from(data).toString("utf8");
  } else if (ArrayBuffer.isView(data)) {
    text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  } else if (
    data !== null &&
    typeof data === "object" &&
    "text" in data &&
    typeof data.text === "function"
  ) {
    text = await (data.text as () => Promise<string>)();
  } else if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    text = Buffer.from(data).toString("utf8");
  } else {
    text = String(data);
  }
  return JSON.parse(text) as TencentSocketMessage;
}

function createTencentSpeechError(code: unknown, message: unknown): TencentSpeechError {
  const error = new Error(`Tencent speech error ${code}: ${message || "unknown"}`) as TencentSpeechError;
  error.providerCode = Number(code);
  return error;
}

export async function withTencentNoAudioRetry<T>(
  operation: (attempt: number) => Promise<T>,
  retryDelayMs = 180
): Promise<T> {
  try {
    return await operation(1);
  } catch (error: unknown) {
    if (Number((error as Partial<TencentSpeechError> | null)?.providerCode) !== 4008) throw error;
    console.warn("[speech] provider=tencent status=retry reason=no-audio-timeout attempt=2");
    await delay(retryDelayMs);
    return operation(2);
  }
}

async function assessWithTencentOnce({
  audio,
  referenceText,
  itemType = "sentence",
  attempt
}: TencentSpeechAttempt): Promise<ProviderAssessmentResult> {
  if (!audio?.length) {
    throw new Error("audio is required for Tencent speech provider");
  }

  const url = buildTencentUrl({ referenceText, itemType });
  const socket = new WebSocket(url);
  let latestResult: unknown = null;
  let settled = false;

  return new Promise<ProviderAssessmentResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Tencent speech provider timed out")));
    }, 70000);

    function finish(callback: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // Socket may already be closed by the provider.
      }
      callback();
    }

    socket.addEventListener("open", async () => {
      try {
        console.info(
          `[speech] provider=tencent status=open attempt=${attempt} audioBytes=${audio.length} refChars=${referenceText.length} itemType=${itemType} evalMode=${itemType === "word" ? 0 : itemType === "paragraph" ? 2 : 1} engine=${
            process.env.TENCENT_ENGINE_TYPE || "16k_en"
          }`
        );
        await delay(20);
        socket.send(audio);
        socket.send(JSON.stringify({ type: "end" }));
      } catch (error: unknown) {
        finish(() => reject(error));
      }
    });

    socket.addEventListener("message", async (event) => {
      try {
        const message = await parseTencentMessage(event.data);
        if (message.code !== undefined && Number(message.code) !== 0) {
          finish(() => reject(createTencentSpeechError(message.code, message.message)));
          return;
        }

        if (message.result) {
          latestResult = typeof message.result === "string" ? JSON.parse(message.result) : message.result;
        }

        if (Number(message.final) === 1) {
          console.info("[speech] provider=tencent status=final");
          finish(() => resolve(normalizeTencentResult(latestResult)));
        }
      } catch (error: unknown) {
        finish(() => reject(error));
      }
    });

    socket.addEventListener("error", (event) => {
      const details = event as Event & { message?: string; error?: unknown };
      const message = details.message || (details.error instanceof Error ? details.error.message : "unknown");
      console.error(`[speech] provider=tencent status=websocket-error message="${message}"`);
      finish(() =>
        reject(new Error(message === "unknown" ? "Tencent speech WebSocket error" : `Tencent speech WebSocket error: ${message}`))
      );
    });

    socket.addEventListener("close", (event) => {
      if (settled) return;
      const reason = event.reason ? ` reason="${event.reason}"` : "";
      console.error(`[speech] provider=tencent status=closed-before-final code=${event.code}${reason}`);
      finish(() => reject(new Error(`Tencent speech WebSocket closed before final result (code ${event.code || "unknown"})`)));
    });
  });
}

export async function assessWithTencent({
  audio,
  referenceText,
  itemType = "sentence"
}: SpeechAssessmentRequest): Promise<ProviderAssessmentResult> {
  return withTencentNoAudioRetry((attempt) => assessWithTencentOnce({ audio, referenceText, itemType, attempt }));
}
