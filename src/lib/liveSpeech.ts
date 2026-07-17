import { StreamingPcmEncoder } from "./streamingPcm";

export interface LiveWordEvidence {
  word: string;
  referenceWord: string;
  accuracy: number;
  matchTag: number;
}

export interface LiveSpeechProgress {
  completion: number;
  suggestedScore: number;
  final: boolean;
  words: LiveWordEvidence[];
}

export interface LiveSpeechSession {
  open(): void;
  sendAudio(samples: Float32Array, inputSampleRate: number): void;
  finish(): void;
  cancel(): void;
}

export async function prepareLiveSpeechSession(input: {
  runId: string;
  childId: string;
  sentenceId: string;
  referenceText: string;
  itemType: "word" | "sentence" | "paragraph";
  onProgress: (progress: LiveSpeechProgress) => void;
  onUnavailable?: () => void;
}): Promise<LiveSpeechSession | null> {
  try {
    const response = await fetch("/api/speech/live-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return null;
    const body = await response.json() as { socketPath?: unknown };
    if (typeof body.socketPath !== "string" || !body.socketPath.startsWith("/api/speech/live?")) return null;
    return createBrowserLiveSpeechSession(body.socketPath, input.onProgress, input.onUnavailable);
  } catch {
    return null;
  }
}

function createBrowserLiveSpeechSession(
  socketPath: string,
  onProgress: (progress: LiveSpeechProgress) => void,
  onUnavailable?: () => void
): LiveSpeechSession {
  const encoder = new StreamingPcmEncoder();
  const pendingPackets: ArrayBuffer[] = [];
  let socket: WebSocket | null = null;
  let finished = false;
  let cancelled = false;
  let finalReceived = false;
  let unavailableReported = false;
  let closeTimeout: number | null = null;

  const reportUnavailable = () => {
    if (cancelled || finalReceived || unavailableReported) return;
    unavailableReported = true;
    onUnavailable?.();
  };

  const sendPacket = (packet: ArrayBuffer) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(packet);
    else if (pendingPackets.length < 64) pendingPackets.push(packet);
  };
  const sendEnd = () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "end" }));
  };

  return {
    open() {
      if (socket || cancelled) return;
      const url = new URL(socketPath, window.location.href);
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => {
        for (const packet of pendingPackets.splice(0)) socket?.send(packet);
        if (finished) sendEnd();
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message.type === "unavailable") {
            reportUnavailable();
            return;
          }
          if (message.type !== "interim" && message.type !== "final") return;
          const words = Array.isArray(message.words)
            ? message.words.flatMap((value) => {
                if (!value || typeof value !== "object") return [];
                const word = value as Record<string, unknown>;
                return [{
                  word: typeof word.word === "string" ? word.word : "",
                  referenceWord: typeof word.referenceWord === "string" ? word.referenceWord : "",
                  accuracy: Number(word.accuracy || 0),
                  matchTag: Number(word.matchTag || 0)
                }];
              })
            : [];
          const progress = {
            completion: Number(message.completion || 0),
            suggestedScore: Number(message.suggestedScore || 0),
            final: message.type === "final",
            words
          };
          if (progress.final) finalReceived = true;
          onProgress(progress);
        } catch {
          // A malformed pilot message must never interrupt full-recording scoring.
        }
      });
      socket.addEventListener("error", reportUnavailable);
      socket.addEventListener("close", reportUnavailable);
    },
    sendAudio(samples, inputSampleRate) {
      if (finished || cancelled) return;
      for (const packet of encoder.push(samples, inputSampleRate)) sendPacket(packet);
    },
    finish() {
      if (finished || cancelled) return;
      finished = true;
      for (const packet of encoder.flush()) sendPacket(packet);
      sendEnd();
      closeTimeout = window.setTimeout(() => socket?.close(), 5000);
      socket?.addEventListener("close", () => {
        if (closeTimeout !== null) window.clearTimeout(closeTimeout);
      }, { once: true });
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      encoder.reset();
      pendingPackets.length = 0;
      if (closeTimeout !== null) window.clearTimeout(closeTimeout);
      socket?.close();
    }
  };
}
