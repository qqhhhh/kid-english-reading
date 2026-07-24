import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { nanoid } from "nanoid";
import { WebSocket, WebSocketServer } from "ws";

import { createTencentStreamingAssessment } from "./providers/tencentSpeech.js";
import type { ProviderAssessmentResult, SpeechAssessmentItemType } from "./types/providers.js";

interface LiveSpeechTicket {
  runId: string;
  childId: string;
  householdId: string;
  sentenceId: string;
  referenceText: string;
  itemType: SpeechAssessmentItemType;
  expiresAt: number;
}

export interface LiveSpeechTestComparison {
  runId: string;
  provider: "tencent";
  itemType: SpeechAssessmentItemType;
  evalMode: 1 | 2 | 7;
  audioSource: "raw-stream";
  suggestedScore: number;
  pronAccuracy: number;
  pronFluency: number;
  pronCompletion: number;
  finalLatencyMs: number;
  interimCount: number;
  audioBytes: number;
  audioChunks: number;
  finalReceivedAt: string;
  words: Array<{
    word: string;
    referenceWord: string;
    accuracy: number;
    matchTag: number;
  }>;
}

interface StoredLiveSpeechResult {
  childId: string;
  householdId: string;
  sentenceId: string;
  comparison: LiveSpeechTestComparison;
  result: ProviderAssessmentResult;
  audio: Buffer;
  attachedAttemptId?: string;
  expiresAt: number;
}

interface FailedLiveSpeechResult {
  childId: string;
  householdId: string;
  sentenceId: string;
  audio?: Buffer;
  expiresAt: number;
}

export interface LiveSpeechPrimaryResult {
  comparison: LiveSpeechTestComparison;
  result: ProviderAssessmentResult;
  audio: Buffer;
}

export interface LiveSpeechServerAttachment {
  close(): Promise<void>;
}

type LiveSpeechIdentity = Pick<LiveSpeechTicket, "runId" | "householdId" | "childId" | "sentenceId">;

const tickets = new Map<string, LiveSpeechTicket>();
const results = new Map<string, StoredLiveSpeechResult>();
const failures = new Map<string, FailedLiveSpeechResult>();
const resultWaiters = new Map<string, Set<() => void>>();
const activeRuns = new Map<string, LiveSpeechIdentity & { cancel: (reason: string) => void }>();
const attachedServers = new WeakMap<Server, LiveSpeechServerAttachment>();
const ticketTtlMs = 60_000;
const resultTtlMs = 10 * 60_000;

function cleanupExpiredLiveSpeechState(now = Date.now()) {
  for (const [key, ticket] of tickets) {
    if (ticket.expiresAt <= now) tickets.delete(key);
  }
  for (const [key, result] of results) {
    if (result.expiresAt <= now) results.delete(key);
  }
  for (const [key, failure] of failures) {
    if (failure.expiresAt <= now) failures.delete(key);
  }
}

export function getLiveSpeechStatus() {
  const configured = Boolean(
    process.env.TENCENT_APP_ID?.trim() &&
    process.env.TENCENT_SECRET_ID?.trim() &&
    process.env.TENCENT_SECRET_KEY?.trim()
  );
  return {
    enabled: process.env.TENCENT_STREAMING_ENABLED === "1" && configured,
    configured,
    provider: "tencent",
    mode: "soe-streaming-first",
    fallback: "captured-stream-or-http-full-recording"
  };
}

export function issueLiveSpeechTicket(input: Omit<LiveSpeechTicket, "expiresAt">) {
  const token = nanoid(32);
  const expiresAt = Date.now() + ticketTtlMs;
  cleanupExpiredLiveSpeechState();
  tickets.set(token, { ...input, expiresAt });
  return {
    socketPath: `/api/speech/live?ticket=${encodeURIComponent(token)}`,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

export function attachLiveSpeechTestResult(input: {
  runId: string;
  householdId: string;
  childId: string;
  sentenceId: string;
  attemptId: string;
}): LiveSpeechTestComparison | null {
  return claimLiveSpeechResult(input)?.comparison || null;
}

export function claimLiveSpeechResult(input: LiveSpeechIdentity & { attemptId: string }): LiveSpeechPrimaryResult | null {
  cleanupExpiredLiveSpeechState();
  const stored = results.get(input.runId);
  if (
    !stored ||
    stored.householdId !== input.householdId ||
    stored.childId !== input.childId ||
    stored.sentenceId !== input.sentenceId ||
    (stored.attachedAttemptId && stored.attachedAttemptId !== input.attemptId)
  ) {
    return null;
  }
  stored.attachedAttemptId = input.attemptId;
  return {
    comparison: structuredClone(stored.comparison),
    result: structuredClone(stored.result),
    audio: Buffer.from(stored.audio)
  };
}

export function claimLiveSpeechFallbackAudio(input: LiveSpeechIdentity): Buffer | null {
  cleanupExpiredLiveSpeechState();
  const failure = failures.get(input.runId);
  if (
    !failure ||
    failure.householdId !== input.householdId ||
    failure.childId !== input.childId ||
    failure.sentenceId !== input.sentenceId ||
    !failure.audio?.length
  ) {
    return null;
  }
  failures.delete(input.runId);
  return Buffer.from(failure.audio);
}

export function waitForLiveSpeechResult(
  input: LiveSpeechIdentity & { attemptId: string },
  timeoutMs = 3_500
): Promise<LiveSpeechPrimaryResult | null> {
  const immediate = claimLiveSpeechResult(input);
  if (immediate) return Promise.resolve(immediate);
  if (hasMatchingFailure(input)) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (value: LiveSpeechPrimaryResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const waiters = resultWaiters.get(input.runId);
      waiters?.delete(check);
      if (!waiters?.size) resultWaiters.delete(input.runId);
      resolve(value);
    };
    const check = () => {
      const claimed = claimLiveSpeechResult(input);
      if (claimed) finish(claimed);
      else if (hasMatchingFailure(input)) finish(null);
    };
    const waiters = resultWaiters.get(input.runId) || new Set<() => void>();
    waiters.add(check);
    resultWaiters.set(input.runId, waiters);
    timer = setTimeout(() => {
      const claimed = claimLiveSpeechResult(input);
      if (claimed) {
        finish(claimed);
        return;
      }
      cancelLiveSpeechRun(input, "fallback-timeout");
      finish(null);
    }, Math.max(0, timeoutMs));
    check();
  });
}

export function recordLiveSpeechTestResult(input: {
  runId: string;
  householdId: string;
  childId: string;
  sentenceId: string;
  itemType: SpeechAssessmentItemType;
  referenceText?: string;
  audio?: Buffer;
  result: ProviderAssessmentResult;
  endRequestedAt: number;
  finalReceivedAt?: number;
  interimCount: number;
  audioBytes: number;
  audioChunks: number;
}): LiveSpeechTestComparison {
  const finalReceivedAt = input.finalReceivedAt ?? Date.now();
  const result = normalizeLiveSpeechResult(input.result, input.itemType, input.referenceText || "");
  const comparison: LiveSpeechTestComparison = {
    runId: input.runId,
    provider: "tencent",
    itemType: input.itemType,
    evalMode: input.itemType === "word" ? 7 : input.itemType === "paragraph" ? 2 : 1,
    audioSource: "raw-stream",
    suggestedScore: Number(result.SuggestedScore || 0),
    pronAccuracy: Number(result.PronAccuracy || 0),
    pronFluency: Number(result.PronFluency || 0),
    pronCompletion: Number(result.PronCompletion || 0),
    finalLatencyMs: input.endRequestedAt ? Math.max(0, finalReceivedAt - input.endRequestedAt) : 0,
    interimCount: input.interimCount,
    audioBytes: input.audioBytes,
    audioChunks: input.audioChunks,
    finalReceivedAt: new Date(finalReceivedAt).toISOString(),
    words: result.Words.map((word) => ({
      word: word.Word,
      referenceWord: word.ReferenceWord,
      accuracy: word.PronAccuracy,
      matchTag: word.MatchTag
    }))
  };
  results.set(input.runId, {
    childId: input.childId,
    householdId: input.householdId,
    sentenceId: input.sentenceId,
    comparison,
    result,
    audio: Buffer.from(input.audio || []),
    expiresAt: finalReceivedAt + resultTtlMs
  });
  failures.delete(input.runId);
  notifyLiveSpeechWaiters(input.runId);
  return structuredClone(comparison);
}

function normalizeLiveSpeechResult(
  result: ProviderAssessmentResult,
  itemType: SpeechAssessmentItemType,
  referenceText: string
): ProviderAssessmentResult {
  const cloned = structuredClone(result);
  const referenceTokens = referenceText.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) || [];
  if (itemType !== "word" || referenceTokens.length !== 1 || cloned.Words.length <= 1) return cloned;
  const normalizedReference = referenceTokens[0].replace(/[’]/g, "'");
  const matchingWords = cloned.Words.filter((word) => {
    const providerReference = String(word.ReferenceWord || word.Word || "")
      .toLowerCase()
      .replace(/_\d+$/, "")
      .replace(/[’]/g, "'")
      .replace(/[^a-z']/g, "");
    return providerReference === normalizedReference && Number(word.MatchTag || 0) !== 1;
  });
  if (matchingWords.length <= 1) return cloned;
  const matched = matchingWords.filter((word) => Number(word.MatchTag || 0) === 0);
  const candidates = matched.length ? matched : matchingWords;
  const conservative = candidates.reduce((selected, word) =>
    Number(word.PronAccuracy || 0) < Number(selected.PronAccuracy || 0) ? word : selected
  );
  return { ...cloned, Words: [conservative] };
}

function hasMatchingFailure(input: LiveSpeechIdentity) {
  cleanupExpiredLiveSpeechState();
  const failure = failures.get(input.runId);
  return Boolean(
    failure &&
    failure.householdId === input.householdId &&
    failure.childId === input.childId &&
    failure.sentenceId === input.sentenceId
  );
}

function markLiveSpeechFailure(input: LiveSpeechIdentity, audio?: Buffer) {
  failures.set(input.runId, {
    householdId: input.householdId,
    childId: input.childId,
    sentenceId: input.sentenceId,
    ...(audio?.length ? { audio: Buffer.from(audio) } : {}),
    expiresAt: Date.now() + resultTtlMs
  });
  notifyLiveSpeechWaiters(input.runId);
}

function notifyLiveSpeechWaiters(runId: string) {
  for (const waiter of [...(resultWaiters.get(runId) || [])]) waiter();
}

function cancelLiveSpeechRun(input: LiveSpeechIdentity, reason: string) {
  const active = activeRuns.get(input.runId);
  if (
    active &&
    active.householdId === input.householdId &&
    active.childId === input.childId &&
    active.sentenceId === input.sentenceId
  ) {
    active.cancel(reason);
    return;
  }
  markLiveSpeechFailure(input);
}

function rejectUpgrade(socket: Duplex, status = "401 Unauthorized") {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachLiveSpeechServer(server: Server): LiveSpeechServerAttachment {
  const existingAttachment = attachedServers.get(server);
  if (existingAttachment) return existingAttachment;
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(request.url || "/", "http://localhost");
    } catch {
      rejectUpgrade(socket, "400 Bad Request");
      return;
    }
    if (url.pathname !== "/api/speech/live") return;
    if (!getLiveSpeechStatus().enabled) {
      rejectUpgrade(socket, "503 Service Unavailable");
      return;
    }
    const token = url.searchParams.get("ticket") || "";
    const ticket = tickets.get(token);
    tickets.delete(token);
    if (!ticket || ticket.expiresAt <= Date.now()) {
      rejectUpgrade(socket);
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      handleLiveSpeechConnection(client, ticket);
    });
  };
  server.on("upgrade", handleUpgrade);

  let closePromise: Promise<void> | null = null;
  const attachment: LiveSpeechServerAttachment = {
    close() {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolve) => {
        server.off("upgrade", handleUpgrade);
        let completed = false;
        const complete = () => {
          if (completed) return;
          completed = true;
          attachedServers.delete(server);
          resolve();
        };
        const terminateTimer = setTimeout(() => {
          for (const client of webSocketServer.clients) client.terminate();
        }, 500);
        const completionTimer = setTimeout(complete, 1_500);
        for (const client of webSocketServer.clients) client.close(1001, "server-shutdown");
        webSocketServer.close(() => {
          clearTimeout(terminateTimer);
          clearTimeout(completionTimer);
          complete();
        });
      });
      return closePromise;
    }
  };
  attachedServers.set(server, attachment);
  return attachment;
}

function handleLiveSpeechConnection(client: WebSocket, ticket: LiveSpeechTicket) {
  let finishRequested = false;
  let finalReceived = false;
  let endRequestedAt = 0;
  let interimCount = 0;
  let audioBytes = 0;
  let audioChunks = 0;
  let captureComplete = true;
  const capturedAudio: Buffer[] = [];
  const capturedAudioLimitBytes = 12 * 1024 * 1024;
  const getCapturedWav = () => captureComplete && audioBytes > 0
    ? encodePcm16Wav(Buffer.concat(capturedAudio, audioBytes))
    : Buffer.alloc(0);
  const send = (payload: Record<string, unknown>) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
  };
  const assessment = createTencentStreamingAssessment({
    referenceText: ticket.referenceText,
    itemType: ticket.itemType,
    onResult: (result, isFinal) => {
      if (!isFinal) interimCount += 1;
      if (isFinal) {
        finalReceived = true;
        activeRuns.delete(ticket.runId);
        const comparison = recordLiveSpeechTestResult({
          runId: ticket.runId,
          householdId: ticket.householdId,
          childId: ticket.childId,
          sentenceId: ticket.sentenceId,
          itemType: ticket.itemType,
          referenceText: ticket.referenceText,
          audio: getCapturedWav(),
          result,
          endRequestedAt,
          interimCount,
          audioBytes,
          audioChunks
        });
        console.info(
          `[speech-live] run=${ticket.runId} child=${ticket.childId} sentence=${ticket.sentenceId} status=final score=${comparison.suggestedScore.toFixed(2)} accuracy=${comparison.pronAccuracy.toFixed(2)} completion=${comparison.pronCompletion.toFixed(3)} latencyMs=${comparison.finalLatencyMs} audioBytes=${audioBytes}`
        );
      }
      send({
        type: isFinal ? "final" : "interim",
        completion: result.PronCompletion,
        suggestedScore: result.SuggestedScore,
        words: result.Words.map((word) => ({
          word: word.Word,
          referenceWord: word.ReferenceWord,
          accuracy: word.PronAccuracy,
          matchTag: word.MatchTag
        }))
      });
      if (isFinal) {
        client.close(1000, "complete");
      }
    },
    onError: (error) => {
      if (finalReceived) return;
      finalReceived = true;
      activeRuns.delete(ticket.runId);
      markLiveSpeechFailure(ticket, getCapturedWav());
      console.warn(`[speech-live] status=provider-error child=${ticket.childId} message="${error.message}"`);
      send({ type: "unavailable" });
      finalReceived = true;
      client.close(1011, "provider-unavailable");
    }
  });

  activeRuns.set(ticket.runId, {
    runId: ticket.runId,
    householdId: ticket.householdId,
    childId: ticket.childId,
    sentenceId: ticket.sentenceId,
    cancel: (reason) => {
      if (finalReceived) return;
      finalReceived = true;
      finishRequested = true;
      activeRuns.delete(ticket.runId);
      assessment.cancel();
      markLiveSpeechFailure(ticket, getCapturedWav());
      console.warn(`[speech-live] run=${ticket.runId} status=cancelled reason=${reason}`);
      send({ type: "unavailable" });
      client.close(1011, "fallback");
    }
  });

  send({ type: "ready" });
  client.on("message", (data, isBinary) => {
    if (finishRequested || finalReceived) return;
    if (isBinary) {
      const audio = Buffer.from(data as Buffer);
      audioBytes += audio.length;
      audioChunks += 1;
      if (captureComplete && audioBytes <= capturedAudioLimitBytes) capturedAudio.push(audio);
      else {
        captureComplete = false;
        capturedAudio.length = 0;
      }
      assessment.sendAudio(audio);
      return;
    }
    try {
      const message = JSON.parse(data.toString()) as { type?: unknown };
      if (message.type === "end") {
        finishRequested = true;
        endRequestedAt = Date.now();
        assessment.finish();
      }
    } catch {
      // Ignore malformed control messages; binary audio remains usable.
    }
  });
  client.on("close", () => {
    if (!finalReceived) {
      finalReceived = true;
      activeRuns.delete(ticket.runId);
      assessment.cancel();
      markLiveSpeechFailure(ticket, getCapturedWav());
    }
  });
  client.on("error", () => {
    if (!finalReceived) {
      finalReceived = true;
      activeRuns.delete(ticket.runId);
      assessment.cancel();
      markLiveSpeechFailure(ticket, getCapturedWav());
    }
  });
}

function encodePcm16Wav(pcm: Buffer, sampleRate = 16_000): Buffer {
  const usableBytes = pcm.length - (pcm.length % 2);
  const wav = Buffer.allocUnsafe(44 + usableBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + usableBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(usableBytes, 40);
  pcm.copy(wav, 44, 0, usableBytes);
  return wav;
}
