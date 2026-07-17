import * as sdk from "microsoft-cognitiveservices-speech-sdk";

import type {
  ProviderAssessmentResult,
  ProviderPhoneResult,
  SpeechAssessmentRequest
} from "../types/providers.js";

const azureTickPerMillisecond = 10_000;

interface AzureNBestPhoneme {
  Phoneme?: unknown;
  Score?: unknown;
}

interface AzurePronunciationAssessment {
  AccuracyScore?: unknown;
  FluencyScore?: unknown;
  CompletenessScore?: unknown;
  PronScore?: unknown;
  ProsodyScore?: unknown;
  ErrorType?: unknown;
  NBestPhonemes?: AzureNBestPhoneme[];
}

interface AzurePhone {
  Offset?: unknown;
  Duration?: unknown;
  Phoneme?: unknown;
  PronunciationAssessment?: AzurePronunciationAssessment;
}

interface AzureWord {
  Offset?: unknown;
  Duration?: unknown;
  Word?: unknown;
  PronunciationAssessment?: AzurePronunciationAssessment;
  Phonemes?: AzurePhone[];
}

interface AzureBestResult {
  Display?: unknown;
  Lexical?: unknown;
  PronunciationAssessment?: AzurePronunciationAssessment;
  Words?: AzureWord[];
}

interface AzureRawResult {
  DisplayText?: unknown;
  NBest?: AzureBestResult[];
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Azure speech provider`);
  }
  return value;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: unknown, digits = 2): number {
  return Number(finiteNumber(value).toFixed(digits));
}

function azureTicksToMilliseconds(value: unknown): number {
  return round(finiteNumber(value) / azureTickPerMillisecond, 2);
}

function mapAzureErrorType(errorType: unknown): number {
  switch (String(errorType || "None").toLowerCase()) {
    case "none":
      return 0;
    case "insertion":
      return 1;
    case "omission":
      return 2;
    case "mispronunciation":
      return 3;
    default:
      return 4;
  }
}

function normalizeAzurePhone(phone: AzurePhone, wordMatchTag: number): ProviderPhoneResult {
  const begin = azureTicksToMilliseconds(phone?.Offset);
  const duration = azureTicksToMilliseconds(phone?.Duration);
  const phoneme = String(phone?.Phoneme || "");
  return {
    Phone: phoneme,
    ReferencePhone: phoneme,
    ReferenceLetter: "",
    PronAccuracy: round(phone?.PronunciationAssessment?.AccuracyScore),
    MatchTag: wordMatchTag,
    MemBeginTime: begin,
    MemEndTime: round(begin + duration, 2),
    NBestPhonemes: Array.isArray(phone?.PronunciationAssessment?.NBestPhonemes)
      ? phone.PronunciationAssessment.NBestPhonemes.map((candidate) => ({
          Phone: String(candidate?.Phoneme || ""),
          Score: round(candidate?.Score)
        }))
      : []
  };
}

export function normalizeAzureResult(payload: unknown): ProviderAssessmentResult {
  const response = (payload && typeof payload === "object" ? payload : {}) as AzureRawResult;
  const best = response.NBest?.[0];
  const assessment = best?.PronunciationAssessment;
  if (!best || !assessment) {
    throw new Error("Azure response did not include a pronunciation assessment result");
  }

  const accuracy = clamp(finiteNumber(assessment.AccuracyScore), 0, 100);
  const fluency = clamp(finiteNumber(assessment.FluencyScore), 0, 100);
  const completion = clamp(finiteNumber(assessment.CompletenessScore), 0, 100);
  const pronunciation = clamp(finiteNumber(assessment.PronScore), 0, 100);

  return {
    SuggestedScore: round(pronunciation),
    ProviderSuggestedScore: round(pronunciation),
    PronAccuracy: round(accuracy),
    PronFluency: round(fluency / 100, 3),
    PronCompletion: round(completion / 100, 3),
    ProviderPronCompletion: round(completion / 100, 3),
    ProviderRawScores: {
      AccuracyScore: round(accuracy),
      FluencyScore: round(fluency),
      CompletenessScore: round(completion),
      PronScore: round(pronunciation),
      ProsodyScore: assessment.ProsodyScore === undefined ? undefined : round(assessment.ProsodyScore)
    },
    RecognizedText: String(best.Display || best.Lexical || response.DisplayText || ""),
    Words: Array.isArray(best.Words)
      ? best.Words.map((word) => {
          const errorType = String(word?.PronunciationAssessment?.ErrorType || "None");
          const matchTag = mapAzureErrorType(errorType);
          const begin = azureTicksToMilliseconds(word?.Offset);
          const duration = azureTicksToMilliseconds(word?.Duration);
          const value = String(word?.Word || "");
          return {
            Word: value,
            ReferenceWord: matchTag === 1 ? "*" : value,
            PronAccuracy: round(word?.PronunciationAssessment?.AccuracyScore),
            PronFluency: round(fluency / 100, 3),
            MatchTag: matchTag,
            ProviderErrorType: errorType,
            MemBeginTime: begin,
            MemEndTime: round(begin + duration, 2),
            PhoneInfos: Array.isArray(word?.Phonemes)
              ? word.Phonemes.map((phone) => normalizeAzurePhone(phone, matchTag))
              : []
          };
        })
      : []
  };
}

function parseAzureJsonResult(result: sdk.SpeechRecognitionResult): unknown {
  const json = result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
  if (!json) {
    throw new Error("Azure speech provider returned an empty JSON result");
  }
  return JSON.parse(json);
}

export async function assessWithAzure({
  audio,
  referenceText
}: SpeechAssessmentRequest): Promise<ProviderAssessmentResult> {
  if (!audio?.length) {
    throw new Error("audio is required for Azure speech provider");
  }

  const key = requiredEnv("AZURE_SPEECH_KEY");
  const region = requiredEnv("AZURE_SPEECH_REGION");
  const language = process.env.AZURE_SPEECH_LANGUAGE?.trim() || "en-US";
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechRecognitionLanguage = language;
  speechConfig.outputFormat = sdk.OutputFormat.Detailed;
  const audioConfig = sdk.AudioConfig.fromWavFileInput(Buffer.from(audio));
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
    referenceText,
    sdk.PronunciationAssessmentGradingSystem.HundredMark,
    sdk.PronunciationAssessmentGranularity.Phoneme,
    true
  );
  pronunciationConfig.phonemeAlphabet = process.env.AZURE_SPEECH_PHONEME_ALPHABET?.trim() || "IPA";
  pronunciationConfig.nbestPhonemeCount = Math.max(1, Number(process.env.AZURE_SPEECH_NBEST_PHONEME_COUNT || 3));
  if (language.toLowerCase() === "en-us" && process.env.AZURE_SPEECH_PROSODY !== "0") {
    pronunciationConfig.enableProsodyAssessment = true;
  }
  pronunciationConfig.applyTo(recognizer);

  console.info(
    `[speech] provider=azure status=start audioBytes=${audio.length} refChars=${referenceText.length} region=${region} language=${language}`
  );

  try {
    const result = await new Promise<sdk.SpeechRecognitionResult>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Azure speech provider timed out")), 25_000);
      recognizer.recognizeOnceAsync(
        (recognitionResult) => {
          clearTimeout(timeout);
          resolve(recognitionResult);
        },
        (error) => {
          clearTimeout(timeout);
          reject(new Error(`Azure speech provider error: ${error}`));
        }
      );
    });

    if (result.reason === sdk.ResultReason.Canceled) {
      const details = sdk.CancellationDetails.fromResult(result);
      throw new Error(`Azure speech provider canceled: ${details.errorDetails || details.reason}`);
    }
    if (result.reason !== sdk.ResultReason.RecognizedSpeech) {
      throw new Error(`Azure speech provider did not recognize speech (reason ${result.reason})`);
    }

    const normalized = normalizeAzureResult(parseAzureJsonResult(result));
    console.info(`[speech] provider=azure status=final score=${normalized.SuggestedScore}`);
    return normalized;
  } finally {
    recognizer.close();
    audioConfig.close();
    speechConfig.close();
  }
}
