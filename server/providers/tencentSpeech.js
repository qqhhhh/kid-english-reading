import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { nanoid } from "nanoid";

const TENCENT_HOST = "soe.cloud.tencent.com";
const TENCENT_PATH = "/soe/api";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Tencent speech provider`);
  }
  return value;
}

function signTencentUrl(appId, secretKey, params) {
  const sortedQuery = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const source = `${TENCENT_HOST}${TENCENT_PATH}/${appId}?${sortedQuery}`;
  return crypto.createHmac("sha1", secretKey).update(source).digest("base64");
}

function buildTencentUrl({ referenceText }) {
  const appId = requiredEnv("TENCENT_APP_ID");
  const secretId = requiredEnv("TENCENT_SECRET_ID");
  const secretKey = requiredEnv("TENCENT_SECRET_KEY");
  const now = Math.floor(Date.now() / 1000);
  const params = {
    eval_mode: "1",
    expired: String(now + 3600),
    nonce: String(Math.floor(Math.random() * 1000000000)),
    rec_mode: "1",
    ref_text: referenceText,
    score_coeff: process.env.TENCENT_SCORE_COEFF || "1.0",
    secretid: secretId,
    sentence_info_enabled: "0",
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

function normalizeTencentResult(result) {
  if (!result) {
    throw new Error("Tencent response did not include an assessment result");
  }

  return {
    SuggestedScore: Number(result.SuggestedScore || 0),
    PronAccuracy: Number(result.PronAccuracy || 0),
    PronFluency: Number(result.PronFluency || 0),
    PronCompletion: Number(result.PronCompletion || 0),
    Words: Array.isArray(result.Words)
      ? result.Words.map((word) => ({
          Word: word.Word || "",
          ReferenceWord: word.ReferenceWord || word.Word || "",
          PronAccuracy: Number(word.PronAccuracy || 0),
          PronFluency: Number(word.PronFluency || 0),
          MatchTag: Number(word.MatchTag || 0),
          MemBeginTime: Number(word.MemBeginTime || 0),
          MemEndTime: Number(word.MemEndTime || 0),
          PhoneInfos: Array.isArray(word.PhoneInfos)
            ? word.PhoneInfos.map((phone) => ({
                Phone: phone.Phone || "",
                ReferencePhone: phone.ReferencePhone || "",
                ReferenceLetter: phone.ReferenceLetter || "",
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

async function parseTencentMessage(data) {
  let text;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = Buffer.from(data).toString("utf8");
  } else if (ArrayBuffer.isView(data)) {
    text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  } else if (typeof data?.text === "function") {
    text = await data.text();
  } else {
    text = Buffer.from(data).toString("utf8");
  }
  return JSON.parse(text);
}

function createTencentSpeechError(code, message) {
  const error = new Error(`Tencent speech error ${code}: ${message || "unknown"}`);
  error.providerCode = Number(code);
  return error;
}

export async function withTencentNoAudioRetry(operation, retryDelayMs = 180) {
  try {
    return await operation(1);
  } catch (error) {
    if (Number(error?.providerCode) !== 4008) throw error;
    console.warn("[speech] provider=tencent status=retry reason=no-audio-timeout attempt=2");
    await delay(retryDelayMs);
    return operation(2);
  }
}

async function assessWithTencentOnce({ audio, referenceText, attempt }) {
  if (!audio?.length) {
    throw new Error("audio is required for Tencent speech provider");
  }

  const url = buildTencentUrl({ referenceText });
  const socket = new WebSocket(url);
  let latestResult = null;
  let settled = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Tencent speech provider timed out")));
    }, 70000);

    function finish(callback) {
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
          `[speech] provider=tencent status=open attempt=${attempt} audioBytes=${audio.length} refChars=${referenceText.length} engine=${
            process.env.TENCENT_ENGINE_TYPE || "16k_en"
          }`
        );
        await delay(20);
        socket.send(audio);
        socket.send(JSON.stringify({ type: "end" }));
      } catch (error) {
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
      } catch (error) {
        finish(() => reject(error));
      }
    });

    socket.addEventListener("error", (event) => {
      const message = event.message || event.error?.message || "unknown";
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

export async function assessWithTencent({ audio, referenceText }) {
  return withTencentNoAudioRetry((attempt) => assessWithTencentOnce({ audio, referenceText, attempt }));
}
