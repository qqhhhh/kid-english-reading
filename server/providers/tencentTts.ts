import crypto from "node:crypto";

import type { TtsSynthesisRequest, TtsSynthesisResult, TtsVoice } from "../types/providers.js";

const TENCENT_TTS_HOST = "tts.tencentcloudapi.com";
const TENCENT_TTS_SERVICE = "tts";
const TENCENT_TTS_VERSION = "2019-08-23";
const TENCENT_TTS_ACTION = "TextToVoice";

interface TencentTtsBody {
  Text: string;
  SessionId: string;
  ModelType: number;
  VoiceType: number;
  Codec: string;
  SampleRate: number;
  Speed: number;
  Volume: number;
  PrimaryLanguage: number;
  EnableSubtitle?: boolean;
}

interface TencentTtsResponse {
  Response?: {
    Audio?: string;
    Subtitles?: unknown[];
    Error?: { Code?: string; Message?: string };
  };
}

interface TencentTtsApiRequest {
  body: TencentTtsBody;
  secretId: string;
  secretKey: string;
  timestamp: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Tencent TTS provider`);
  }
  return value;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: crypto.BinaryLike, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function hmacSha256Hex(key: crypto.BinaryLike, value: string): string {
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

function buildAuthorization({
  secretId,
  secretKey,
  timestamp,
  payload
}: Omit<TencentTtsApiRequest, "body"> & { payload: string }): string {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_TTS_HOST}\nx-tc-action:${TENCENT_TTS_ACTION.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(payload)].join("\n");
  const credentialScope = `${date}/${TENCENT_TTS_SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, TENCENT_TTS_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256Hex(secretSigning, stringToSign);

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function requestTencentTts({
  body,
  secretId,
  secretKey,
  timestamp
}: TencentTtsApiRequest): Promise<TencentTtsResponse> {
  const payload = JSON.stringify(body);
  const response = await fetch(`https://${TENCENT_TTS_HOST}`, {
    method: "POST",
    headers: {
      Authorization: buildAuthorization({ secretId, secretKey, timestamp, payload }),
      "Content-Type": "application/json; charset=utf-8",
      Host: TENCENT_TTS_HOST,
      "X-TC-Action": TENCENT_TTS_ACTION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": TENCENT_TTS_VERSION,
      "X-TC-Region": process.env.TENCENT_TTS_REGION || "ap-guangzhou"
    },
    body: payload
  });
  const data = await response.json() as TencentTtsResponse;

  if (!response.ok || data.Response?.Error) {
    const error = data.Response?.Error;
    throw new Error(`Tencent TTS error ${error?.Code || response.status}: ${error?.Message || response.statusText}`);
  }

  return data;
}

export async function synthesizeWithTencent({
  text,
  sentenceId,
  voice
}: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
  const secretId = requiredEnv("TENCENT_SECRET_ID");
  const secretKey = requiredEnv("TENCENT_SECRET_KEY");
  const timestamp = Math.floor(Date.now() / 1000);
  const baseBody = {
    Text: text,
    SessionId: sentenceId,
    ModelType: Number(voice?.modelType || process.env.TENCENT_TTS_MODEL_TYPE || 1),
    VoiceType: Number(voice?.voiceType || process.env.TENCENT_TTS_VOICE_TYPE || 501009),
    Codec: process.env.TENCENT_TTS_CODEC || "mp3",
    SampleRate: Number(process.env.TENCENT_TTS_SAMPLE_RATE || 16000),
    Speed: Number(process.env.TENCENT_TTS_SPEED || 0),
    Volume: Number(process.env.TENCENT_TTS_VOLUME || 0),
    PrimaryLanguage: Number(voice?.primaryLanguage || process.env.TENCENT_TTS_PRIMARY_LANGUAGE || 2)
  };

  const wantsSubtitles = process.env.TENCENT_TTS_ENABLE_SUBTITLE !== "false";
  const body = wantsSubtitles ? { ...baseBody, EnableSubtitle: true } : baseBody;
  let data: TencentTtsResponse;
  let subtitleFallback = false;
  try {
    data = await requestTencentTts({ body, secretId, secretKey, timestamp });
  } catch (error: unknown) {
    if (!wantsSubtitles) {
      throw error;
    }
    subtitleFallback = true;
    console.warn(
      `[tts] provider=tencent voice=${baseBody.VoiceType} model=${baseBody.ModelType} sentence=${sentenceId} enableSubtitle=true failed="${error instanceof Error ? error.message : String(error)}" fallback=true`
    );
    data = await requestTencentTts({ body: baseBody, secretId, secretKey, timestamp });
  }

  const audio = data.Response?.Audio;
  if (!audio) {
    throw new Error("Tencent TTS response did not include audio");
  }

  return {
    audio: Buffer.from(audio, "base64"),
    subtitles: Array.isArray(data.Response?.Subtitles) ? data.Response.Subtitles : [],
    subtitleFallback,
    contentType: baseBody.Codec === "wav" ? "audio/wav" : "audio/mpeg",
    extension: baseBody.Codec === "wav" ? "wav" : "mp3"
  };
}
