import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { XMLParser } from "fast-xml-parser";

import type {
  ProviderAssessmentResult,
  ProviderPhoneResult,
  ProviderWordResult,
  SpeechAssessmentRequest
} from "../types/providers.js";

const XFYUN_HOST = "ise-api.xfyun.cn";
const XFYUN_PATH = "/v2/open-ise";
const XFYUN_URL = `wss://${XFYUN_HOST}${XFYUN_PATH}`;
const audioFrameBytes = 1_280;
const frameIntervalMs = 40;
const xfyunFrameMs = 10;

const xfyunPhoneToIpa: Readonly<Record<string, string>> = Object.freeze({
  aa: "ɑː", ae: "æ", ah: "ʌ", ao: "ɔː", ar: "eə", aw: "aʊ", ax: "ə", ay: "aɪ",
  eh: "e", er: "ɜː", ey: "eɪ", ih: "ɪ", ir: "ɪə", iy: "iː", oo: "ɒ", ow: "əʊ",
  oy: "ɒɪ", uh: "ʊ", ur: "ʊə", uw: "uː", ng: "ŋ", sh: "ʃ", zh: "ʒ", th: "θ",
  dh: "ð", ch: "tʃ", jh: "dʒ"
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  trimValues: true
});

interface XfyunPhoneNode {
  content?: unknown;
  beg_pos?: unknown;
  end_pos?: unknown;
  dp_message?: unknown;
}

interface XfyunSyllableNode {
  content?: unknown;
  syll_score?: unknown;
  phone?: XfyunPhoneNode | XfyunPhoneNode[];
}

interface XfyunWordNode {
  content?: unknown;
  total_score?: unknown;
  beg_pos?: unknown;
  end_pos?: unknown;
  dp_message?: unknown;
  property?: unknown;
  syll?: XfyunSyllableNode | XfyunSyllableNode[];
}

interface XfyunSentenceNode {
  word?: XfyunWordNode | XfyunWordNode[];
}

interface XfyunAssessmentNode {
  total_score?: unknown;
  accuracy_score?: unknown;
  fluency_score?: unknown;
  integrity_score?: unknown;
  except_info?: unknown;
  is_rejected?: unknown;
  content?: unknown;
  sentence?: XfyunSentenceNode | XfyunSentenceNode[];
}

interface XfyunSocketMessage {
  code?: unknown;
  message?: unknown;
  data?: { status?: unknown; data?: unknown };
}

interface WavFormat {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for XFYUN speech provider`);
  return value;
}

function finiteNumber(value: unknown, fallback: unknown = 0): number {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  return Number.isFinite(number) ? number : Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: unknown, digits = 2): number {
  return Number(finiteNumber(value).toFixed(digits));
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function buildXfyunUrl(apiKey: string, apiSecret: string): string {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${XFYUN_HOST}\ndate: ${date}\nGET ${XFYUN_PATH} HTTP/1.1`;
  const signature = crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");
  const query = new URLSearchParams({ authorization, date, host: XFYUN_HOST });
  return `${XFYUN_URL}?${query.toString()}`;
}

function extractPcmData(wav: Buffer): Buffer {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("XFYUN speech provider requires a PCM WAV recording");
  }
  let offset = 12;
  let format: WavFormat | undefined;
  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    const chunkOffset = offset + 8;
    if (chunkOffset + chunkSize > wav.length) throw new Error("Invalid WAV chunk size");
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: wav.readUInt16LE(chunkOffset),
        channels: wav.readUInt16LE(chunkOffset + 2),
        sampleRate: wav.readUInt32LE(chunkOffset + 4),
        bitsPerSample: wav.readUInt16LE(chunkOffset + 14)
      };
    }
    if (chunkId === "data") {
      if (!format || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16_000 || format.bitsPerSample !== 16) {
        throw new Error("XFYUN speech provider requires 16 kHz mono 16-bit PCM WAV audio");
      }
      return wav.subarray(chunkOffset, chunkOffset + chunkSize);
    }
    offset = chunkOffset + chunkSize + (chunkSize % 2);
  }
  throw new Error("WAV recording did not include an audio data chunk");
}

function mapDpMessage(value: unknown): number {
  switch (finiteNumber(value)) {
    case 0:
      return 0;
    case 16:
      return 2;
    case 32:
    case 64:
      return 1;
    case 128:
      return 3;
    default:
      return 4;
  }
}

function isNoiseToken(value: unknown): boolean {
  return ["sil", "silv", "fil"].includes(String(value || "").trim().toLowerCase());
}

function findAssessmentNode(value: unknown): XfyunAssessmentNode | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.total_score !== undefined && record.sentence !== undefined && record.content !== undefined) {
    return record as XfyunAssessmentNode;
  }
  for (const child of Object.values(record)) {
    if (!child || typeof child !== "object") continue;
    const found = findAssessmentNode(child);
    if (found) return found;
  }
  return null;
}

function normalizePhone(
  phone: XfyunPhoneNode,
  syllableScore: number,
  wordMatchTag: number
): ProviderPhoneResult {
  const source = String(phone?.content || "").trim().toLowerCase();
  const begin = finiteNumber(phone?.beg_pos) * xfyunFrameMs;
  const end = finiteNumber(phone?.end_pos) * xfyunFrameMs;
  return {
    Phone: xfyunPhoneToIpa[source] || source,
    ReferencePhone: xfyunPhoneToIpa[source] || source,
    ReferenceLetter: "",
    PronAccuracy: round(syllableScore),
    MatchTag: wordMatchTag === 0 ? mapDpMessage(phone?.dp_message) : wordMatchTag,
    MemBeginTime: begin,
    MemEndTime: end
  };
}

function normalizeWord(word: XfyunWordNode, globalFluency: number): ProviderWordResult {
  const value = String(word?.content || "").trim();
  const matchTag = mapDpMessage(word?.dp_message);
  const begin = finiteNumber(word?.beg_pos) * xfyunFrameMs;
  const end = finiteNumber(word?.end_pos) * xfyunFrameMs;
  const syllables = asArray(word?.syll).filter((syllable) => !isNoiseToken(syllable?.content));
  const phoneInfos = syllables.flatMap((syllable) => {
    const syllableScore = clamp(finiteNumber(syllable?.syll_score, word?.total_score), 0, 100);
    return asArray(syllable?.phone)
      .filter((phone) => !isNoiseToken(phone?.content))
      .map((phone) => normalizePhone(phone, syllableScore, matchTag));
  });
  return {
    Word: value,
    ReferenceWord: matchTag === 1 ? "*" : value,
    PronAccuracy: round(clamp(finiteNumber(word?.total_score), 0, 100)),
    PronFluency: round(globalFluency / 100, 3),
    MatchTag: matchTag,
    ProviderDpMessage: finiteNumber(word?.dp_message),
    ProviderProperty: finiteNumber(word?.property),
    MemBeginTime: begin,
    MemEndTime: end,
    PhoneInfos: phoneInfos
  };
}

export function normalizeXfyunResult(xml: unknown): ProviderAssessmentResult {
  const parsed: unknown = typeof xml === "string" ? parser.parse(xml) : xml;
  const assessment = findAssessmentNode(parsed);
  if (!assessment) throw new Error("XFYUN response did not include an English sentence assessment result");

  const providerScore = clamp(finiteNumber(assessment.total_score), 0, 100);
  const accuracy = clamp(finiteNumber(assessment.accuracy_score, providerScore), 0, 100);
  const fluency = clamp(finiteNumber(assessment.fluency_score, providerScore), 0, 100);
  const completion = clamp(finiteNumber(assessment.integrity_score, 0), 0, 100);
  const exceptionCode = finiteNumber(assessment.except_info);
  const providerRejected = String(assessment.is_rejected || "false").toLowerCase() === "true" || exceptionCode !== 0;
  const words = asArray(assessment.sentence)
    .flatMap((sentence) => asArray(sentence?.word))
    .filter((word) => word?.content && !isNoiseToken(word.content))
    .map((word) => normalizeWord(word, fluency));

  return {
    SuggestedScore: round(providerScore),
    ProviderSuggestedScore: round(providerScore),
    PronAccuracy: round(accuracy),
    PronFluency: round(fluency / 100, 3),
    PronCompletion: round(completion / 100, 3),
    ProviderPronCompletion: round(completion / 100, 3),
    ProviderRejected: providerRejected,
    ProviderExceptionCode: exceptionCode,
    ProviderRawScores: {
      TotalScore: round(providerScore),
      AccuracyScore: round(accuracy),
      FluencyScore: round(fluency),
      IntegrityScore: round(completion)
    },
    RecognizedText: words.filter((word) => word.MatchTag !== 2).map((word) => word.Word).join(" "),
    Words: words
  };
}

async function parseMessageData(data: unknown): Promise<XfyunSocketMessage> {
  let text: string;
  if (typeof data === "string") text = data;
  else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8");
  else if (ArrayBuffer.isView(data)) text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  else if (data !== null && typeof data === "object" && "text" in data && typeof data.text === "function") {
    text = await (data.text as () => Promise<string>)();
  } else if (Buffer.isBuffer(data) || data instanceof Uint8Array) text = Buffer.from(data).toString("utf8");
  else text = String(data);
  return JSON.parse(text) as XfyunSocketMessage;
}

async function sendAudio(socket: WebSocket, pcm: Buffer): Promise<void> {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += audioFrameBytes) {
    chunks.push(pcm.subarray(offset, Math.min(pcm.length, offset + audioFrameBytes)));
  }
  for (let index = 0; index < chunks.length; index += 1) {
    const isFirst = index === 0;
    const isLast = index === chunks.length - 1;
    socket.send(JSON.stringify({
      business: { cmd: "auw", aus: isLast ? 4 : isFirst ? 1 : 2 },
      data: { status: isLast ? 2 : 1, data: chunks[index].toString("base64") }
    }));
    if (!isLast) await delay(frameIntervalMs);
  }
}

export async function assessWithXfyun({
  audio,
  referenceText
}: SpeechAssessmentRequest): Promise<ProviderAssessmentResult> {
  if (!audio?.length) throw new Error("audio is required for XFYUN speech provider");
  const appId = requiredEnv("XFYUN_APP_ID");
  const apiKey = requiredEnv("XFYUN_API_KEY");
  const apiSecret = requiredEnv("XFYUN_API_SECRET");
  const pcm = extractPcmData(Buffer.from(audio));
  const socket = new WebSocket(buildXfyunUrl(apiKey, apiSecret));
  let settled = false;

  console.info(`[speech] provider=xfyun status=start audioBytes=${audio.length} pcmBytes=${pcm.length} refChars=${referenceText.length}`);

  return new Promise<ProviderAssessmentResult>((resolve, reject) => {
    const timeout = setTimeout(() => finish(() => reject(new Error("XFYUN speech provider timed out"))), 35_000);

    function finish(callback: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close(1000);
      } catch {
        // Socket may already be closed by the provider.
      }
      callback();
    }

    socket.addEventListener("open", async () => {
      try {
        socket.send(JSON.stringify({
          common: { app_id: appId },
          business: {
            sub: "ise",
            ent: "en_vip",
            category: "read_sentence",
            cmd: "ssb",
            text: `\uFEFF[content]\n${referenceText}`,
            tte: "utf-8",
            ttp_skip: true,
            aue: "raw",
            auf: "audio/L16;rate=16000",
            rstcd: "utf8",
            rst: "entirety",
            ise_unite: "1",
            extra_ability: "multi_dimension"
          },
          data: { status: 0 }
        }));
        await sendAudio(socket, pcm);
      } catch (error: unknown) {
        finish(() => reject(error));
      }
    });

    socket.addEventListener("message", async (event) => {
      try {
        const message = await parseMessageData(event.data);
        if (Number(message.code) !== 0) {
          finish(() => reject(new Error(`XFYUN speech error ${message.code}: ${message.message || "unknown"}`)));
          return;
        }
        if (Number(message.data?.status) !== 2) return;
        if (!message.data?.data) {
          finish(() => reject(new Error("XFYUN speech provider returned an empty final result")));
          return;
        }
        const xml = Buffer.from(String(message.data.data), "base64").toString("utf8");
        const result = normalizeXfyunResult(xml);
        console.info(
          `[speech] provider=xfyun status=final score=${result.SuggestedScore} rejected=${result.ProviderRejected} exception=${result.ProviderExceptionCode}`
        );
        finish(() => resolve(result));
      } catch (error: unknown) {
        finish(() => reject(error));
      }
    });

    socket.addEventListener("error", (event) => {
      const details = event as Event & { message?: string; error?: unknown };
      const message = details.message || (details.error instanceof Error ? details.error.message : "unknown");
      finish(() => reject(new Error(`XFYUN speech WebSocket error: ${message}`)));
    });

    socket.addEventListener("close", (event) => {
      if (settled) return;
      finish(() => reject(new Error(`XFYUN speech WebSocket closed before final result (code ${event.code || "unknown"})`)));
    });
  });
}
