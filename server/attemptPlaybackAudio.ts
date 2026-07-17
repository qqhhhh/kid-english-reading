const defaultLeadingPaddingMs = 60;
const defaultTrailingPaddingMs = 120;

interface TimedAssessmentWord {
  MatchTag?: number;
  MemBeginTime?: number;
  MemEndTime?: number;
}

interface PlaybackAssessmentResult {
  Words?: TimedAssessmentWord[];
}

interface PlaybackCropOptions {
  leadingPaddingMs?: number;
  trailingPaddingMs?: number;
}

interface PcmWavLayout {
  audioFormat: number;
  sampleRate: number;
  bytesPerSecond: number;
  blockAlign: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
  dataSizeOffset: number;
}

export function cropAttemptPlaybackAudio(
  audio: Buffer,
  result?: PlaybackAssessmentResult | null,
  options: PlaybackCropOptions = {}
): Buffer {
  if (!Buffer.isBuffer(audio) || audio.length < 44) return audio;
  const wav = inspectPcmWav(audio);
  if (!wav) return audio;

  const timedWords = (Array.isArray(result?.Words) ? result.Words : [])
    .filter((word) => Number(word?.MatchTag || 0) !== 1)
    .map((word) => ({ begin: Number(word?.MemBeginTime), end: Number(word?.MemEndTime) }))
    .filter((word) => Number.isFinite(word.begin) && Number.isFinite(word.end) && word.begin >= 0 && word.end > word.begin);
  if (timedWords.length === 0) return audio;

  const leadingPaddingMs = Number(options.leadingPaddingMs ?? defaultLeadingPaddingMs);
  const trailingPaddingMs = Number(options.trailingPaddingMs ?? defaultTrailingPaddingMs);
  const durationMs = (wav.dataSize / wav.bytesPerSecond) * 1000;
  const firstWordMs = Math.min(...timedWords.map((word) => word.begin));
  const lastWordMs = Math.max(...timedWords.map((word) => word.end));
  const startMs = Math.max(0, firstWordMs - Math.max(0, leadingPaddingMs));
  const endMs = Math.min(durationMs, lastWordMs + Math.max(0, trailingPaddingMs));
  if (endMs <= startMs || (startMs < 20 && durationMs - endMs < 20)) return audio;

  const startFrame = Math.floor((startMs / 1000) * wav.sampleRate);
  const endFrame = Math.ceil((endMs / 1000) * wav.sampleRate);
  const startByte = Math.min(wav.dataSize, startFrame * wav.blockAlign);
  const endByte = Math.min(wav.dataSize, endFrame * wav.blockAlign);
  if (endByte <= startByte) return audio;

  const samples = audio.subarray(wav.dataOffset + startByte, wav.dataOffset + endByte);
  const output = Buffer.alloc(wav.dataOffset + samples.length);
  audio.copy(output, 0, 0, wav.dataOffset);
  samples.copy(output, wav.dataOffset);
  output.writeUInt32LE(output.length - 8, 4);
  output.writeUInt32LE(samples.length, wav.dataSizeOffset);
  return output;
}

function inspectPcmWav(audio: Buffer): PcmWavLayout | null {
  if (audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let format: Omit<PcmWavLayout, "dataOffset" | "dataSize" | "dataSizeOffset"> | undefined;
  let data: Pick<PcmWavLayout, "dataOffset" | "dataSize" | "dataSizeOffset"> | undefined;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > audio.length) return null;

    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: audio.readUInt16LE(chunkDataOffset),
        sampleRate: audio.readUInt32LE(chunkDataOffset + 4),
        bytesPerSecond: audio.readUInt32LE(chunkDataOffset + 8),
        blockAlign: audio.readUInt16LE(chunkDataOffset + 12),
        bitsPerSample: audio.readUInt16LE(chunkDataOffset + 14)
      };
    }
    if (chunkId === "data") {
      data = { dataOffset: chunkDataOffset, dataSize: chunkSize, dataSizeOffset: offset + 4 };
      break;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!format || !data || format.audioFormat !== 1 || format.bitsPerSample !== 16) return null;
  if (!format.sampleRate || !format.bytesPerSecond || !format.blockAlign) return null;
  return { ...format, ...data };
}
