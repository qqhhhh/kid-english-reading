import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { XMLParser } from "fast-xml-parser";

const XFYUN_HOST = "ise-api.xfyun.cn";
const XFYUN_PATH = "/v2/open-ise";
const XFYUN_URL = `wss://${XFYUN_HOST}${XFYUN_PATH}`;
const audioFrameBytes = 1_280;
const frameIntervalMs = 40;
const xfyunFrameMs = 10;

const xfyunPhoneToIpa = Object.freeze({
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

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for XFYUN speech provider`);
  return value;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  return Number(finiteNumber(value).toFixed(digits));
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function buildXfyunUrl(apiKey, apiSecret) {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${XFYUN_HOST}\ndate: ${date}\nGET ${XFYUN_PATH} HTTP/1.1`;
  const signature = crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");
  const query = new URLSearchParams({ authorization, date, host: XFYUN_HOST });
  return `${XFYUN_URL}?${query.toString()}`;
}

function extractPcmData(wav) {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("XFYUN speech provider requires a PCM WAV recording");
  }
  let offset = 12;
  let format;
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

function mapDpMessage(value) {
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

function isNoiseToken(value) {
  return ["sil", "silv", "fil"].includes(String(value || "").trim().toLowerCase());
}

function findAssessmentNode(value) {
  if (!value || typeof value !== "object") return null;
  if (value.total_score !== undefined && value.sentence !== undefined && value.content !== undefined) return value;
  for (const child of Object.values(value)) {
    if (!child || typeof child !== "object") continue;
    const found = findAssessmentNode(child);
    if (found) return found;
  }
  return null;
}

function normalizePhone(phone, syllableScore, wordMatchTag) {
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

function normalizeWord(word, globalFluency) {
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

export function normalizeXfyunResult(xml) {
  const parsed = typeof xml === "string" ? parser.parse(xml) : xml;
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

async function parseMessageData(data) {
  if (typeof data === "string") return JSON.parse(data);
  if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString("utf8"));
  if (ArrayBuffer.isView(data)) return JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"));
  if (typeof data?.text === "function") return JSON.parse(await data.text());
  return JSON.parse(Buffer.from(data).toString("utf8"));
}

async function sendAudio(socket, pcm) {
  const chunks = [];
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

export async function assessWithXfyun({ audio, referenceText }) {
  if (!audio?.length) throw new Error("audio is required for XFYUN speech provider");
  const appId = requiredEnv("XFYUN_APP_ID");
  const apiKey = requiredEnv("XFYUN_API_KEY");
  const apiSecret = requiredEnv("XFYUN_API_SECRET");
  const pcm = extractPcmData(Buffer.from(audio));
  const socket = new WebSocket(buildXfyunUrl(apiKey, apiSecret));
  let settled = false;

  console.info(`[speech] provider=xfyun status=start audioBytes=${audio.length} pcmBytes=${pcm.length} refChars=${referenceText.length}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(() => reject(new Error("XFYUN speech provider timed out"))), 35_000);

    function finish(callback) {
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
      } catch (error) {
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
        const xml = Buffer.from(message.data.data, "base64").toString("utf8");
        const result = normalizeXfyunResult(xml);
        console.info(
          `[speech] provider=xfyun status=final score=${result.SuggestedScore} rejected=${result.ProviderRejected} exception=${result.ProviderExceptionCode}`
        );
        finish(() => resolve(result));
      } catch (error) {
        finish(() => reject(error));
      }
    });

    socket.addEventListener("error", (event) => {
      const message = event.message || event.error?.message || "unknown";
      finish(() => reject(new Error(`XFYUN speech WebSocket error: ${message}`)));
    });

    socket.addEventListener("close", (event) => {
      if (settled) return;
      finish(() => reject(new Error(`XFYUN speech WebSocket closed before final result (code ${event.code || "unknown"})`)));
    });
  });
}
