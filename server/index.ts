import express from "express";
import type { NextFunction, Request, Response } from "express";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { nanoid } from "nanoid";
import { PDFParse } from "pdf-parse";
import {
  addLessonToPracticeBook,
  archivePracticeBookItem,
  assignLessonToChild,
  createChild,
  createAutomaticPracticeSession,
  createPlatformAdminAuditLog,
  createLesson,
  disableRegistrationKey,
  consumeCourseSyncNonce,
  countAttemptDiagnostics,
  createPracticeBook,
  createStorybook,
  deletePracticeBook,
  deleteStorybook,
  findAttemptById,
  findCourseSyncDraft,
  finishAutomaticPracticeSession,
  findSentenceById,
  findStorybookById,
  initDatabase,
  insertAttempt,
  insertStorybookAttempt,
  updateAttemptMetadata,
  updateStorybookAttemptMetadata,
  listAttemptDiagnostics,
  listStorybookAttempts,
  listStorybooks,
  listAttempts,
  listAutomaticPracticeSessions,
  listChildren,
  listCourseSyncDrafts,
  listLessons,
  listOfficialCourseResources,
  listPlatformAdminAuditLogs,
  listRegistrationKeyRecords,
  movePracticeBookItem,
  markCourseSyncDraftPublished,
  reorderPracticeBookItem,
  removeLessonFromPracticeBook,
  setLessonArchived,
  setOfficialCourseResourceStatus,
  publishOfficialCourseResource,
  saveCourseSyncDraft,
  updateLesson,
  updatePracticeBook,
  updatePracticeBookItemStatus,
  updateRegistrationKeyNote
} from "./db.js";
import { loadEnvFile } from "./env.js";
import { buildLessonChapters, countWords, normalizeLessonSourceType } from "./lessonBuilder.js";
import { selectAttemptCandidate } from "./candidateSelection.js";
import { getAssessmentRejection } from "./assessmentValidity.js";
import { cropAttemptPlaybackAudio } from "./attemptPlaybackAudio.js";
import { evaluateNoiseGate } from "./noiseQuality.js";
import { applyScorePolicy, getPolicyScore, hasValidPassedScore, selectBestPassedAttempt } from "./scoringPolicy.js";
import { enhanceSpeech, getSpeechEnhancementStatus } from "./speechEnhancement.js";
import type { SpeechEnhancementMetadata, SpeechEnhancementResult } from "./speechEnhancement.js";
import {
  assessSpeechProviderComparison,
  getSpeechProviderComparisonStatus
} from "./speechProviderComparison.js";
import { assessWithAzure } from "./providers/azureSpeech.js";
import { assessWithXfyun } from "./providers/xfyunSpeech.js";
import { synthesizeWithOpenAI } from "./providers/openaiTts.js";
import { assessWithTencent } from "./providers/tencentSpeech.js";
import { synthesizeWithTencent } from "./providers/tencentTts.js";
import { getHunyuanOcrStatus, startHunyuanOcrService, stopHunyuanOcrService } from "./providers/hunyuanOcr.js";
import { getPaddleOcrStatus, startPaddleOcrService, stopPaddleOcrService } from "./providers/paddleOcr.js";
import { extractPdfLayout } from "./pdfLayout.js";
import { assessPdfImportQuality, getPdfPublicationBlockers } from "./pdfImportQuality.js";
import { verifyPdfImport } from "./pdfImportVerification.js";
import { extractPdfText, savePdfImportArtifacts } from "./pdfImportStorage.js";
import {
  buildPdfImportChapters,
  buildPdfImportHierarchy,
  buildPdfImportChaptersFromStructure,
  buildPdfStructure,
  buildPdfStructureFromLayout,
  maxPdfImportSentences,
  mergePepReadingParagraphs,
  normalizePdfImportRule,
  normalizePdfLines,
  normalizeSentenceKey,
  pdfImportRuleLabels,
  repairPossiblyMojibake,
  sanitizeImportTitle
} from "./pdfImportParser.js";
import {
  collectReferencedPageNumbers,
  courseSyncKeyMatches,
  createCourseSyncNonce,
  createCourseSyncPackageId,
  createCourseSyncSignature,
  filterSnapshotForCourseSync,
  getCourseSyncConfiguration,
  isCourseSyncNonce,
  isCourseSyncTimestampFresh,
  sha256,
  validateCourseSyncManifest,
  verifyCourseSyncSignature
} from "./courseSync.js";
import type { CourseSyncSnapshot, NormalizedCourseSyncAsset } from "./courseSync.js";
import { cloneCourseLibraryResource, cloneCourseLibrarySnapshot, listCourseLibraryResources } from "./courseLibrary.js";
import { evaluatePass } from "./passGate.js";
import {
  findCalibrationRecord,
  listCalibrationRecords,
  saveCalibrationReview,
  summarizeCalibration,
  upsertRejectedCalibrationSample
} from "./attemptCalibration.js";
import { findTtsVoice, getDefaultTtsVoice, tencentTtsVoices } from "./ttsVoices.js";
import { findFilingReviewSentence } from "./filingReviewSandbox.js";
import {
  beginPlatformAdminAudit,
  hasChildAccess,
  registerSecurityAndAuthRoutes,
  requireLocalCourseStudio
} from "./http/authRoutes.js";
import {
  createChildPairingCode,
  createRegistrationKey,
  isPlatformAdminSession,
  readAccessSession,
} from "./parentAuth.js";
import { listChildDeviceSessions, revokeChildDeviceSession } from "./db.js";
import type { AssessmentResultLike, AssessmentWordLike } from "../shared/assessmentTypes.js";
import type { ProviderAssessmentResult, SpeechAssessmentItemType, TtsVoice, TtsSynthesisResult } from "./types/providers.js";
import type { CalibrationProvider, CalibrationProviderOutcome, CalibrationSample } from "./attemptCalibration.js";
import type { ParentAccessSession } from "./types/auth.js";
import type {
  PdfImportChapter,
  PdfImportPageAsset,
  PdfImportQualityReport,
  PdfImportSnapshot,
  PdfLayout
} from "./types/pdf.js";
import type { ParsedPdfStructure, PdfImportParserResult } from "./pdfImportParser.js";
import type { PassGateResult } from "./types/scoring.js";
import { projectRoot } from "./projectRoot.js";
import { createBackgroundTaskQueue } from "./backgroundTaskQueue.js";
import { createSingleFlight } from "./singleFlight.js";
import {
  attachLiveSpeechServer,
  attachLiveSpeechTestResult,
  claimLiveSpeechFallbackAudio,
  getLiveSpeechStatus,
  issueLiveSpeechTicket,
  waitForLiveSpeechResult
} from "./liveSpeech.js";
import type { LiveSpeechTestComparison } from "./liveSpeech.js";

loadEnvFile();
initDatabase();

const __filename = fileURLToPath(import.meta.url);
const app = express();
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || "127.0.0.1";
const speechProvider = process.env.SPEECH_PROVIDER || "mock";
const ttsProvider = process.env.TTS_PROVIDER || "tencent";
const aiProvider = process.env.AI_PROVIDER || "disabled";
const supportedSpeechProviders = ["mock", "tencent", "azure", "xfyun"];
const supportedTtsProviders = ["tencent", "openai"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const diagnosticAudioUpload = upload.single("audio");
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const courseSyncUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 100, fields: 4, fieldSize: 20 * 1024 * 1024 }
});
const courseSyncMaxRequestBytes = 128 * 1024 * 1024;
const courseSyncRateWindowMs = 15 * 60 * 1000;
const courseSyncRateLimit = 12;
const courseSyncConcurrentLimit = 2;
const distPath = path.join(projectRoot, "dist");
const automaticPracticeStopReasons = new Set([
  "manual",
  "completed",
  "no-speech",
  "failed-attempts",
  "interrupted",
  "service-error",
  "navigation"
]);
const ttsCacheSingleFlight = createSingleFlight<string, void>();
const speechShadowQueue = createBackgroundTaskQueue({
  concurrency: Math.max(1, Math.min(2, Number(process.env.SPEECH_SHADOW_CONCURRENCY || 1))),
  maxPending: Math.max(1, Math.min(20, Number(process.env.SPEECH_SHADOW_MAX_PENDING || 8))),
  onError: (error) => console.warn("[speech-shadow] background task failed:", error)
});
registerSecurityAndAuthRoutes(app);

const courseSyncAttempts = new Map<string, number[]>();
const courseSyncFailureAuditTimes = new Map<string, number>();
let activeCourseSyncUploads = 0;

const dataDir = process.env.KID_READING_DATA_DIR
  ? path.resolve(process.env.KID_READING_DATA_DIR)
  : path.join(projectRoot, "server", "data");
const attemptAudioDir = path.join(dataDir, "attempt-audio");
const attemptCalibrationDir = path.join(dataDir, "attempt-calibration");
const ttsDir = path.join(dataDir, "tts");
const pdfImportsDir = path.join(dataDir, "imports");
const storybookImportsDir = path.join(dataDir, "storybook-imports");
const courseSyncDir = path.join(dataDir, "course-sync");

type AttemptAudioVariant = "enhanced" | "raw";

interface CalibrationAttempt extends Record<string, unknown> {
  id: string;
  childId?: string;
  speechProvider?: string;
  passed?: boolean;
  result?: AssessmentResultLike;
  speechProviderComparison?: {
    primary?: CalibrationProviderOutcome & { provider?: string };
    shadow?: CalibrationProviderOutcome & { provider?: string };
  };
}

interface CachedSentence {
  id: string;
  text: string;
  itemType?: string;
}

interface RawTtsSubtitle extends Record<string, unknown> {
  Text?: unknown;
  text?: unknown;
  BeginTime?: unknown;
  beginTime?: unknown;
  EndTime?: unknown;
  endTime?: unknown;
  BeginIndex?: unknown;
  beginIndex?: unknown;
  EndIndex?: unknown;
  endIndex?: unknown;
  Phoneme?: unknown;
  phoneme?: unknown;
}

type UnknownRecord = Record<string, unknown>;

interface StoredPdfImportResult extends UnknownRecord {
  importId?: string;
  householdId?: string;
  originalName?: string;
  title?: string;
  rule?: string;
  extractedAt?: string;
  text?: string;
  lines?: string[];
  warnings?: string[];
  quality?: PdfImportQualityReport | null;
  structure?: ParsedPdfStructure | null;
  chapters?: PdfImportChapter[];
  stats?: {
    pages?: number;
    layoutItems?: number;
    layoutLines?: number;
    detectedSentences?: number;
  };
}

interface PdfImportArtifact {
  result: StoredPdfImportResult;
  layout: PdfLayout | null;
  snapshot: PdfImportSnapshot | null;
  importDir: string;
}

interface CourseSyncAssetDescriptor extends UnknownRecord {
  id: string;
  pageNumber: number;
  fileName: string;
  mimeType: "image/png";
  width: number;
  height: number;
  role: "cover" | "source-page";
  bytes: number;
  sha256: string;
}

interface IncomingCourseSyncManifest extends UnknownRecord {
  packageId: string;
  source: UnknownRecord & { importId: string };
  metadata?: UnknownRecord & { resourceId?: unknown };
  snapshot?: CourseSyncSnapshot | null;
}

type HydratedLesson = ReturnType<typeof listLessons>[number];
type ScoredAssessment = ReturnType<typeof applyScorePolicy>;

interface AttemptCandidateInput {
  id: string;
  kind: "full-session" | "speech-segment";
  durationMs: number;
  quality?: UnknownRecord;
  audio?: Buffer;
}

interface EvaluatedAttemptCandidate extends Omit<AttemptCandidateInput, "audio"> {
  audio: Buffer;
  rawAudio: Buffer;
  speechEnhancement: SpeechEnhancementMetadata;
  assessmentDurationMs: number;
  result: ScoredAssessment;
  gate: PassGateResult;
}

interface RawAssessmentComparison extends UnknownRecord {
  error?: string;
  result?: ScoredAssessment;
  passed?: boolean;
  suggestedScore?: number;
  pronAccuracy?: number;
  pronFluency?: number;
  pronCompletion?: number;
  severeIssues?: number;
  lowAccuracyIssues?: number;
}

interface CandidateMetadata extends UnknownRecord {
  id?: string;
  kind?: "full-session" | "speech-segment";
  durationMs?: number;
  quality?: UnknownRecord;
}

interface AttemptRecord extends UnknownRecord {
  id: string;
  householdId: string;
  childId: string;
  sentenceId: string;
  referenceText: string;
  createdAt: string;
  speechProvider: string;
  audioBytes: number;
  result: ScoredAssessment;
  passed: boolean;
  severeIssues: number;
  rejectedReason?: string;
  speechEnhancement?: SpeechEnhancementMetadata & UnknownRecord;
  speechProviderComparison?: unknown;
  liveSpeechComparison?: LiveSpeechTestComparison;
  assessmentItemType?: SpeechAssessmentItemType;
  assessmentSource?: "live-stream" | "raw-wav-fallback" | "batch";
  processingTimings?: {
    enhancementMs?: number;
    primaryAssessmentMs: number;
    rawComparisonMs: number;
    decisionReadyMs: number;
    shadowState: "disabled" | "queued" | "completed" | "dropped";
    shadowProvider?: string;
    shadowAssessmentMs?: number;
    shadowCompletedAt?: string;
  };
  candidateSelection?: UnknownRecord;
  recordingQuality?: UnknownRecord;
  clientDevice?: UnknownRecord;
  storybookId?: string;
  storybookPageId?: string;
}

interface StorybookPreviewPage extends UnknownRecord {
  id: string;
  pageNumber: number;
  imageUrl: string;
  text: string;
  sentences: string[];
  practiceEnabled: boolean;
  reviewReason: string;
}

interface StorybookPreview extends UnknownRecord {
  id: string;
  title: string;
  originalName: string;
  pageCount: number;
  pages: StorybookPreviewPage[];
}

interface RequestedStorybookPage extends UnknownRecord {
  pageNumber?: number;
  practiceEnabled?: boolean;
  sentences?: unknown[];
}

type HydratedStorybook = NonNullable<ReturnType<typeof findStorybookById>>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getAttemptAudioPath(attemptId: string, variant: AttemptAudioVariant = "enhanced") {
  return path.join(attemptAudioDir, `${attemptId}${variant === "raw" ? ".raw" : ""}.wav`);
}

async function hasAttemptAudio(attemptId: string, variant: AttemptAudioVariant = "enhanced") {
  try {
    await fs.access(getAttemptAudioPath(attemptId, variant));
    return true;
  } catch {
    return false;
  }
}

const clientDiagnosticRejectionCodes = new Set(["no-speech", "too-short", "too-quiet", "capture-gap"]);

function emptyAssessmentResult(): AssessmentResultLike {
  return { SuggestedScore: 0, PronAccuracy: 0, PronFluency: 0, PronCompletion: 0, Words: [] };
}

function buildCalibrationProviderOutcomes(attempt: CalibrationAttempt) {
  const outcomes: Partial<Record<CalibrationProvider, CalibrationProviderOutcome>> = {};
  const comparison = attempt?.speechProviderComparison;
  const candidates = comparison
    ? [comparison.primary, comparison.shadow]
    : attempt?.speechProvider && attempt.speechProvider !== "not-assessed"
      ? [{
          provider: attempt.speechProvider,
          status: "success",
          passed: Boolean(attempt.passed),
          suggestedScore: Number(attempt.result?.SuggestedScore || 0),
          providerSuggestedScore: Number(attempt.result?.ProviderSuggestedScore ?? attempt.result?.SuggestedScore ?? 0)
        }]
      : [];
  for (const candidate of candidates) {
    if (!candidate?.provider || !["tencent", "xfyun"].includes(candidate.provider)) continue;
    const provider = candidate.provider as CalibrationProvider;
    outcomes[provider] = {
      status: candidate.status || "success",
      passed: typeof candidate.passed === "boolean" ? candidate.passed : undefined,
      suggestedScore: Number(candidate.suggestedScore || 0),
      providerSuggestedScore: Number(candidate.providerSuggestedScore ?? candidate.suggestedScore ?? 0),
      providerRejected: Boolean(candidate.providerRejected),
      providerExceptionCode: Number(candidate.providerExceptionCode || 0),
      error: candidate.error ? String(candidate.error).slice(0, 500) : undefined
    };
  }
  return outcomes;
}

function calibrationSampleMatchesQuery(sample: CalibrationSample, query: unknown) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [sample.id, sample.referenceText, sample.contentTitle, sample.contentId, sample.rejectionCode, sample.rejectedReason]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

async function findDiagnosticAttempt({ householdId, childId, attemptId }: {
  householdId: string;
  childId?: string;
  attemptId: string;
}) {
  const calibrationRecord = await findCalibrationRecord({ rootDir: attemptCalibrationDir, householdId, sampleId: attemptId });
  if (calibrationRecord?.sample && (!childId || calibrationRecord.childId === childId)) {
    return {
      ...calibrationRecord.sample,
      id: String(calibrationRecord.sample.id || attemptId),
      calibration: calibrationRecord.review
    } as CalibrationAttempt;
  }
  const storedAttempt = listAttemptDiagnostics({ householdId, childId, query: attemptId, limit: 20 })
    .find((attempt) => attempt.id === attemptId);
  return storedAttempt ? { ...storedAttempt, calibration: calibrationRecord?.review } as CalibrationAttempt : null;
}

function requireParentAccessSession(req: Request): ParentAccessSession {
  if (req.parentSession.kind !== "parent") throw new Error("Parent access session required");
  return req.parentSession;
}

async function buildProgress(childId: string, householdId: string) {
  const lessons = listLessons({ householdId });
  const attempts = listAttempts(childId, householdId);

  return lessons.map((lesson) => {
    const sentenceProgress = lesson.sentences.map((sentence) => {
      const sentenceAttempts = attempts.filter((attempt) => attempt.sentenceId === sentence.id);
      const validPassedAttempts = sentenceAttempts.filter(hasValidPassedScore);
      const bestAttempt = selectBestPassedAttempt(validPassedAttempts);
      const bestScore = bestAttempt ? getPolicyScore(bestAttempt.result) : 0;
      const passed = validPassedAttempts.length > 0;
      const optional = sentence.required === false;
      const completed = passed || (optional && sentenceAttempts.some((attempt) => getPolicyScore(attempt.result) > 0));
      const latestAttempt = sentenceAttempts.at(-1);

      return {
        sentenceId: sentence.id,
        attempts: sentenceAttempts.length,
        passed,
        completed,
        optional,
        bestScore: Number(bestScore.toFixed(2)),
        bestAttemptId: bestAttempt?.id,
        bestAttemptAt: bestAttempt?.createdAt,
        latestScore: latestAttempt ? Number(getPolicyScore(latestAttempt.result).toFixed(2)) : undefined,
        latestAttemptId: latestAttempt?.id,
        latestAttemptAt: latestAttempt?.createdAt
      };
    });

    return {
      lessonId: lesson.id,
      passedCount: sentenceProgress.filter((sentence) => sentence.completed).length,
      totalCount: lesson.sentences.length,
      sentences: sentenceProgress
    };
  });
}

async function findSentence(sentenceId: string, householdId: string) {
  return findSentenceById(sentenceId, householdId);
}

function makeMockAssessment(referenceText: string, durationMs: number): ProviderAssessmentResult {
  const words = referenceText.replace(/[.,!?]/g, "").split(/\s+/).filter(Boolean);
  const expectedMs = Math.max(2200, words.length * 650);
  const completion = Math.min(1, Math.max(0.35, durationMs / expectedMs));
  const pacePenalty = Math.min(18, Math.abs(durationMs - expectedMs) / 240);
  const accuracy = Math.max(58, Math.min(96, 88 - pacePenalty + Math.random() * 8));
  const fluency = Math.max(0.55, Math.min(0.98, 0.9 - pacePenalty / 100 + Math.random() * 0.05));
  const suggested = accuracy * completion * (2 - completion);

  return {
    SuggestedScore: Number(suggested.toFixed(2)),
    PronAccuracy: Number(accuracy.toFixed(2)),
    PronFluency: Number(fluency.toFixed(2)),
    PronCompletion: Number(completion.toFixed(3)),
    Words: words.map((word, index) => ({
      Word: word,
      ReferenceWord: word,
      PronAccuracy: Number(Math.max(55, accuracy - Math.random() * 18).toFixed(2)),
      PronFluency: Number(Math.max(0.5, fluency - Math.random() * 0.18).toFixed(2)),
      MatchTag: completion < 0.82 && index >= Math.ceil(words.length * completion) ? 2 : 0,
      PhoneInfos: []
    }))
  };
}

async function assessReading({
  provider = speechProvider,
  referenceText,
  itemType = "sentence",
  durationMs = 0,
  audio
}: {
  provider?: string;
  referenceText: string;
  itemType?: SpeechAssessmentItemType;
  durationMs?: number;
  audio: Uint8Array;
}): Promise<ProviderAssessmentResult> {
  if (provider === "mock") {
    return makeMockAssessment(referenceText, durationMs);
  }

  if (provider === "tencent") {
    return assessWithTencent({ referenceText, audio, itemType });
  }

  if (provider === "azure") {
    return assessWithAzure({ referenceText, audio, itemType });
  }

  if (provider === "xfyun") {
    return assessWithXfyun({ referenceText, audio, itemType });
  }

  throw new Error(`Unsupported SPEECH_PROVIDER: ${provider}`);
}

async function synthesizeSentence({
  provider = ttsProvider,
  sentence,
  voice
}: {
  provider?: string;
  sentence: CachedSentence;
  voice?: TtsVoice | null;
}): Promise<TtsSynthesisResult> {
  if (provider === "tencent") {
    return synthesizeWithTencent({ text: sentence.text, sentenceId: sentence.id, voice });
  }

  if (provider === "openai") {
    return synthesizeWithOpenAI({ text: sentence.text, sentenceId: sentence.id, voice });
  }

  throw new Error(`Unsupported TTS_PROVIDER: ${provider}`);
}

function getTtsCacheFormat(provider = ttsProvider): {
  extension: "wav" | "mp3";
  contentType: "audio/wav" | "audio/mpeg";
} {
  if (provider === "tencent") {
    const codec = process.env.TENCENT_TTS_CODEC || "mp3";
    return {
      extension: codec === "wav" ? "wav" : "mp3",
      contentType: codec === "wav" ? "audio/wav" : "audio/mpeg"
    };
  }

  return { extension: "mp3", contentType: "audio/mpeg" };
}

function normalizeTtsSubtitles(subtitles: unknown = []) {
  if (!Array.isArray(subtitles)) return [];

  return subtitles
    .filter((subtitle): subtitle is RawTtsSubtitle => Boolean(subtitle && typeof subtitle === "object" && !Array.isArray(subtitle)))
    .map((subtitle) => ({
      text: String(subtitle.Text || subtitle.text || ""),
      beginTime: Number(subtitle.BeginTime ?? subtitle.beginTime ?? 0),
      endTime: Number(subtitle.EndTime ?? subtitle.endTime ?? 0),
      beginIndex: Number.isFinite(Number(subtitle.BeginIndex ?? subtitle.beginIndex))
        ? Number(subtitle.BeginIndex ?? subtitle.beginIndex)
        : undefined,
      endIndex: Number.isFinite(Number(subtitle.EndIndex ?? subtitle.endIndex))
        ? Number(subtitle.EndIndex ?? subtitle.endIndex)
        : undefined,
      phoneme: subtitle.Phoneme || subtitle.phoneme
    }))
    .filter((subtitle) => subtitle.text && Number.isFinite(subtitle.beginTime) && Number.isFinite(subtitle.endTime))
    .sort((a, b) => a.beginTime - b.beginTime);
}

async function ensureTtsCache({ sentence, voice }: { sentence: CachedSentence; voice: TtsVoice }) {
  const format = getTtsCacheFormat();
  const providerDir = path.join(ttsDir, ttsProvider, voice.id);
  const audioPath = path.join(providerDir, `${sentence.id}.${format.extension}`);
  const subtitlesPath = path.join(providerDir, `${sentence.id}.subtitles.json`);

  let hasAudio = true;
  let hasSubtitles = true;
  try {
    await fs.access(audioPath);
  } catch {
    hasAudio = false;
  }
  try {
    await fs.access(subtitlesPath);
  } catch {
    hasSubtitles = false;
  }

  console.info(
    `[tts] provider=${ttsProvider} voice=${voice.id} sentence=${sentence.id} audioCache=${hasAudio ? "hit" : "miss"} subtitleCache=${hasSubtitles ? "hit" : "miss"}`
  );

  if (!hasAudio || !hasSubtitles) {
    const cacheKey = `${ttsProvider}:${voice.id}:${sentence.id}:${format.extension}`;
    await ttsCacheSingleFlight.run(cacheKey, async () => {
      const cacheReady = await Promise.all([
        fs.access(audioPath).then(() => true, () => false),
        fs.access(subtitlesPath).then(() => true, () => false)
      ]);
      if (cacheReady.every(Boolean)) return;

      const result = await synthesizeSentence({ sentence, voice });
      const subtitles = normalizeTtsSubtitles(result.subtitles);
      console.info(
        `[tts] provider=${ttsProvider} voice=${voice.id} sentence=${sentence.id} synthesized=true subtitles=${subtitles.length} subtitleFallback=${
          result.subtitleFallback ? "true" : "false"
        }`
      );
      await fs.mkdir(providerDir, { recursive: true });
      await fs.writeFile(audioPath, result.audio);
      await fs.writeFile(
        subtitlesPath,
        JSON.stringify(
          {
            provider: ttsProvider,
            voiceId: voice.id,
            sentenceId: sentence.id,
            generatedAt: new Date().toISOString(),
            subtitles
          },
          null,
          2
        )
      );
    });
  } else {
    try {
      const cachedSubtitles = JSON.parse(await fs.readFile(subtitlesPath, "utf8"));
      console.info(
        `[tts] provider=${ttsProvider} voice=${voice.id} sentence=${sentence.id} synthesized=false subtitles=${cachedSubtitles.subtitles?.length || 0}`
      );
    } catch {
      console.warn(`[tts] provider=${ttsProvider} voice=${voice.id} sentence=${sentence.id} subtitleCache=unreadable`);
    }
  }

  return { audioPath, subtitlesPath, format };
}

app.get("/api/health", (_req, res) => {
  const speechEnhancement = getSpeechEnhancementStatus();
  const speechProviderComparison = getSpeechProviderComparisonStatus(speechProvider);
  res.json({
    ok: true,
    speechProvider,
    ttsProvider,
    ttsDefaultVoice: getDefaultTtsVoice()?.id,
    aiProvider,
    speechEnhancement: {
      ...speechEnhancement,
      lessonDelivery: "disabled"
    },
    liveSpeech: getLiveSpeechStatus(),
    speechProviderComparison: {
      ...speechProviderComparison,
      delivery: speechProviderComparison.enabled ? "diagnostics-only" : "disabled",
      lessonDelivery: "disabled",
      queue: speechShadowQueue.status()
    },
    supportedSpeechProviders,
    supportedTtsProviders
  });
});

app.post("/api/speech/live-sessions", async (req, res, next) => {
  try {
    if (!getLiveSpeechStatus().enabled) {
      res.status(503).json({ code: "LIVE_SPEECH_DISABLED" });
      return;
    }
    const childId = String(req.body.childId || "");
    const sentenceId = String(req.body.sentenceId || "");
    const runId = String(req.body.runId || "");
    const referenceText = String(req.body.referenceText || "").trim();
    if (!childId || !sentenceId || !referenceText || !/^live-(?:test-)?[a-z0-9-]{8,100}$/i.test(runId)) {
      res.status(400).json({ error: "childId, sentenceId, runId and referenceText are required" });
      return;
    }
    if (req.parentSession.kind === "review" || !hasChildAccess(req, childId)) {
      res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
      return;
    }
    const sentence = await findSentence(sentenceId, req.parentSession.householdId);
    if (!sentence || sentence.text.trim() !== referenceText) {
      res.status(400).json({ error: "Reference text does not match the selected sentence" });
      return;
    }
    res.json(issueLiveSpeechTicket({
      runId,
      childId,
      householdId: req.parentSession.householdId,
      sentenceId,
      referenceText,
      itemType: sentence.itemType === "word" ? "word" : sentence.itemType === "reading" ? "paragraph" : "sentence"
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/speech/live-results/:runId/attach", async (req, res, next) => {
  try {
    if (!getLiveSpeechStatus().enabled) {
      res.status(503).json({ code: "LIVE_SPEECH_DISABLED" });
      return;
    }
    const childId = String(req.body.childId || "");
    const attemptId = String(req.body.attemptId || "");
    if (!childId || !attemptId || !hasChildAccess(req, childId)) {
      res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
      return;
    }
    const attempt = findAttemptById(attemptId, childId, req.parentSession.householdId);
    if (!attempt) {
      res.status(404).json({ error: "Attempt not found" });
      return;
    }
    const comparison = attachLiveSpeechTestResult({
      runId: req.params.runId,
      householdId: req.parentSession.householdId,
      childId,
      sentenceId: attempt.sentenceId,
      attemptId
    });
    if (!comparison) {
      res.status(409).json({ code: "LIVE_SPEECH_RESULT_PENDING" });
      return;
    }
    updateAttemptMetadata(attemptId, req.parentSession.householdId, { liveSpeechComparison: comparison });
    await updateAttemptDiagnosticsLiveComparison(attemptId, comparison);
    logLiveSpeechComparison(attempt, comparison);
    res.json(comparison);
  } catch (error) {
    next(error);
  }
});

app.get("/api/lessons", async (_req, res, next) => {
  try {
    const session = _req.parentSession;
    const lessons = listLessons({ householdId: session.householdId });
    if (session.kind !== "child") {
      res.json(lessons);
      return;
    }
    const child = listChildren(session.householdId).find((item) => item.id === session.childId);
    const assignedLessonIds = new Set((child?.practiceBooks || []).flatMap((book) => book.items.map((item) => item.lessonId)));
    res.json(lessons.filter((lesson) => assignedLessonIds.has(lesson.id)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/progress", async (_req, res, next) => {
  try {
    const childId = String(_req.query.childId || "");
    if (!hasChildAccess(_req, childId)) return res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
    res.json(await buildProgress(childId, _req.parentSession.householdId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/attempts/:attemptId", async (req, res, next) => {
  try {
    const childId = String(req.query.childId || "");
    if (!childId) {
      res.status(400).json({ error: "childId is required" });
      return;
    }

    if (!hasChildAccess(req, childId)) return res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
    const attempt = findAttemptById(req.params.attemptId, childId, req.parentSession.householdId);
    if (!attempt) {
      res.status(404).json({ error: "Attempt not found" });
      return;
    }

    const result = applyScorePolicy(attempt.result);
    res.json({
      ...attempt,
      result,
      passed: hasValidPassedScore({ ...attempt, result }),
      audioAvailable: await hasAttemptAudio(attempt.id),
      rawAudioAvailable: await hasAttemptAudio(attempt.id, "raw")
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/attempts/:attemptId/audio", async (req, res, next) => {
  try {
    const childId = String(req.query.childId || "");
    if (!childId) {
      res.status(400).json({ error: "childId is required" });
      return;
    }

    if (!hasChildAccess(req, childId)) return res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
    const variant = req.query.variant === "raw" ? "raw" : "enhanced";
    const attempt = findAttemptById(req.params.attemptId, childId, req.parentSession.householdId);
    if (!attempt || !(await hasAttemptAudio(attempt.id, variant))) {
      res.status(404).json({ error: "Attempt audio not found" });
      return;
    }

    const audio = await fs.readFile(getAttemptAudioPath(attempt.id, variant));
    const playbackAudio = cropAttemptPlaybackAudio(audio, applyScorePolicy(attempt.result));
    res.set("Cache-Control", "private, max-age=3600");
    res.type("audio/wav");
    res.send(playbackAudio);
  } catch (error) {
    next(error);
  }
});

app.get("/api/children", (_req, res, next) => {
  try {
    const session = _req.parentSession;
    const children = listChildren(session.householdId);
    res.json(session.kind === "child" ? children.filter((child) => child.id === session.childId) : children);
  } catch (error) {
    next(error);
  }
});

app.post("/api/automatic-practice-sessions", (req, res, next) => {
  try {
    const id = String(req.body.id || "").trim();
    const childId = String(req.body.childId || "").trim();
    const lessonId = String(req.body.lessonId || "").trim();
    const sentenceId = String(req.body.sentenceId || "").trim();
    if (!id || !childId || !lessonId || !sentenceId) {
      res.status(400).json({ error: "id, childId, lessonId and sentenceId are required" });
      return;
    }
    if (!hasChildAccess(req, childId)) return res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
    res.status(201).json(createAutomaticPracticeSession({
      id,
      childId,
      lessonId,
      sentenceId,
      householdId: req.parentSession.householdId
    }));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/automatic-practice-sessions/:sessionId", (req, res, next) => {
  try {
    const childId = String(req.body.childId || "").trim();
    const stopReason = String(req.body.stopReason || "").trim();
    if (!childId || !automaticPracticeStopReasons.has(stopReason)) {
      res.status(400).json({ error: "A valid childId and stopReason are required" });
      return;
    }
    if (!hasChildAccess(req, childId)) return res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
    const session = finishAutomaticPracticeSession({
      id: req.params.sessionId,
      childId,
      sentenceId: String(req.body.sentenceId || "").trim(),
      stopReason,
      noSpeechCount: req.body.noSpeechCount,
      failedAttemptCount: req.body.failedAttemptCount,
      householdId: req.parentSession.householdId
    });
    if (!session) {
      res.status(404).json({ error: "Automatic practice session not found" });
      return;
    }
    res.json(session);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/automatic-practice-sessions", (req, res, next) => {
  try {
    const childId = String(req.query.childId || "").trim();
    if (!childId) {
      res.status(400).json({ error: "childId is required" });
      return;
    }
    res.json(listAutomaticPracticeSessions(childId, Number(req.query.limit) || undefined, req.parentSession.householdId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/attempt-diagnostics/rejections", diagnosticAudioUpload, async (req, res, next) => {
  try {
    const householdId = req.parentSession.householdId;
    const childId = String(req.body.childId || "").trim();
    const sentenceId = String(req.body.sentenceId || "").trim();
    const referenceText = String(req.body.referenceText || "").trim();
    const rejectionCode = String(req.body.rejectionCode || "").trim();
    const sourceType = req.body.sourceType === "storybook" ? "storybook" : "lesson";
    if (!childId || !sentenceId || !referenceText || !clientDiagnosticRejectionCodes.has(rejectionCode)) {
      res.status(400).json({ error: "A valid childId, sentence, and rejectionCode are required" });
      return;
    }
    if (!hasChildAccess(req, childId)) {
      res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
      return;
    }
    const child = listChildren(householdId).find((item) => item.id === childId);
    if (!child) {
      res.status(404).json({ error: "Child not found" });
      return;
    }
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "A rejected recording is required" });
      return;
    }

    let contentId = "";
    let contentTitle = "";
    let storybookPageId;
    if (sourceType === "storybook") {
      const safeIdPattern = /^[a-z0-9][a-z0-9-]{0,119}$/i;
      contentId = String(req.body.contentId || "").trim();
      storybookPageId = String(req.body.storybookPageId || "").trim();
      if (!safeIdPattern.test(contentId) || !safeIdPattern.test(storybookPageId) || !safeIdPattern.test(sentenceId) || referenceText.length > 500) {
        res.status(400).json({ error: "Invalid storybook item" });
        return;
      }
      contentTitle = String(req.body.contentTitle || contentId).trim().slice(0, 160) || contentId;
    } else {
      const sentence = await findSentence(sentenceId, householdId);
      if (!sentence || sentence.text.trim() !== referenceText) {
        res.status(400).json({ error: "Reference text does not match the selected sentence" });
        return;
      }
      const lesson = listLessons({ includeArchived: true, householdId })
        .find((item) => item.sentences.some((itemSentence) => itemSentence.id === sentenceId));
      contentId = lesson?.id || String(req.body.contentId || "").trim().slice(0, 160);
      contentTitle = lesson?.title || String(req.body.contentTitle || contentId).trim().slice(0, 160);
    }

    const id = `rejected-${nanoid(16)}`;
    const sample = {
      id,
      childId,
      childName: child.name,
      sentenceId,
      referenceText,
      createdAt: new Date().toISOString(),
      sourceType,
      contentId,
      contentTitle,
      ...(storybookPageId ? { storybookPageId } : {}),
      speechProvider: "not-assessed",
      audioBytes: req.file.buffer.length,
      recordingQuality: parseRecordingQuality(req.body.recordingQuality),
      clientDevice: parseClientDevice(req.body.clientDevice),
      result: emptyAssessmentResult(),
      passed: false,
      severeIssues: 0,
      diagnosticStatus: "rejected",
      rejectionStage: "client",
      rejectionCode,
      rejectedReason: rejectionCode
    };
    if (process.env.KID_READING_SAVE_AUDIO === "1") {
      await fs.mkdir(attemptAudioDir, { recursive: true });
      await fs.writeFile(getAttemptAudioPath(id), req.file.buffer);
    }
    await upsertRejectedCalibrationSample({ rootDir: attemptCalibrationDir, householdId, sample });
    res.status(201).json({ id });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/attempt-diagnostics", async (req, res, next) => {
  try {
    const childId = String(req.query.childId || "").trim();
    const householdId = req.parentSession.householdId;
    const children = listChildren(householdId);
    if (childId && !children.some((child) => child.id === childId)) {
      res.status(404).json({ error: "Child not found" });
      return;
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const query = String(req.query.query || "");
    const storedRows = listAttemptDiagnostics({
      householdId,
      childId,
      query,
      limit: limit + 1
    });
    const calibrationRecords = await listCalibrationRecords({ rootDir: attemptCalibrationDir, householdId, childId });
    const calibrationById = new Map(calibrationRecords.map((record) => [record.id, record]));
    const rejectedRows = calibrationRecords.flatMap((record) => {
      const sample = record.sample;
      if (!sample || !calibrationSampleMatchesQuery(sample, query)) return [];
      return [{
        ...sample,
        id: String(sample.id || record.id || ""),
        childName: children.find((child) => child.id === record.childId)?.name || String(sample.childName || ""),
        calibration: record.review,
        diagnosticStatus: "rejected"
      } satisfies CalibrationAttempt];
    });
    const rows: CalibrationAttempt[] = [
      ...storedRows.map((attempt): CalibrationAttempt => ({
        ...attempt,
        id: String(attempt.id || ""),
        diagnosticStatus: "scored",
        calibration: calibrationById.get(String(attempt.id || ""))?.review
      })),
      ...rejectedRows
    ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    const attempts = await Promise.all(rows.slice(0, limit).map(async (attempt) => {
      const result = applyScorePolicy(attempt.result || {});
      return {
        ...attempt,
        result,
        passed: attempt.diagnosticStatus === "rejected" ? false : hasValidPassedScore({ ...attempt, result }),
        audioAvailable: await hasAttemptAudio(attempt.id),
        rawAudioAvailable: await hasAttemptAudio(attempt.id, "raw")
      };
    }));
    const rejectedSampleCount = calibrationRecords.filter((record) => record.sample).length;
    const totalSamples = countAttemptDiagnostics(childId, householdId) + rejectedSampleCount;
    res.json({
      attempts,
      hasMore: rows.length > limit,
      limit,
      calibrationSummary: summarizeCalibration(calibrationRecords, totalSamples)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/attempt-diagnostics/:attemptId/calibration", async (req, res, next) => {
  try {
    const householdId = req.parentSession.householdId;
    const childId = String(req.body.childId || "").trim();
    if (!childId || !listChildren(householdId).some((child) => child.id === childId)) {
      res.status(404).json({ error: "Child not found" });
      return;
    }
    const attempt = await findDiagnosticAttempt({ householdId, childId, attemptId: req.params.attemptId });
    if (!attempt || attempt.childId !== childId) {
      res.status(404).json({ error: "Attempt not found" });
      return;
    }
    const record = await saveCalibrationReview({
      rootDir: attemptCalibrationDir,
      householdId,
      sampleId: attempt.id,
      childId,
      label: req.body.label,
      note: req.body.note,
      reviewedBy: {
        id: requireParentAccessSession(req).id,
        username: requireParentAccessSession(req).username
      },
      providerOutcomes: buildCalibrationProviderOutcomes(attempt)
    });
    const records = await listCalibrationRecords({ rootDir: attemptCalibrationDir, householdId, childId });
    const totalSamples = countAttemptDiagnostics(childId, householdId) + records.filter((item) => item.sample).length;
    res.json({ calibration: record?.review, calibrationSummary: summarizeCalibration(records, totalSamples) });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Invalid calibration label") {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.get("/api/admin/attempt-diagnostics/:attemptId/audio", async (req, res, next) => {
  try {
    const householdId = req.parentSession.householdId;
    const childId = String(req.query.childId || "").trim();
    if (!childId || !listChildren(householdId).some((child) => child.id === childId)) {
      res.status(404).json({ error: "Child not found" });
      return;
    }
    const variant = req.query.variant === "raw" ? "raw" : "enhanced";
    const attempt = await findDiagnosticAttempt({ householdId, childId, attemptId: req.params.attemptId });
    if (!attempt || attempt.childId !== childId || !(await hasAttemptAudio(attempt.id, variant))) {
      res.status(404).json({ error: "Attempt audio not found" });
      return;
    }
    const audio = await fs.readFile(getAttemptAudioPath(attempt.id, variant));
    const playbackAudio = cropAttemptPlaybackAudio(audio, applyScorePolicy(attempt.result || emptyAssessmentResult()));
    res.set("Cache-Control", "private, max-age=3600");
    res.type("audio/wav");
    res.send(playbackAudio);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/child-pairing-codes", (req, res, next) => {
  try {
    const childId = String(req.body.childId || "").trim();
    if (!childId) return res.status(400).json({ error: "childId is required" });
    res.status(201).json(createChildPairingCode({
      householdId: req.parentSession.householdId,
      childId,
      createdByUserId: requireParentAccessSession(req).id
    }));
  } catch (error) { next(error); }
});

app.get("/api/admin/child-devices", (req, res, next) => {
  try { res.json(listChildDeviceSessions(req.parentSession.householdId)); } catch (error) { next(error); }
});

app.delete("/api/admin/child-devices/:deviceId", (req, res, next) => {
  try {
    revokeChildDeviceSession({ id: req.params.deviceId, householdId: req.parentSession.householdId });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post("/api/admin/children", (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const childId = `child-${nanoid(10)}`;
    createChild({ id: childId, name, householdId: req.parentSession.householdId });
    res.status(201).json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/children/:childId/assignment", (req, res, next) => {
  try {
    const childId = req.params.childId;
    const lessonId = String(req.body.lessonId || "").trim();
    if (!lessonId) {
      res.status(400).json({ error: "lessonId is required" });
      return;
    }

    assignLessonToChild({ childId, lessonId, householdId: req.parentSession.householdId });
    res.json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/children/:childId/practice-books", (req, res, next) => {
  try {
    const childId = req.params.childId;
    const title = String(req.body.title || "").trim();
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    createPracticeBook({ id: `practice-book-${nanoid(10)}`, childId, title, householdId: req.parentSession.householdId });
    res.status(201).json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/children/:childId/practice-books/:bookId", (req, res, next) => {
  try {
    const childId = req.params.childId;
    const bookId = req.params.bookId;
    const title = String(req.body.title || "").trim();
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    updatePracticeBook({ childId, bookId, title, householdId: req.parentSession.householdId });
    res.json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/children/:childId/practice-books/:bookId", (req, res, next) => {
  try {
    const childId = req.params.childId;
    const bookId = req.params.bookId;
    deletePracticeBook({ childId, bookId, householdId: req.parentSession.householdId });
    res.json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/children/:childId/practice-items", (req, res, next) => {
  try {
    const childId = req.params.childId;
    const lessonId = String(req.body.lessonId || "").trim();
    if (!lessonId) {
      res.status(400).json({ error: "lessonId is required" });
      return;
    }

    addLessonToPracticeBook({ childId, lessonId, bookId: req.body.bookId ? String(req.body.bookId) : undefined, householdId: req.parentSession.householdId });
    res.status(201).json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/children/:childId/practice-items/:lessonId", (req, res, next) => {
  try {
    const childId = req.params.childId;
    const lessonId = req.params.lessonId;
    removeLessonFromPracticeBook({ childId, lessonId, bookId: req.query.bookId ? String(req.query.bookId) : undefined, householdId: req.parentSession.householdId });
    res.json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/children/:childId/practice-book-items/:itemId", (req, res, next) => {
  try {
    const childId = req.params.childId;
    const itemId = req.params.itemId;
    const status = req.body.status ? String(req.body.status) : "";
    const targetBookId = req.body.targetBookId ? String(req.body.targetBookId) : "";
    const direction = req.body.direction === "up" || req.body.direction === "down" ? req.body.direction : "";

    if (!status && !targetBookId && !direction) {
      res.status(400).json({ error: "status, targetBookId, or direction is required" });
      return;
    }

    let nextItemId = itemId;

    if (targetBookId) {
      nextItemId = movePracticeBookItem({ childId, itemId: nextItemId, targetBookId, householdId: req.parentSession.householdId });
    }

    if (direction) {
      reorderPracticeBookItem({ childId, itemId: nextItemId, direction, householdId: req.parentSession.householdId });
    }

    if (status) {
      updatePracticeBookItemStatus({ childId, itemId: nextItemId, status, householdId: req.parentSession.householdId });
    }

    res.json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/children/:childId/practice-book-items/:itemId", (req, res, next) => {
  try {
    const childId = req.params.childId;
    const itemId = req.params.itemId;
    archivePracticeBookItem({ childId, itemId, householdId: req.parentSession.householdId });
    res.json(listChildren(req.parentSession.householdId).find((child) => child.id === childId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/tts/voices", (_req, res) => {
  res.json({
    provider: ttsProvider,
    defaultVoiceId: getDefaultTtsVoice()?.id,
    voices: tencentTtsVoices
  });
});

app.get("/api/admin/lessons", (_req, res) => {
  const includeArchived = String(_req.query.includeArchived || "") === "1";
  res.json(listLessons({ includeArchived, householdId: _req.parentSession.householdId }));
});

app.get("/api/admin/course-library", (req, res) => {
  const lessons = listLessons({ includeArchived: true, householdId: req.parentSession.householdId });
  const importedSourceTypes = new Set(lessons.map((lesson) => lesson.sourceType));
  const storedResources = listOfficialCourseResources().map((resource) => ({
    id: resource.id,
    title: resource.title,
    description: resource.description,
    level: resource.level,
    language: resource.language,
    tags: resource.tags,
    sourceLabel: resource.sourceLabel,
    stats: resource.stats,
    version: resource.version
  }));
  res.json(
    [...storedResources, ...listCourseLibraryResources()].map((resource) => ({
      ...resource,
      imported: importedSourceTypes.has(`library:${resource.id}`)
    }))
  );
});

app.post("/api/admin/course-library/:resourceId/import", (req, res, next) => {
  try {
    const resourceId = String(req.params.resourceId || "").trim();
    const existing = listLessons({ includeArchived: true, householdId: req.parentSession.householdId }).find(
      (lesson) => lesson.sourceType === `library:${resourceId}`
    );
    if (existing) {
      res.status(409).json({ error: "COURSE_LIBRARY_ALREADY_IMPORTED", lesson: existing });
      return;
    }
    const storedResource = listOfficialCourseResources().find((resource) => resource.id === resourceId);
    const cloned = storedResource
      ? cloneCourseLibrarySnapshot(storedResource, Number(req.body?.minScore || 75))
      : cloneCourseLibraryResource(resourceId, Number(req.body?.minScore || 75));
    if (!cloned) {
      res.status(404).json({ error: "COURSE_LIBRARY_RESOURCE_NOT_FOUND" });
      return;
    }
    createLesson({
      id: cloned.lessonId,
      title: cloned.title,
      sourceType: cloned.sourceType,
      tags: cloned.tags,
      chapters: cloned.chapters,
      householdId: req.parentSession.householdId
    });
    const lesson = listLessons({ includeArchived: true, householdId: req.parentSession.householdId }).find(
      (item) => item.id === cloned.lessonId
    );
    res.status(201).json(lesson);
  } catch (error) {
    next(error);
  }
});

app.get("/api/platform-admin/course-candidates", (req, res) => {
  const lessons = listLessons({ includeArchived: false, householdId: req.parentSession.householdId });
  res.json(
    lessons.map((lesson) => {
      const finalQuality = assessPdfImportQuality(lesson.chapters || []);
      const quality = lesson.importQuality?.status ? lesson.importQuality : finalQuality;
      return {
        id: lesson.id,
        title: lesson.title,
        sourceType: lesson.sourceType,
        tags: lesson.tags,
        chapters: lesson.chapters?.length || 0,
        sentences: lesson.sentences?.length || 0,
        quality: {
          status: quality.status === "warning" || finalQuality.status === "warning" ? "warning" : quality.status === "review" || finalQuality.status === "review" ? "review" : "good",
          high: Math.max(quality.counts?.high || 0, finalQuality.counts.high),
          medium: Math.max(quality.counts?.medium || 0, finalQuality.counts.medium),
          low: Math.max(quality.counts?.low || 0, finalQuality.counts.low)
        }
      };
    })
  );
});

app.get("/api/platform-admin/courses", (_req, res) => {
  res.json(listOfficialCourseResources({ includeUnpublished: true }).map(({ content, ...resource }) => resource));
});

app.get("/api/platform-admin/course-sync/status", (_req, res) => {
  res.json(getCourseSyncConfiguration().publicStatus);
});

app.get("/api/platform-admin/course-sync/drafts", (_req, res) => {
  res.json(listCourseSyncDrafts().map(serializeCourseSyncDraftSummary));
});

app.get("/api/platform-admin/course-sync/drafts/:draftId/assets/:fileName", async (req, res, next) => {
  try {
    const draftId = String(req.params.draftId || "");
    const fileName = String(req.params.fileName || "");
    if (!/^course-package-[a-f0-9]{24}$/.test(draftId) || !/^page-\d{3}\.png$/.test(fileName)) {
      res.status(404).end();
      return;
    }
    const draft = findCourseSyncDraft(draftId);
    if (!draft?.assets.some((asset) => asset.fileName === fileName)) {
      res.status(404).end();
      return;
    }
    const imagePath = path.resolve(courseSyncDir, draftId, "pages", fileName);
    if (!imagePath.startsWith(`${path.resolve(courseSyncDir)}${path.sep}`)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type("png").sendFile(imagePath);
  } catch (error) {
    next(error);
  }
});

app.post("/api/platform-admin/course-sync/send", requireLocalCourseStudio, async (req, res, next) => {
  try {
    const configuration = getCourseSyncConfiguration();
    if (!configuration.targetEnabled || !configuration.target) {
      res.status(503).json({ error: "COURSE_SYNC_TARGET_NOT_CONFIGURED" });
      return;
    }
    const importId = String(req.body.importId || "").trim();
    const uploadedChapters = Array.isArray(req.body.chapters) ? req.body.chapters : [];
    const artifact = await readPdfImportArtifact(importId, req.parentSession.householdId);
    if (!artifact || uploadedChapters.length === 0) {
      res.status(404).json({ error: "PDF_IMPORT_PREVIEW_NOT_FOUND" });
      return;
    }
    const title = String(req.body.title || artifact.result?.title || "PDF 导入课程").trim().slice(0, 100);
    const description = String(req.body.description || "").trim().slice(0, 500);
    const sourceLabel = String(req.body.sourceLabel || "").trim().slice(0, 100);
    if (!title || !description || !sourceLabel) {
      res.status(400).json({ error: "OFFICIAL_COURSE_METADATA_REQUIRED" });
      return;
    }
    const sourceLessonId = `official-upload-${importId}`;
    const normalized = buildLessonChapters({
      lessonId: sourceLessonId,
      title,
      text: "",
      chapters: uploadedChapters,
      minScore: 75
    });
    if (normalized.totalSentences === 0 || normalized.totalSentences > maxPdfImportSentences) {
      res.status(422).json({ error: normalized.totalSentences === 0 ? "PDF_IMPORT_EMPTY" : "PDF_IMPORT_TOO_LARGE" });
      return;
    }
    const quality = assessPdfImportQuality(normalized.chapters, {
      layout: artifact.layout,
      structure: artifact.result?.structure || null,
      ocr: artifact.result?.quality?.ocr || null
    });
    const blockers = getPdfPublicationBlockers(quality);
    if (blockers.length > 0) {
      res.status(422).json({ error: "SOURCE_LESSON_QUALITY_BLOCKED", blockers, quality });
      return;
    }
    const pageAssets = artifact.snapshot?.pageAssets || [];
    const pageNumbers = collectReferencedPageNumbers(
      artifact.result?.structure as unknown as Parameters<typeof collectReferencedPageNumbers>[0],
      pageAssets.length || Number(artifact.result?.stats?.pages || 0)
    );
    const assetFiles: Array<{ descriptor: CourseSyncAssetDescriptor; buffer: Buffer }> = [];
    const assetDescriptors: CourseSyncAssetDescriptor[] = [];
    for (const pageNumber of pageNumbers) {
      const sourceAsset = pageAssets.find((asset) => Number(asset.pageNumber) === pageNumber);
      if (!sourceAsset || !/^page-\d{3}\.png$/.test(String(sourceAsset.fileName || ""))) continue;
      const fileName = String(sourceAsset.fileName || "");
      const buffer = await fs.readFile(path.join(artifact.importDir, "pages", fileName));
      const descriptor: CourseSyncAssetDescriptor = {
        id: String(sourceAsset.id || `page-${pageNumber}`),
        pageNumber,
        fileName,
        mimeType: "image/png",
        width: Number(sourceAsset.width || 0),
        height: Number(sourceAsset.height || 0),
        role: pageNumber === 1 ? "cover" : "source-page",
        bytes: buffer.length,
        sha256: sha256(buffer)
      };
      assetDescriptors.push(descriptor);
      assetFiles.push({ descriptor, buffer });
    }
    if (assetDescriptors.length === 0) {
      res.status(422).json({ error: "COURSE_SYNC_ASSETS_INCOMPLETE" });
      return;
    }
    const generatedAt = String(artifact.snapshot?.extractedAt || artifact.result?.extractedAt || new Date().toISOString());
    const targetResourceId = String(req.body.resourceId || "").trim()
      || `official-course-sync-${sha256(title.toLocaleLowerCase()).slice(0, 10)}`;
    const metadata = {
      resourceId: targetResourceId,
      title,
      description,
      level: String(req.body.level || "入门").trim().slice(0, 30),
      language: String(req.body.language || "英语").trim().slice(0, 30),
      tags: Array.isArray(req.body.tags) ? req.body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean).slice(0, 20) : [],
      sourceLabel
    };
    const content = {
      id: sourceLessonId,
      title,
      sourceType: "pdf",
      tags: metadata.tags,
      status: "published",
      chapters: normalized.chapters,
      sentences: normalized.chapters.flatMap((chapter) => chapter.sentences || [])
    };
    const filteredSnapshot = filterSnapshotForCourseSync(
      artifact.snapshot as unknown as Parameters<typeof filterSnapshotForCourseSync>[0],
      pageNumbers,
      normalized.chapters
    );
    if (filteredSnapshot) filteredSnapshot.householdId = "";
    const packageSeed = {
      sourceImportId: importId,
      metadata,
      content,
      qualityHash: sha256(JSON.stringify(quality)),
      assets: assetDescriptors
    };
    const manifest = {
      schemaVersion: 1,
      packageId: createCourseSyncPackageId(packageSeed),
      generatedAt,
      source: {
        importId,
        parser: "kid-english-reading-mvp",
        rule: String(artifact.result?.rule || "default"),
        originalTitle: String(artifact.result?.title || title)
      },
      metadata,
      content,
      quality,
      snapshot: filteredSnapshot,
      assets: assetDescriptors
    };
    const manifestRaw = JSON.stringify(manifest);
    const packageHash = sha256(manifestRaw);
    const timestamp = String(Date.now());
    const nonce = createCourseSyncNonce();
    const signature = createCourseSyncSignature({
      key: configuration.key,
      keyId: configuration.keyId,
      timestamp,
      nonce,
      packageHash
    });
    const form = new FormData();
    form.append("manifest", manifestRaw);
    for (const assetFile of assetFiles) {
      form.append("assets", new Blob([assetFile.buffer], { type: "image/png" }), assetFile.descriptor.fileName);
    }
    const endpoint = new URL("/api/course-sync/packages", configuration.target);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.key}`,
        "X-Course-Key-Id": configuration.keyId,
        "X-Course-Timestamp": timestamp,
        "X-Course-Nonce": nonce,
        "X-Course-Signature": signature,
        "X-Course-Package-Sha256": packageHash
      },
      body: form,
      signal: AbortSignal.timeout(180_000)
    });
    const rawResponseBody: unknown = await response.json().catch(() => ({}));
    const responseBody = isRecord(rawResponseBody) ? rawResponseBody : {};
    if (!response.ok) {
      res.status(502).json({
        error: "COURSE_SYNC_REMOTE_REJECTED",
        remoteStatus: response.status,
        remoteError: String(responseBody.error || "REMOTE_ERROR")
      });
      return;
    }
    res.json({
      ...responseBody,
      targetUrl: configuration.publicStatus.targetUrl,
      uploadedImages: assetDescriptors.length,
      uploadedBytes: assetDescriptors.reduce((sum, asset) => sum + asset.bytes, 0)
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError") {
      res.status(504).json({ error: "COURSE_SYNC_REMOTE_TIMEOUT" });
      return;
    }
    next(error);
  }
});

app.post("/api/platform-admin/course-sync/drafts/:draftId/publish", (req, res, next) => {
  try {
    const draft = findCourseSyncDraft(req.params.draftId);
    if (!draft) {
      res.status(404).json({ error: "COURSE_SYNC_DRAFT_NOT_FOUND" });
      return;
    }
    if (draft.status === "published") {
      const existing = listOfficialCourseResources({ includeUnpublished: true })
        .find((resource) => resource.id === draft.publishedResourceId);
      res.json(existing ? { ...existing, content: undefined } : serializeCourseSyncDraftSummary(draft));
      return;
    }
    const validated = validateCourseSyncManifest(draft.manifest);
    const metadata = draft.manifest.metadata || {};
    const content = draft.manifest.content || {};
    const quality = draft.manifest.quality || assessPdfImportQuality(validated.chapters);
    const finalQuality = assessPdfImportQuality(validated.chapters);
    const blockers = [...getPdfPublicationBlockers(quality), ...getPdfPublicationBlockers(finalQuality)];
    if (blockers.length > 0) {
      res.status(422).json({ error: "SOURCE_LESSON_QUALITY_BLOCKED", blockers, quality, finalQuality });
      return;
    }
    const resourceId = String(draft.targetResourceId || metadata.resourceId || `official-course-${nanoid(10)}`);
    const requestedSlug = String(metadata.slug || metadata.title)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    const resource = publishOfficialCourseResource({
      id: resourceId,
      slug: requestedSlug || resourceId,
      title: String(metadata.title).trim().slice(0, 100),
      description: String(metadata.description).trim().slice(0, 500),
      level: String(metadata.level || "入门").trim().slice(0, 30),
      language: String(metadata.language || "英语").trim().slice(0, 30),
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      sourceLabel: String(metadata.sourceLabel || "本机审核同步").trim().slice(0, 100),
      sourceHouseholdId: "course-sync",
      sourceLessonId: String(content.id || `synced-${draft.sourceImportId}`),
      content: {
        ...content,
        sourceAssets: draft.assets,
        importSnapshot: draft.manifest.snapshot || null,
        syncPackageId: draft.id
      },
      quality,
      createdByUserId: requireParentAccessSession(req).id
    });
    if (!resource) throw new Error("OFFICIAL_COURSE_PUBLISH_FAILED");
    markCourseSyncDraftPublished({ id: draft.id, resourceId: resource.id, version: resource.version });
    res.status(201).json({ ...resource, content: undefined });
  } catch (error: unknown) {
    if (String(error instanceof Error ? error.message : error || "").includes("UNIQUE constraint failed: official_course_resources.slug")) {
      res.status(409).json({ error: "OFFICIAL_COURSE_SLUG_TAKEN" });
      return;
    }
    next(error);
  }
});

app.get("/api/platform-admin/logs", (req, res) => {
  res.json(listPlatformAdminAuditLogs({ limit: Number(req.query.limit) || undefined }));
});

function registrationKeyManagementSnapshot() {
  const keys = listRegistrationKeyRecords({ limit: 1000 });
  return {
    keys,
    stats: {
      total: keys.length,
      active: keys.filter((key) => key.status === "active").length,
      used: keys.filter((key) => key.status === "used").length,
      expired: keys.filter((key) => key.status === "expired").length,
      disabled: keys.filter((key) => key.status === "disabled").length
    }
  };
}

app.get("/api/platform-admin/registration-keys", (_req, res) => {
  res.json(registrationKeyManagementSnapshot());
});

app.post("/api/platform-admin/registration-keys/batch", (req, res) => {
  const quantity = Number(req.body?.quantity);
  const expiresInHours = Number(req.body?.expiresInHours);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    res.status(400).json({ error: "KEY_QUANTITY_INVALID" });
    return;
  }
  if (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 24 * 90) {
    res.status(400).json({ error: "KEY_EXPIRY_INVALID" });
    return;
  }
  const note = String(req.body?.note || "").trim().slice(0, 300);
  const label = String(req.body?.label || "管理员批次").trim().slice(0, 120) || "管理员批次";
  const batchId = `registration-batch-${nanoid(12)}`;
  const expiresAt = new Date(Date.now() + Math.round(expiresInHours * 60 * 60 * 1000)).toISOString();
  const generated = Array.from({ length: quantity }, () => createRegistrationKey({
    batchId,
    label,
    note,
    maxUses: 1,
    expiresAt,
    createdByUserId: requireParentAccessSession(req).id
  }));
  res.status(201).json({ batchId, expiresAt, generated, snapshot: registrationKeyManagementSnapshot() });
});

app.patch("/api/platform-admin/registration-keys/:keyId", (req, res) => {
  const updated = updateRegistrationKeyNote(req.params.keyId, req.body?.note);
  if (!updated) {
    res.status(404).json({ error: "REGISTRATION_KEY_NOT_FOUND" });
    return;
  }
  res.json(registrationKeyManagementSnapshot());
});

app.post("/api/platform-admin/registration-keys/:keyId/disable", (req, res) => {
  const disabled = disableRegistrationKey(req.params.keyId);
  if (!disabled) {
    res.status(409).json({ error: "REGISTRATION_KEY_NOT_ACTIVE" });
    return;
  }
  res.json(registrationKeyManagementSnapshot());
});

app.get("/api/platform-admin/hunyuan-ocr/status", requireLocalCourseStudio, async (_req, res, next) => {
  try {
    res.json(await getHunyuanOcrStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/platform-admin/hunyuan-ocr/start", requireLocalCourseStudio, async (_req, res, next) => {
  try {
    res.json(await startHunyuanOcrService());
  } catch (error) {
    next(error);
  }
});

app.post("/api/platform-admin/hunyuan-ocr/stop", requireLocalCourseStudio, async (_req, res, next) => {
  try {
    res.json(await stopHunyuanOcrService());
  } catch (error) {
    next(error);
  }
});

app.get("/api/platform-admin/paddle-ocr/status", requireLocalCourseStudio, async (_req, res, next) => {
  try {
    res.json(await getPaddleOcrStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/platform-admin/paddle-ocr/start", requireLocalCourseStudio, async (_req, res, next) => {
  try {
    res.json(await startPaddleOcrService());
  } catch (error) {
    next(error);
  }
});

app.post("/api/platform-admin/paddle-ocr/stop", requireLocalCourseStudio, async (_req, res, next) => {
  try {
    res.json(await stopPaddleOcrService());
  } catch (error) {
    next(error);
  }
});

async function readPdfImportArtifact(importId: string, householdId = ""): Promise<PdfImportArtifact | null> {
  const normalizedId = String(importId || "").trim();
  if (!/^pdf-\d{14}-[A-Za-z0-9_-]{8}$/.test(normalizedId)) return null;
  const importDir = path.resolve(pdfImportsDir, normalizedId);
  if (!importDir.startsWith(`${path.resolve(pdfImportsDir)}${path.sep}`)) return null;
  try {
    const [resultJson, layoutJson, snapshotJson] = await Promise.all([
      fs.readFile(path.join(importDir, "result.json"), "utf8"),
      fs.readFile(path.join(importDir, "layout.json"), "utf8"),
      fs.readFile(path.join(importDir, "snapshot.json"), "utf8").catch(() => "null")
    ]);
    const result = JSON.parse(resultJson) as StoredPdfImportResult;
    const snapshot = JSON.parse(snapshotJson) as PdfImportSnapshot | null;
    const ownerHouseholdId = snapshot?.householdId || result?.householdId || "";
    if (householdId && ownerHouseholdId !== householdId) return null;
    const layoutContainer = JSON.parse(layoutJson) as { layout?: PdfLayout | null };
    return { result, layout: layoutContainer.layout || null, snapshot, importDir };
  } catch {
    return null;
  }
}

async function updatePdfImportFinalArtifact(importId: string, householdId: string, chapters: PdfImportChapter[]) {
  const artifact = await readPdfImportArtifact(importId, householdId);
  if (!artifact?.snapshot?.layers?.final) return false;
  artifact.snapshot.layers.final.chapters = chapters;
  artifact.snapshot.layers.final.approvedAt = new Date().toISOString();
  artifact.snapshot.layers.final.reviewStatus = artifact.snapshot.layers.differences?.pending > 0
    ? "approved-with-pending-differences"
    : "approved";
  await fs.writeFile(path.join(artifact.importDir, "snapshot.json"), JSON.stringify(artifact.snapshot, null, 2));
  return true;
}

function serializeCourseSyncDraftSummary(draft: NonNullable<ReturnType<typeof findCourseSyncDraft>>) {
  const metadata = draft.manifest?.metadata || {};
  const content = draft.manifest?.content || {};
  return {
    id: draft.id,
    title: draft.title,
    status: draft.status,
    sourceImportId: draft.sourceImportId,
    targetResourceId: draft.targetResourceId,
    description: String(metadata.description || ""),
    sourceLabel: String(metadata.sourceLabel || "本机审核同步"),
    stats: {
      chapters: Array.isArray(content.chapters) ? content.chapters.length : 0,
      sentences: Array.isArray(content.chapters)
        ? content.chapters.reduce((sum: number, chapter) => sum + (chapter.sentences?.length || 0), 0)
        : 0,
      images: draft.assets.length
    },
    receivedAt: draft.receivedAt,
    publishedAt: draft.publishedAt,
    publishedResourceId: draft.publishedResourceId,
    publishedVersion: draft.publishedVersion
  };
}

function courseSyncBearerToken(req: Request) {
  const authorization = String(req.get("authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function courseSyncClientAddress(req: Request) {
  const remoteAddress = String(req.socket?.remoteAddress || "unknown");
  const loopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (!loopback) return remoteAddress;
  return String(req.get("x-forwarded-for") || "").split(",")[0].trim() || remoteAddress;
}

function writeCourseSyncInboundAudit(req: Request, {
  status,
  summary,
  metadata = {}
}: {
  status: string;
  summary: string;
  metadata?: UnknownRecord;
}) {
  try {
    createPlatformAdminAuditLog({
      id: `sync-audit-${nanoid(14)}`,
      actorUserId: `course-sync:${String(req.courseSyncAuth?.keyId || "unknown").slice(0, 32)}`,
      actorUsername: `同步通道:${String(req.courseSyncAuth?.keyId || "unknown").slice(0, 32)}`,
      action: "course.sync.receive",
      status,
      summary,
      metadata: {
        clientAddress: courseSyncClientAddress(req),
        keyId: String(req.courseSyncAuth?.keyId || req.get("x-course-key-id") || "").slice(0, 32),
        packageHashPrefix: String(req.get("x-course-package-sha256") || "").slice(0, 12),
        contentLength: Number(req.get("content-length") || 0),
        ...metadata
      }
    });
  } catch (error) {
    console.error("[course-sync-audit] unable to persist log", error);
  }
}

function rejectCourseSyncPreflight(req: Request, res: Response, statusCode: number, error: string) {
  const auditKey = `${courseSyncClientAddress(req)}:${error}`;
  const now = Date.now();
  const lastAuditAt = courseSyncFailureAuditTimes.get(auditKey) || 0;
  if (req.courseSyncAuth || now - lastAuditAt >= 60 * 1000) {
    courseSyncFailureAuditTimes.set(auditKey, now);
    writeCourseSyncInboundAudit(req, { status: "failure", summary: `课程同步接收被拒绝：${error}`, metadata: { statusCode } });
  }
  res.status(statusCode).json({ error });
}

function checkCourseSyncRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = courseSyncClientAddress(req);
  const now = Date.now();
  if (courseSyncAttempts.size > 2048) {
    for (const [address, timestamps] of courseSyncAttempts) {
      const active = timestamps.filter((timestamp) => now - timestamp < courseSyncRateWindowMs);
      if (active.length === 0) courseSyncAttempts.delete(address);
      else courseSyncAttempts.set(address, active);
    }
    while (courseSyncAttempts.size > 4096) {
      const oldestAddress = courseSyncAttempts.keys().next().value;
      if (!oldestAddress) break;
      courseSyncAttempts.delete(oldestAddress);
    }
  }
  if (courseSyncFailureAuditTimes.size > 4096) {
    for (const [auditKey, timestamp] of courseSyncFailureAuditTimes) {
      if (now - timestamp >= courseSyncRateWindowMs) courseSyncFailureAuditTimes.delete(auditKey);
    }
  }
  const recent = (courseSyncAttempts.get(key) || []).filter((timestamp) => now - timestamp < courseSyncRateWindowMs);
  if (recent.length >= courseSyncRateLimit) {
    res.setHeader("Retry-After", String(Math.ceil(courseSyncRateWindowMs / 1000)));
    rejectCourseSyncPreflight(req, res, 429, "COURSE_SYNC_RATE_LIMITED");
    return;
  }
  recent.push(now);
  courseSyncAttempts.set(key, recent);
  next();
}

function checkCourseSyncRequestSize(req: Request, res: Response, next: NextFunction) {
  const contentLength = Number(req.get("content-length") || 0);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    rejectCourseSyncPreflight(req, res, 411, "COURSE_SYNC_CONTENT_LENGTH_REQUIRED");
    return;
  }
  if (contentLength > courseSyncMaxRequestBytes) {
    rejectCourseSyncPreflight(req, res, 413, "COURSE_SYNC_PACKAGE_TOO_LARGE");
    return;
  }
  next();
}

function authenticateCourseSyncRequest(req: Request, res: Response, next: NextFunction) {
  const configuration = getCourseSyncConfiguration();
  if (!configuration.inboundEnabled) {
    rejectCourseSyncPreflight(req, res, 503, "COURSE_SYNC_RECEIVER_NOT_CONFIGURED");
    return;
  }
  const bearer = courseSyncBearerToken(req);
  const keyId = String(req.get("x-course-key-id") || "");
  const key = configuration.keys.get(keyId);
  const packageHash = String(req.get("x-course-package-sha256") || "").toLowerCase();
  const timestamp = String(req.get("x-course-timestamp") || "");
  const nonce = String(req.get("x-course-nonce") || "");
  const signature = String(req.get("x-course-signature") || "").toLowerCase();
  const legacyKeyId = [...configuration.keys.entries()].find(([, candidate]) => courseSyncKeyMatches(bearer, candidate))?.[0];
  if (configuration.legacyBearerAllowed && legacyKeyId && !signature) {
    req.courseSyncAuth = { keyId: legacyKeyId, legacy: true };
    next();
    return;
  }
  if (!key || !courseSyncKeyMatches(bearer, key)) {
    rejectCourseSyncPreflight(req, res, 401, "COURSE_SYNC_KEY_INVALID");
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(packageHash) || !isCourseSyncNonce(nonce) || !isCourseSyncTimestampFresh(timestamp)) {
    rejectCourseSyncPreflight(req, res, 401, "COURSE_SYNC_SIGNATURE_EXPIRED_OR_INVALID");
    return;
  }
  if (!verifyCourseSyncSignature({
    key,
    keyId,
    timestamp,
    nonce,
    packageHash,
    signature,
    method: req.method,
    pathname: req.path
  })) {
    rejectCourseSyncPreflight(req, res, 401, "COURSE_SYNC_SIGNATURE_INVALID");
    return;
  }
  const now = Date.now();
  if (!consumeCourseSyncNonce({ keyId, nonce, now, expiresAt: now + 10 * 60 * 1000 })) {
    rejectCourseSyncPreflight(req, res, 409, "COURSE_SYNC_REPLAY_REJECTED");
    return;
  }
  req.courseSyncAuth = { keyId, legacy: false };
  next();
}

function limitCourseSyncConcurrency(req: Request, res: Response, next: NextFunction) {
  if (activeCourseSyncUploads >= courseSyncConcurrentLimit) {
    rejectCourseSyncPreflight(req, res, 503, "COURSE_SYNC_BUSY");
    return;
  }
  activeCourseSyncUploads += 1;
  const startedAt = Date.now();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeCourseSyncUploads = Math.max(0, activeCourseSyncUploads - 1);
  };
  res.once("finish", () => {
    release();
    writeCourseSyncInboundAudit(req, {
      status: res.statusCode < 400 ? "success" : "failure",
      summary: `课程同步接收${res.statusCode < 400 ? "完成" : "失败"}`,
      metadata: { statusCode: res.statusCode, durationMs: Date.now() - startedAt }
    });
  });
  res.once("close", release);
  next();
}

function rewriteCourseSyncSnapshotUrls(
  snapshot: CourseSyncSnapshot | null | undefined,
  draftId: string,
  assets: Array<UnknownRecord & { pageNumber: number; url: string }>
) {
  if (!snapshot) return null;
  const urlByPage = new Map(assets.map((asset) => [Number(asset.pageNumber), asset.url]));
  return {
    ...snapshot,
    householdId: "",
    pageAssets: (snapshot.pageAssets || []).map((asset) => ({
      ...asset,
      url: urlByPage.get(Number(asset.pageNumber)) || ""
    })),
    layers: {
      ...snapshot.layers,
      local: {
        ...snapshot.layers?.local,
        pages: (snapshot.layers?.local?.pages || []).map((page) => ({
          ...page,
          imageUrl: urlByPage.get(Number(page.pageNumber)) || ""
        }))
      }
    },
    syncedDraftId: draftId
  };
}

app.post(
  "/api/course-sync/packages",
  checkCourseSyncRateLimit,
  checkCourseSyncRequestSize,
  authenticateCourseSyncRequest,
  limitCourseSyncConcurrency,
  courseSyncUpload.array("assets", 100),
  async (req, res, next) => {
  try {
    const manifestRaw = String(req.body?.manifest || "");
    if (!manifestRaw || manifestRaw.length > 20 * 1024 * 1024) {
      res.status(400).json({ error: "COURSE_SYNC_PACKAGE_INVALID" });
      return;
    }
    const suppliedHash = String(req.get("x-course-package-sha256") || "").toLowerCase();
    const packageHash = sha256(manifestRaw);
    if (!/^[a-f0-9]{64}$/.test(suppliedHash) || suppliedHash !== packageHash) {
      res.status(400).json({ error: "COURSE_SYNC_PACKAGE_HASH_MISMATCH" });
      return;
    }
    const parsedManifest: unknown = JSON.parse(manifestRaw);
    const validated = validateCourseSyncManifest(parsedManifest);
    const manifest = parsedManifest as IncomingCourseSyncManifest;
    const existing = findCourseSyncDraft(manifest.packageId);
    if (existing) {
      if (existing.packageHash !== packageHash) {
        res.status(409).json({ error: "COURSE_SYNC_PACKAGE_ID_CONFLICT" });
        return;
      }
      res.json(serializeCourseSyncDraftSummary(existing));
      return;
    }
    const files = Array.isArray(req.files) ? req.files : [];
    const fileByName = new Map(files.map((file) => [path.basename(file.originalname), file]));
    const totalBytes = files.reduce((sum, file) => sum + Number(file.size || file.buffer?.length || 0), 0);
    if (files.length !== validated.assets.length || totalBytes > 120 * 1024 * 1024) {
      res.status(400).json({ error: "COURSE_SYNC_ASSETS_INCOMPLETE" });
      return;
    }
    for (const asset of validated.assets) {
      const file = fileByName.get(asset.fileName);
      const pngSignature = file?.buffer?.subarray(0, 8);
      const validPng = pngSignature?.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!file || !validPng || sha256(file.buffer) !== asset.sha256 || Number(file.size || 0) !== Number(asset.bytes || 0)) {
        res.status(400).json({ error: "COURSE_SYNC_ASSET_HASH_MISMATCH", fileName: asset.fileName });
        return;
      }
    }

    const draftDir = path.resolve(courseSyncDir, manifest.packageId);
    if (!draftDir.startsWith(`${path.resolve(courseSyncDir)}${path.sep}`)) {
      res.status(400).json({ error: "COURSE_SYNC_PACKAGE_INVALID" });
      return;
    }
    const storedDraftExists = await fs.stat(draftDir).then(() => true).catch(() => false);
    if (storedDraftExists) {
      res.status(409).json({ error: "COURSE_SYNC_DRAFT_STORAGE_CONFLICT" });
      return;
    }
    const incomingDir = path.resolve(courseSyncDir, `.incoming-${manifest.packageId}-${nanoid(6)}`);
    if (!incomingDir.startsWith(`${path.resolve(courseSyncDir)}${path.sep}`)) {
      res.status(400).json({ error: "COURSE_SYNC_PACKAGE_INVALID" });
      return;
    }
    const pagesDir = path.join(incomingDir, "pages");
    await fs.mkdir(pagesDir, { recursive: true });
    const storedAssets: Array<NormalizedCourseSyncAsset & { url: string }> = [];
    for (const asset of validated.assets) {
      const file = fileByName.get(asset.fileName);
      if (!file) throw new Error("COURSE_SYNC_ASSETS_INCOMPLETE");
      await fs.writeFile(path.join(pagesDir, asset.fileName), file.buffer, { flag: "wx" });
      storedAssets.push({
        ...asset,
        url: `/api/platform-admin/course-sync/drafts/${manifest.packageId}/assets/${asset.fileName}`
      });
    }
    await fs.rename(incomingDir, draftDir);
    const storedManifest = {
      ...manifest,
      snapshot: rewriteCourseSyncSnapshotUrls(manifest.snapshot, manifest.packageId, storedAssets),
      assets: storedAssets
    };
    const draft = saveCourseSyncDraft({
      id: manifest.packageId,
      packageHash,
      sourceImportId: manifest.source.importId,
      targetResourceId: String(manifest.metadata?.resourceId || ""),
      title: validated.title,
      manifest: storedManifest,
      assets: storedAssets
    });
    if (!draft) throw new Error("COURSE_SYNC_DRAFT_SAVE_FAILED");
    res.status(201).json(serializeCourseSyncDraftSummary(draft));
  } catch (error: unknown) {
    const code = String(error instanceof Error ? error.message : error || "");
    if (code.startsWith("COURSE_SYNC_")) {
      res.status(400).json({ error: code });
      return;
    }
    next(error);
  }
});

app.get("/api/import/pdf/artifacts/:importId/pages/:fileName", async (req, res, next) => {
  try {
    const fileName = String(req.params.fileName || "");
    if (!/^page-\d{3}\.png$/.test(fileName)) {
      res.status(404).end();
      return;
    }
    const artifact = await readPdfImportArtifact(req.params.importId, req.parentSession.householdId);
    if (!artifact) {
      res.status(404).end();
      return;
    }
    const imagePath = path.join(artifact.importDir, "pages", fileName);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type("png").sendFile(imagePath);
  } catch (error) {
    next(error);
  }
});

function serializePdfImportPreview(artifact: PdfImportArtifact) {
  const result = artifact.result || {};
  const snapshot = artifact.snapshot || undefined;
  const layout = artifact.layout;
  if (snapshot?.layers?.local?.pages && layout?.pages) {
    snapshot.layers.local.pages = snapshot.layers.local.pages.map((localPage) => {
      const layoutPage = layout.pages.find((page) => Number(page.page) === Number(localPage.pageNumber));
      if (!layoutPage) return localPage;
      return {
        ...localPage,
        width: Number(layoutPage.width || 0),
        height: Number(layoutPage.height || 0),
        blocks: (localPage.blocks || []).map((block, index) => {
          const line = layoutPage.lines?.[index];
          return line ? {
            ...block,
            x: Number(line.x || 0),
            top: Number(line.top ?? line.y ?? 0),
            width: Number(line.width || 0),
            height: Number(line.height || line.fontSize || 0),
            pageWidth: Number(layoutPage.width || 0),
            pageHeight: Number(layoutPage.height || 0)
          } : block;
        })
      };
    });
  }
  return {
    provider: "local-pdf",
    importId: result.importId,
    rule: result.rule || "default",
    sourceType: "pdf",
    title: result.title || "PDF 导入课程",
    tags: ["PDF导入"],
    warnings: result.warnings || [],
    quality: result.quality || null,
    structure: result.structure || null,
    stats: {
      pages: Number(result.stats?.pages || 0),
      characters: String(result.text || "").length,
      lines: Array.isArray(result.lines) ? result.lines.length : 0,
      layoutLines: Number(result.stats?.layoutLines || 0),
      layoutItems: Number(result.stats?.layoutItems || 0),
      chapters: Array.isArray(result.chapters) ? result.chapters.length : 0,
      sentences: Array.isArray(result.chapters) ? result.chapters.reduce((sum: number, chapter) => sum + (chapter.sentences?.length || 0), 0) : 0,
      detectedSentences: Number(result.stats?.detectedSentences || 0)
    },
    chapters: result.chapters || [],
    importSnapshot: snapshot
  };
}

function collectLessonSentenceIds(chapters: PdfImportChapter[] = []) {
  return new Set(
    chapters.flatMap((chapter) =>
      (chapter.sentences || []).map((sentence) => String(sentence.id || "")).filter(Boolean)
    )
  );
}

async function findPdfImportArtifactForLesson(lesson: HydratedLesson | null | undefined, householdId: string) {
  if (!lesson || lesson.sourceType !== "pdf") return null;
  if (lesson.importId) {
    const linkedArtifact = await readPdfImportArtifact(lesson.importId, householdId);
    if (linkedArtifact) return linkedArtifact;
  }

  const lessonSentenceIds = collectLessonSentenceIds(lesson.chapters || []);
  const normalizedTitle = String(lesson.title || "").trim().toLocaleLowerCase();
  const entries = await fs.readdir(pdfImportsDir, { withFileTypes: true }).catch(() => []);
  const importIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  let bestMatch: { artifact: PdfImportArtifact; score: number } | null = null;

  for (const importId of importIds) {
    const artifact = await readPdfImportArtifact(importId, householdId);
    if (!artifact) continue;
    const finalChapters = artifact.snapshot?.layers?.final?.chapters || artifact.result?.chapters || [];
    const artifactSentenceIds = collectLessonSentenceIds(finalChapters);
    let overlappingIds = 0;
    for (const sentenceId of lessonSentenceIds) {
      if (artifactSentenceIds.has(sentenceId)) overlappingIds += 1;
    }
    const overlapRatio = lessonSentenceIds.size > 0 ? overlappingIds / lessonSentenceIds.size : 0;
    const artifactTitle = String(artifact.result?.title || artifact.snapshot?.title || "").trim().toLocaleLowerCase();
    const titleMatches = Boolean(normalizedTitle && artifactTitle === normalizedTitle);
    const chapterCountMatches = finalChapters.length > 0 && finalChapters.length === (lesson.chapters || []).length;
    const score = overlapRatio * 100 + (titleMatches ? 30 : 0) + (chapterCountMatches ? 5 : 0);
    if ((overlapRatio >= 0.5 || titleMatches) && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { artifact, score };
    }
  }

  return bestMatch?.artifact || null;
}

app.get("/api/import/pdf/latest", async (req, res, next) => {
  try {
    const entries = await fs.readdir(pdfImportsDir, { withFileTypes: true }).catch(() => []);
    const importIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    for (const importId of importIds) {
      const artifact = await readPdfImportArtifact(importId, req.parentSession.householdId);
      if (artifact?.result?.chapters?.length) {
        res.json(serializePdfImportPreview(artifact));
        return;
      }
    }
    res.status(404).json({ error: "PDF_IMPORT_PREVIEW_NOT_FOUND" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/lessons/:lessonId/pdf-import", async (req, res, next) => {
  try {
    const lesson = listLessons({ includeArchived: true, householdId: req.parentSession.householdId })
      .find((item) => item.id === req.params.lessonId);
    if (!lesson || lesson.sourceType !== "pdf") {
      res.status(404).json({ error: "LESSON_PDF_IMPORT_NOT_FOUND" });
      return;
    }
    const artifact = await findPdfImportArtifactForLesson(lesson, req.parentSession.householdId);
    if (!artifact) {
      res.status(404).json({ error: "LESSON_PDF_IMPORT_NOT_FOUND" });
      return;
    }
    res.json(serializePdfImportPreview(artifact));
  } catch (error) {
    next(error);
  }
});

app.post("/api/platform-admin/courses", requireLocalCourseStudio, async (req, res, next) => {
  try {
    const importId = String(req.body.importId || "").trim();
    const uploadedChapters = Array.isArray(req.body.chapters) ? req.body.chapters : [];
    let lesson;
    let quality;
    let finalQuality;

    if (importId || uploadedChapters.length > 0) {
      if (!importId || uploadedChapters.length === 0) {
        res.status(400).json({ error: "PDF_IMPORT_PREVIEW_REQUIRED" });
        return;
      }
      const artifact = await readPdfImportArtifact(importId, req.parentSession.householdId);
      if (!artifact) {
        res.status(404).json({ error: "PDF_IMPORT_PREVIEW_NOT_FOUND" });
        return;
      }
      const sourceLessonId = `official-upload-${importId}`;
      const uploadedTitle = String(req.body.title || artifact.result?.title || "PDF 导入课程").trim().slice(0, 100);
      const normalized = buildLessonChapters({
        lessonId: sourceLessonId,
        title: uploadedTitle,
        text: "",
        chapters: uploadedChapters,
        minScore: 75
      });
      if (normalized.totalSentences === 0 || normalized.totalSentences > maxPdfImportSentences) {
        res.status(422).json({ error: normalized.totalSentences === 0 ? "PDF_IMPORT_EMPTY" : "PDF_IMPORT_TOO_LARGE" });
        return;
      }
      finalQuality = assessPdfImportQuality(normalized.chapters, {
        layout: artifact.layout,
        structure: artifact.result?.structure || null,
        ocr: artifact.result?.quality?.ocr || null
      });
      quality = finalQuality;
      lesson = {
        id: sourceLessonId,
        title: uploadedTitle,
        sourceType: "pdf",
        tags: Array.isArray(req.body.tags) ? req.body.tags : ["PDF导入"],
        importQuality: quality,
        status: "published",
        chapters: normalized.chapters,
        sentences: normalized.chapters.flatMap((chapter) => chapter.sentences || [])
      };
    } else {
      const lessonId = String(req.body.lessonId || "").trim();
      lesson = listLessons({ includeArchived: false, householdId: req.parentSession.householdId }).find(
        (item) => item.id === lessonId
      );
      if (!lesson) {
        res.status(404).json({ error: "SOURCE_LESSON_NOT_FOUND" });
        return;
      }
      finalQuality = assessPdfImportQuality(lesson.chapters || []);
      quality = lesson.importQuality?.status ? lesson.importQuality : finalQuality;
    }
    const publicationBlockers = getPdfPublicationBlockers(finalQuality);
    if (publicationBlockers.length > 0) {
      res.status(422).json({ error: "SOURCE_LESSON_QUALITY_BLOCKED", blockers: publicationBlockers, quality, finalQuality });
      return;
    }
    const title = String(req.body.title || lesson.title || "").trim().slice(0, 100);
    const description = String(req.body.description || "").trim().slice(0, 500);
    const sourceLabel = String(req.body.sourceLabel || "").trim().slice(0, 100);
    if (!title || !description || !sourceLabel) {
      res.status(400).json({ error: "OFFICIAL_COURSE_METADATA_REQUIRED" });
      return;
    }
    const existingId = String(req.body.resourceId || "").trim();
    const resourceId = existingId || `official-course-${nanoid(10)}`;
    const requestedSlug = String(req.body.slug || title)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    const resource = publishOfficialCourseResource({
      id: resourceId,
      slug: requestedSlug || resourceId,
      title,
      description,
      level: String(req.body.level || "入门").trim().slice(0, 30),
      language: String(req.body.language || "英语").trim().slice(0, 30),
      tags: Array.isArray(req.body.tags) ? req.body.tags : [],
      sourceLabel,
      sourceHouseholdId: req.parentSession.householdId,
      sourceLessonId: lesson.id,
      content: lesson,
      quality,
      createdByUserId: requireParentAccessSession(req).id
    });
    if (importId) await updatePdfImportFinalArtifact(importId, req.parentSession.householdId, lesson.chapters || []);
    res.status(existingId ? 200 : 201).json({ ...resource, content: undefined });
  } catch (error: unknown) {
    if (String(error instanceof Error ? error.message : error || "").includes("UNIQUE constraint failed: official_course_resources.slug")) {
      res.status(409).json({ error: "OFFICIAL_COURSE_SLUG_TAKEN" });
      return;
    }
    next(error);
  }
});

app.patch("/api/platform-admin/courses/:resourceId/status", (req, res) => {
  const status = req.body.status === "published" ? "published" : "unpublished";
  const resource = setOfficialCourseResourceStatus(req.params.resourceId, status);
  if (!resource) {
    res.status(404).json({ error: "OFFICIAL_COURSE_NOT_FOUND" });
    return;
  }
  const { content, ...summary } = resource;
  res.json(summary);
});

app.post("/api/admin/lessons", async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    const text = String(req.body.text || "").trim();
    const chapters = Array.isArray(req.body.chapters) ? req.body.chapters : [];
    const minScore = Number(req.body.minScore || 75);
    const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    const sourceType = normalizeLessonSourceType(req.body.sourceType);
    const requestedImportId = String(req.body.importId || "").trim();
    const importArtifact = requestedImportId
      ? await readPdfImportArtifact(requestedImportId, req.parentSession.householdId)
      : null;

    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const lessonId = `lesson-${nanoid(10)}`;
    const lessonChapters = buildLessonChapters({ lessonId, title, text, chapters, minScore });
    if (lessonChapters.totalSentences === 0) {
      res.status(400).json({ error: "No readable sentences found" });
      return;
    }

    createLesson({
      id: lessonId,
      title,
      sourceType,
      tags,
      body: lessonChapters.body,
      chapters: lessonChapters.chapters,
      importQuality: req.body.importQuality || null,
      importId: importArtifact ? requestedImportId : null,
      householdId: req.parentSession.householdId
    });

    const lesson = listLessons({ includeArchived: true, householdId: req.parentSession.householdId }).find((item) => item.id === lessonId);
    if (importArtifact) {
      await updatePdfImportFinalArtifact(requestedImportId, req.parentSession.householdId, lessonChapters.chapters);
    }
    res.status(201).json(lesson);
  } catch (error) {
    next(error);
  }
});

app.post(["/api/import/pdf/preview", "/api/admin/import/pdf/preview"], pdfUpload.single("pdf"), async (req, res, next) => {
  let pdfAudit = null;
  if (isPlatformAdminSession(req.parentSession)) {
    const fileName = path.basename(String(req.file?.originalname || "未选择文件")).slice(0, 180);
    pdfAudit = beginPlatformAdminAudit(req, res, {
      action: "pdf.import",
      summary: `解析 PDF《${fileName}》`,
      metadata: {
        fileName,
        fileBytes: Number(req.file?.size || req.file?.buffer?.length || 0),
        rule: String(req.body?.rule || "default").slice(0, 40)
      }
    });
  }
  try {
    if (!req.file) {
      res.status(400).json({ error: "pdf file is required" });
      return;
    }

    if (req.file.mimetype && req.file.mimetype !== "application/pdf" && !req.file.originalname.toLowerCase().endsWith(".pdf")) {
      res.status(400).json({ error: "Only PDF files are supported" });
      return;
    }

    const title = sanitizeImportTitle(req.file.originalname);
    const importRule = normalizePdfImportRule(req.body?.rule);
    const { text, pages, pageTexts } = await extractPdfText(req.file.buffer);
    let layout = null;
    let layoutError = "";
    try {
      layout = await extractPdfLayout(req.file.buffer);
    } catch (error) {
      layoutError = error instanceof Error ? error.message : String(error || "");
    }
    const lines = normalizePdfLines(text);
    const warnings: string[] = [];
    const layoutLineCount = layout?.stats?.lines || 0;

    const textStructure = buildPdfStructure({ title, pages: pageTexts });
    const layoutStructure = layout ? buildPdfStructureFromLayout({ title, layout, rule: importRule }) : null;
    let missingPepLayoutUnits: typeof textStructure.toc = [];
    if (importRule === "pep-textbook" && layoutStructure && layoutStructure.toc.length > 0) {
      missingPepLayoutUnits = layoutStructure.toc.filter((entry) => {
        const unit = layoutStructure.units.find((candidate) => candidate.toc?.unitNumber === entry.unitNumber);
        return !unit || !unit.sections.some((section) => section.blocks.some((block) => block.candidate));
      });
    }
    const shouldUseLayoutStructure = Boolean(
      layoutStructure && Number(layoutStructure.stats.targetSentences || 0) > 0 && missingPepLayoutUnits.length === 0
    );
    if (layoutStructure && Number(layoutStructure.stats.targetSentences || 0) > 0 && missingPepLayoutUnits.length > 0) {
      warnings.push(`PDF 坐标布局未完整识别 Unit ${missingPepLayoutUnits.map((entry) => entry.unitNumber).join("、")}，已停止使用不完整布局结果。`);
    }
    const structure = shouldUseLayoutStructure && layoutStructure ? layoutStructure : textStructure;
    const structureImportResult = buildPdfImportChaptersFromStructure({
      structure,
      sourceMode: shouldUseLayoutStructure ? "layout-structure" : "structure"
    });
    const fallbackImportResult = buildPdfImportChapters({ title, lines });
    const shouldUseStructureImport = structureImportResult.chapters.length > 0 || structure.stats.candidateSentences > 0;
    const importResult = shouldUseStructureImport ? structureImportResult : fallbackImportResult;
    const sentenceCount = importResult.chapters.reduce((sum, chapter) => sum + chapter.sentences.length, 0);
    const ocr = await verifyPdfImport(req.file.buffer, { layout, totalPages: pages });
    const quality = assessPdfImportQuality(importResult.chapters, { layout, structure, ocr });
    if (layoutError) {
      warnings.push(`PDF 布局提取失败，已使用纯文本规则兜底：${layoutError}`);
    }
    if (ocr.status === "unavailable") {
      warnings.push(`独立 OCR 校验未完成：${ocr.message}`);
    } else {
      warnings.push(`已使用离线 OCR 独立复核 ${ocr.pagesProcessed}/${ocr.totalPages} 页，文字层与页面图像词元一致率 ${ocr.tokenAgreement}%。`);
      if (ocr.reviewPages.length > 0) warnings.push(`OCR 建议重点检查第 ${ocr.reviewPages.slice(0, 20).join("、")} 页${ocr.reviewPages.length > 20 ? "等" : ""}。`);
    }
    for (const provider of ocr.providers || []) {
      if (provider.engine === "tesseract.js-eng") continue;
      if (provider.status === "unavailable") {
        warnings.push(`${provider.engine} 未完成：${provider.message || "服务不可用"}${provider.detail ? ` 技术详情：${provider.detail}` : ""}`);
      } else {
        warnings.push(`${provider.engine} 已复核 ${provider.pagesProcessed}/${provider.totalPages} 页，词元一致率 ${provider.tokenAgreement}%。`);
      }
    }
    const visualReview = ocr.visualReview;
    if (visualReview?.status === "unavailable") {
      warnings.push(`日日新视觉复核未完成：${visualReview.message || "服务不可用"}${visualReview.detail ? ` 技术详情：${visualReview.detail}` : ""}`);
    } else if (Number(visualReview?.pagesProcessed || 0) > 0) {
      warnings.push(`日日新已复核 ${visualReview?.pagesProcessed || 0} 个冲突页面，结论仅用于辅助确认，不会自行改写教材。`);
    }

    if (sentenceCount === 0) {
      const artifact = await savePdfImportArtifacts({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        title,
        rule: importRule,
        text,
        lines,
        layout,
        structure,
        importResult,
        warnings,
        householdId: req.parentSession.householdId,
        totalPages: pages,
        pdfImportsDir
      });
      pdfAudit?.addMetadata({ importId: artifact.importId, pages, sentences: 0 });
      res.status(422).json({
        error: "No readable English sentences found in this PDF.",
        provider: "local-pdf",
        importId: artifact.importId
      });
      return;
    }

    if (!importResult.foundHeading) {
      warnings.push("未识别到明显章节标题，已按默认章节导入。");
    }
    if (structure.stats.tocEntries > 0) {
      warnings.push(`已根据目录识别 ${structure.stats.tocEntries} 个章节，并过滤重复章节名。`);
    }
    if (importResult.sourceMode === "layout-structure") {
      warnings.push(`已按${pdfImportRuleLabels[importRule]}规则和 PDF 坐标布局识别目标栏目、文本行和对话气泡。`);
    } else if (importResult.sourceMode === "structure") {
      warnings.push(`已按${pdfImportRuleLabels[importRule]}规则和 PDF 结构预览中的候选跟读生成课程内容。`);
    }
    warnings.push("已自动过滤页码、目录、教材指令和填空片段，请保存前抽查。");
    if (importResult.wasLimited) {
      warnings.push(`本次预览最多导入 ${maxPdfImportSentences} 个句子，后续可增加按页导入。`);
    }
    const artifact = await savePdfImportArtifacts({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      title,
      rule: importRule,
      text,
      lines,
      layout,
      structure,
      importResult,
      quality,
      warnings,
      householdId: req.parentSession.householdId,
      totalPages: pages,
      pdfImportsDir
    });
    pdfAudit?.addMetadata({ importId: artifact.importId, pages, chapters: importResult.chapters.length, sentences: sentenceCount });
    warnings.push(`导入诊断编号：${artifact.importId}。`);

    res.json({
      provider: "local-pdf",
      importId: artifact.importId,
      rule: importRule,
      sourceType: "pdf",
      title,
      tags: ["PDF导入"],
      warnings,
      quality,
      structure,
      importSnapshot: artifact.snapshot,
      stats: {
        pages,
        characters: text.length,
        lines: lines.length,
        layoutLines: layout?.stats?.lines || 0,
        layoutItems: layout?.stats?.items || 0,
        chapters: importResult.chapters.length,
        sentences: sentenceCount,
        detectedSentences: importResult.totalDetectedSentences
      },
      chapters: importResult.chapters
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password/i.test(message)) {
      res.status(422).json({ error: "Unable to extract encrypted PDF. Remove password protection and try again." });
      return;
    }
    next(error);
  }
});

app.put("/api/admin/lessons/:lessonId", async (req, res, next) => {
  try {
    const lessonId = req.params.lessonId;
    const existingLesson = listLessons({
      includeArchived: true,
      householdId: req.parentSession.householdId
    }).find((item) => item.id === lessonId);
    if (!existingLesson) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }
    if (existingLesson.sourceType?.startsWith("library:")) {
      res.status(403).json({ error: "COURSE_LIBRARY_LESSON_READ_ONLY" });
      return;
    }
    const title = String(req.body.title || "").trim();
    const text = String(req.body.text || "").trim();
    const chapters = Array.isArray(req.body.chapters) ? req.body.chapters : [];
    const minScore = Number(req.body.minScore || 75);
    const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    const requestedImportId = String(req.body.importId || "").trim();
    const importArtifact = requestedImportId
      ? await readPdfImportArtifact(requestedImportId, req.parentSession.householdId)
      : null;

    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const lessonChapters = buildLessonChapters({ lessonId, title, text, chapters, minScore });
    if (lessonChapters.totalSentences === 0) {
      res.status(400).json({ error: "No readable sentences found" });
      return;
    }

    updateLesson({
      id: lessonId,
      title,
      tags,
      body: lessonChapters.body,
      chapters: lessonChapters.chapters,
      importQuality: req.body.importQuality,
      importId: importArtifact ? requestedImportId : undefined,
      householdId: req.parentSession.householdId
    });

    const lesson = listLessons({ includeArchived: true, householdId: req.parentSession.householdId }).find((item) => item.id === lessonId);
    if (importArtifact) {
      await updatePdfImportFinalArtifact(requestedImportId, req.parentSession.householdId, lessonChapters.chapters);
    }
    res.json(lesson);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/lessons/:lessonId/status", (req, res, next) => {
  try {
    const lessonId = req.params.lessonId;
    const status = String(req.body.status || "").trim();
    if (status !== "published" && status !== "archived") {
      res.status(400).json({ error: "status must be published or archived" });
      return;
    }

    setLessonArchived({ id: lessonId, archived: status === "archived", householdId: req.parentSession.householdId });
    const lesson = listLessons({ includeArchived: true, householdId: req.parentSession.householdId }).find((item) => item.id === lessonId);
    res.json(lesson);
  } catch (error) {
    next(error);
  }
});

app.get("/api/tts/sentences/:sentenceId", async (req, res, next) => {
  try {
    const sentence = await findSentence(req.params.sentenceId, req.parentSession.householdId);
    if (!sentence) {
      res.status(404).json({ error: "Sentence not found" });
      return;
    }

    const voice = findTtsVoice(String(req.query.voice || ""));
    if (!voice) {
      res.status(400).json({ error: "Unsupported TTS voice" });
      return;
    }

    const { audioPath, format } = await ensureTtsCache({ sentence, voice });
    console.info(`[tts] route=audio provider=${ttsProvider} voice=${voice.id} sentence=${sentence.id} contentType=${format.contentType}`);

    res.type(format.contentType);
    res.sendFile(audioPath);
  } catch (error) {
    next(error);
  }
});

app.get("/api/tts/storybook", async (req, res, next) => {
  try {
    const text = String(req.query.text || "").trim();
    if (!text || text.length > 500) {
      res.status(400).json({ error: "Storybook text must contain 1 to 500 characters" });
      return;
    }

    const voice = findTtsVoice(String(req.query.voice || ""));
    if (!voice) {
      res.status(400).json({ error: "Unsupported TTS voice" });
      return;
    }

    const textHash = createHash("sha256").update(text).digest("hex").slice(0, 24);
    const sentence = { id: `storybook-${textHash}`, text };
    const { audioPath, format } = await ensureTtsCache({ sentence, voice });
    res.type(format.contentType);
    res.sendFile(audioPath);
  } catch (error) {
    next(error);
  }
});

app.get("/api/tts/sentences/:sentenceId/subtitles", async (req, res, next) => {
  try {
    const sentence = await findSentence(req.params.sentenceId, req.parentSession.householdId);
    if (!sentence) {
      res.status(404).json({ error: "Sentence not found" });
      return;
    }

    const voice = findTtsVoice(String(req.query.voice || ""));
    if (!voice) {
      res.status(400).json({ error: "Unsupported TTS voice" });
      return;
    }

    const { subtitlesPath } = await ensureTtsCache({ sentence, voice });
    const subtitles = JSON.parse(await fs.readFile(subtitlesPath, "utf8"));
    console.info(
      `[tts-subtitles] route=subtitles provider=${ttsProvider} voice=${voice.id} sentence=${sentence.id} subtitles=${subtitles.subtitles?.length || 0}`
    );
    res.json(subtitles);
  } catch (error) {
    next(error);
  }
});

function enqueueSpeechProviderComparison({
  attempt,
  primaryProvider,
  primaryDurationMs,
  referenceText,
  itemType,
  durationMs,
  audio,
  minScore,
  onComplete
}: {
  attempt: AttemptRecord;
  primaryProvider: string;
  primaryDurationMs: number;
  referenceText: string;
  itemType: SpeechAssessmentItemType;
  durationMs: number;
  audio: Buffer;
  minScore: number;
  onComplete: () => Promise<void>;
}) {
  if (attempt.processingTimings?.shadowState !== "queued") return true;
  const queued = speechShadowQueue.enqueue(async () => {
    const startedAt = performance.now();
    const comparison = await assessSpeechProviderComparison({
      primaryProvider,
      primaryResult: attempt.result as ProviderAssessmentResult,
      primaryGate: attempt as unknown as PassGateResult,
      primaryDurationMs,
      referenceText,
      itemType,
      durationMs,
      audio,
      minScore,
      assess: assessReading
    });
    if (!comparison || !attempt.processingTimings) return;
    attempt.speechProviderComparison = comparison;
    attempt.processingTimings.shadowState = "completed";
    attempt.processingTimings.shadowAssessmentMs = Math.round(performance.now() - startedAt);
    attempt.processingTimings.shadowCompletedAt = new Date().toISOString();
    await onComplete();
    console.info(
      `[speech-shadow] attempt=${attempt.id} provider=${comparison.shadow.provider || "unknown"} status=${comparison.shadow.status} durationMs=${attempt.processingTimings.shadowAssessmentMs}`
    );
  });
  if (!queued && attempt.processingTimings) {
    attempt.processingTimings.shadowState = "dropped";
    console.warn(`[speech-shadow] attempt=${attempt.id} status=dropped reason=queue-full`);
  }
  return queued;
}

async function handleAttempt(
  req: Request,
  res: Response,
  next: NextFunction,
  provider = speechProvider,
  options: { liveOnly?: boolean } = {}
) {
  const requestStartedAt = performance.now();
  try {
    const { childId, sentenceId, referenceText, durationMs, minScore, storybookId, storybookPageId } = req.body;
    if (!childId || !sentenceId || !referenceText) {
      res.status(400).json({ error: "childId, sentenceId and referenceText are required" });
      return;
    }
    const session = req.parentSession;
    const isFilingReviewAttempt = session.kind === "review";
    if (!hasChildAccess(req, String(childId)) || (session.kind === "review" && String(childId) !== session.childId)) {
      res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
      return;
    }
    const householdId = req.parentSession.householdId;
    const isStorybookAttempt = Boolean(storybookId || storybookPageId);
    let sentence: CachedSentence & { minScore?: number };
    if (isFilingReviewAttempt) {
      const reviewSentence = findFilingReviewSentence(sentenceId);
      if (!reviewSentence || reviewSentence.text.trim() !== String(referenceText).trim()) {
        res.status(400).json({ error: "REVIEW_CONTENT_RESTRICTED" });
        return;
      }
      sentence = { ...reviewSentence, itemType: "sentence" };
    } else if (isStorybookAttempt) {
      const safeIdPattern = /^[a-z0-9][a-z0-9-]{0,119}$/i;
      if (!safeIdPattern.test(String(storybookId || "")) || !safeIdPattern.test(String(storybookPageId || "")) || !safeIdPattern.test(String(sentenceId))) {
        res.status(400).json({ error: "Invalid storybook item" });
        return;
      }
      if (String(referenceText).trim().length > 500) {
        res.status(400).json({ error: "Storybook sentence is too long" });
        return;
      }
      sentence = { id: String(sentenceId), text: String(referenceText), minScore: Number(minScore || 75), itemType: "sentence" };
    } else {
      const storedSentence = await findSentence(sentenceId, householdId);
      if (!storedSentence) {
        res.status(404).json({ error: "Sentence not found" });
        return;
      }
      if (storedSentence.text.trim() !== String(referenceText).trim()) {
        res.status(400).json({ error: "Reference text does not match the selected sentence" });
        return;
      }
      sentence = storedSentence;
    }
    const assessmentMinScore = Number(sentence.minScore || minScore || 75);
    const assessmentItemType: SpeechAssessmentItemType = sentence.itemType === "word"
      ? "word"
      : sentence.itemType === "reading"
        ? "paragraph"
        : "sentence";

    const candidateInputs = buildAttemptCandidateInputs(req, durationMs, referenceText);
    const attemptId = nanoid();
    const liveSpeechTestRunId = String(req.body.liveSpeechTestRunId || "");
    const isLessonAttempt = !isFilingReviewAttempt && !isStorybookAttempt;
    const livePrimary = isLessonAttempt && liveSpeechTestRunId
      ? await waitForLiveSpeechResult({
          runId: liveSpeechTestRunId,
          householdId,
          childId: String(childId),
          sentenceId: String(sentenceId),
          attemptId
        })
      : null;
    const streamedFallbackAudio = isLessonAttempt && liveSpeechTestRunId && !livePrimary
      ? claimLiveSpeechFallbackAudio({
          runId: liveSpeechTestRunId,
          householdId,
          childId: String(childId),
          sentenceId: String(sentenceId)
        })
      : null;
    if (options.liveOnly && !livePrimary && !streamedFallbackAudio?.length) {
      res.status(409).json({ code: "LIVE_SPEECH_FALLBACK_REQUIRED" });
      return;
    }
    const evaluatedCandidates: EvaluatedAttemptCandidate[] = [];
    let lastAssessmentError: unknown = null;

    if (isLessonAttempt) {
      const baseCandidate = candidateInputs.find((input) => input.kind === "full-session")
        || candidateInputs[0]
        || { id: "full-session", kind: "full-session" as const, durationMs: Number(durationMs || 0) };
      const streamedAudio = livePrimary?.audio?.length ? livePrimary.audio : streamedFallbackAudio;
      const candidate = streamedAudio?.length
        ? { ...baseCandidate, audio: streamedAudio }
        : candidateInputs.find((input) => input.kind === "full-session" && input.audio?.length)
          || candidateInputs.find((input) => input.audio?.length)
          || (livePrimary ? { ...baseCandidate, audio: Buffer.alloc(0) } : null);
      if (!candidate) throw new Error("Recording audio is required");
      const assessmentStartedAt = performance.now();
      const providerResult = livePrimary?.result || await assessReading({
        provider,
        referenceText,
        itemType: assessmentItemType,
        durationMs: candidate.durationMs,
        audio: candidate.audio!
      });
      const result = applyScorePolicy(providerResult);
      const gate = evaluatePass(result, assessmentMinScore);
      evaluatedCandidates.push({
        ...candidate,
        rawAudio: candidate.audio!,
        audio: candidate.audio!,
        speechEnhancement: { provider: "not-used", applied: false, processingMs: 0 },
        assessmentDurationMs: livePrimary?.comparison.finalLatencyMs
          ?? Math.round(performance.now() - assessmentStartedAt),
        result,
        gate
      });
      console.info(
        `[speech-primary] attempt=${attemptId} source=${livePrimary ? "live-stream" : "raw-wav-fallback"} itemType=${assessmentItemType} providerCalls=${livePrimary ? 1 : "1-fallback"}`
      );
    } else for (const candidate of candidateInputs) {
      try {
        const enhancement = await enhanceCandidateAudio(candidate);
        const assessmentStartedAt = performance.now();
        const providerResult = await assessReading({
          provider,
          referenceText,
          itemType: assessmentItemType,
          durationMs: candidate.durationMs,
          audio: enhancement.audio
        });
        const result = applyScorePolicy(providerResult);
        const gate = evaluatePass(result, assessmentMinScore);
        evaluatedCandidates.push({
          ...candidate,
          rawAudio: candidate.audio!,
          audio: enhancement.audio,
          speechEnhancement: enhancement.metadata,
          assessmentDurationMs: Math.round(performance.now() - assessmentStartedAt),
          result,
          gate
        });
        if (gate.passed) break;
      } catch (error: unknown) {
        lastAssessmentError = error;
        console.warn(`[speech] candidate=${candidate.id} status=failed message="${error instanceof Error ? error.message : String(error)}"`);
      }
    }

    if (evaluatedCandidates.length === 0) {
      throw lastAssessmentError || new Error("No recording candidate could be assessed");
    }

    const selectedCandidate = selectAttemptCandidate(evaluatedCandidates);
    if (!selectedCandidate) throw new Error("No recording candidate could be selected");
    const result = selectedCandidate.result;
    const gate = selectedCandidate.gate;
    const recordingQuality = selectedCandidate.quality || parseRecordingQuality(req.body.recordingQuality);
    const rawComparisonStartedAt = performance.now();
    const rawComparison = isLessonAttempt || isFilingReviewAttempt ? undefined : await assessRawComparison({
      provider,
      referenceText,
      itemType: assessmentItemType,
      minScore: assessmentMinScore,
      candidate: selectedCandidate
    });
    const rawComparisonMs = Math.round(performance.now() - rawComparisonStartedAt);
    const noiseGate = evaluateNoiseGate({
      enhancement: selectedCandidate.speechEnhancement,
      enhancedResult: result,
      rawResult: rawComparison?.result
    });
    const speechProviderComparisonStatus = getSpeechProviderComparisonStatus(provider);
    const liveSpeechComparison = livePrimary?.comparison;
    const attempt: AttemptRecord = {
      id: attemptId,
      sentenceId,
      childId: String(childId),
      householdId,
      referenceText,
      createdAt: new Date().toISOString(),
      speechProvider: livePrimary ? "tencent" : provider,
      assessmentItemType,
      assessmentSource: livePrimary ? "live-stream" : isLessonAttempt ? "raw-wav-fallback" : "batch",
      audioBytes: selectedCandidate.audio.length,
      recordingQuality,
      clientDevice: parseClientDevice(req.body.clientDevice),
      candidateSelection: {
        strategy: isLessonAttempt
          ? livePrimary ? "stream-primary-full-session" : "single-raw-fallback"
          : candidateInputs.length > 1 ? "latest-complete-contiguous" : "full-session",
        selectedId: selectedCandidate.id,
        selectedKind: selectedCandidate.kind,
        candidateCount: candidateInputs.length,
        evaluated: evaluatedCandidates.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          durationMs: candidate.durationMs,
          passed: candidate.gate.passed,
          suggestedScore: candidate.result.SuggestedScore,
          pronAccuracy: candidate.result.PronAccuracy,
          pronCompletion: candidate.result.PronCompletion,
          severeIssues: candidate.gate.severeIssues,
          lowAccuracyIssues: candidate.gate.lowAccuracyIssues,
          enhancementApplied: Boolean(candidate.speechEnhancement?.applied),
          assessmentDurationMs: candidate.assessmentDurationMs
        }))
      },
      speechEnhancement: {
        ...selectedCandidate.speechEnhancement,
        rawAudioBytes: selectedCandidate.rawAudio?.length || 0,
        rawComparison,
        noiseGate
      },
      liveSpeechComparison,
      processingTimings: {
        enhancementMs: selectedCandidate.speechEnhancement.processingMs,
        primaryAssessmentMs: selectedCandidate.assessmentDurationMs,
        rawComparisonMs,
        decisionReadyMs: Math.round(performance.now() - requestStartedAt),
        shadowState:
          !isFilingReviewAttempt && !isLessonAttempt && speechProviderComparisonStatus.enabled
            ? "queued"
            : "disabled",
        shadowProvider: speechProviderComparisonStatus.shadowProvider
      },
      result,
      diagnosticStatus: "scored",
      ...(isStorybookAttempt ? { storybookId: String(storybookId), storybookPageId: String(storybookPageId) } : {}),
      ...gate
    };

    const rejectedReason = getAssessmentRejection({ referenceText, result, gate, recordingQuality });
    const responseCode = rejectedReason ? "NO_SPEECH_DETECTED" : noiseGate.rejected ? "RECORDING_TOO_NOISY" : null;
    const fullSessionAudio = candidateInputs.find((candidate) => candidate.kind === "full-session")?.audio;
    if (responseCode) {
      attempt.diagnosticStatus = "rejected";
      attempt.rejectionStage = "server";
      attempt.rejectionCode = responseCode;
      attempt.rejectedReason = rejectedReason || noiseGate.reason || undefined;
      if (!isFilingReviewAttempt) {
        const lesson = isStorybookAttempt
          ? null
          : listLessons({ includeArchived: true, householdId })
              .find((item) => item.sentences.some((itemSentence) => itemSentence.id === String(sentenceId)));
        const persistRejectedAttempt = async () => {
          await upsertRejectedCalibrationSample({
            rootDir: attemptCalibrationDir,
            householdId,
            sample: {
              ...attempt,
              householdId: undefined,
              sourceType: isStorybookAttempt ? "storybook" : "lesson",
              contentId: isStorybookAttempt ? String(storybookId) : lesson?.id || "",
              contentTitle: isStorybookAttempt ? String(storybookId) : lesson?.title || ""
            }
          });
          await saveAttemptDiagnostics(attempt, selectedCandidate.audio, fullSessionAudio, selectedCandidate.rawAudio);
        };
        await persistRejectedAttempt();
        const queued = enqueueSpeechProviderComparison({
          attempt,
          primaryProvider: provider,
          primaryDurationMs: selectedCandidate.assessmentDurationMs,
          referenceText,
          itemType: assessmentItemType,
          durationMs: selectedCandidate.durationMs,
          audio: selectedCandidate.audio,
          minScore: assessmentMinScore,
          onComplete: persistRejectedAttempt
        });
        if (!queued) await persistRejectedAttempt();
      }
      res.status(422).json({
        code: responseCode,
        error: responseCode === "RECORDING_TOO_NOISY" ? "The recording is too noisy to score reliably" : "No valid reading was detected",
        attemptId: attempt.id
      });
      return;
    }

    if (isFilingReviewAttempt) {
      attempt.reviewOnly = true;
      attempt.audioAvailable = false;
      attempt.rawAudioAvailable = false;
    } else {
      Object.assign(attempt, await saveAttemptRecording(attempt, selectedCandidate.audio, selectedCandidate.rawAudio));
      if (isStorybookAttempt) insertStorybookAttempt({
        ...attempt,
        storybookId: String(storybookId),
        storybookPageId: String(storybookPageId)
      });
      else insertAttempt(attempt);
      await saveAttemptDiagnostics(attempt, selectedCandidate.audio, fullSessionAudio, selectedCandidate.rawAudio);
      if (attempt.liveSpeechComparison) logLiveSpeechComparison(attempt, attempt.liveSpeechComparison);
      const persistBackgroundMetadata = async () => {
        const updates = {
          speechProviderComparison: attempt.speechProviderComparison,
          processingTimings: attempt.processingTimings
        };
        if (isStorybookAttempt) updateStorybookAttemptMetadata(attempt.id, householdId, updates);
        else updateAttemptMetadata(attempt.id, householdId, updates);
        await saveAttemptDiagnostics(attempt, selectedCandidate.audio, fullSessionAudio, selectedCandidate.rawAudio);
      };
      const queued = enqueueSpeechProviderComparison({
        attempt,
        primaryProvider: provider,
        primaryDurationMs: selectedCandidate.assessmentDurationMs,
        referenceText,
        itemType: assessmentItemType,
        durationMs: selectedCandidate.durationMs,
        audio: selectedCandidate.audio,
        minScore: assessmentMinScore,
        onComplete: persistBackgroundMetadata
      });
      if (!queued) await persistBackgroundMetadata();
    }
    res.json(attempt);
  } catch (error) {
    next(error);
  }
}

async function enhanceCandidateAudio(candidate: AttemptCandidateInput): Promise<SpeechEnhancementResult> {
  if (!candidate.audio?.length) throw new Error("Recording audio is required");
  try {
    return await enhanceSpeech(candidate.audio);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[speech-enhancement] candidate=${candidate.id} status=fallback message="${message}"`);
    return {
      audio: candidate.audio,
      metadata: { provider: getSpeechEnhancementStatus().provider, applied: false, error: message }
    };
  }
}

async function assessRawComparison({
  provider,
  referenceText,
  itemType,
  minScore,
  candidate
}: {
  provider: string;
  referenceText: string;
  itemType: SpeechAssessmentItemType;
  minScore: number;
  candidate: EvaluatedAttemptCandidate;
}): Promise<RawAssessmentComparison | undefined> {
  if (!getSpeechEnhancementStatus().abComparison || !candidate.speechEnhancement?.applied || !candidate.rawAudio?.length) {
    return undefined;
  }
  try {
    const providerResult = await assessReading({
      provider,
      referenceText,
      itemType,
      durationMs: candidate.durationMs,
      audio: candidate.rawAudio
    });
    const result = applyScorePolicy(providerResult);
    const gate = evaluatePass(result, Number(minScore || 75));
    return {
      ...summarizeAssessment(result, gate),
      result
    };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function summarizeAssessment(result: AssessmentResultLike, gate: PassGateResult) {
  return {
    passed: gate.passed,
    suggestedScore: Number(result.SuggestedScore || 0),
    pronAccuracy: Number(result.PronAccuracy || 0),
    pronFluency: Number(result.PronFluency || 0),
    pronCompletion: Number(result.PronCompletion || 0),
    severeIssues: gate.severeIssues,
    lowAccuracyIssues: gate.lowAccuracyIssues
  };
}

function getComparisonProviderScore(result: unknown): number | undefined {
  if (!isRecord(result)) return undefined;
  const score = Number(result.ProviderSuggestedScore ?? result.SuggestedScore);
  return Number.isFinite(score) ? score : undefined;
}

function logLiveSpeechComparison(attempt: UnknownRecord, comparison: LiveSpeechTestComparison) {
  const result = isRecord(attempt.result) ? attempt.result : undefined;
  const enhancement = isRecord(attempt.speechEnhancement) ? attempt.speechEnhancement : undefined;
  const rawComparison = isRecord(enhancement?.rawComparison) ? enhancement.rawComparison : undefined;
  const rawResult = isRecord(rawComparison?.result) ? rawComparison.result : undefined;
  const enhancedScore = getComparisonProviderScore(result);
  const rawScore = getComparisonProviderScore(rawResult);
  console.info(
    `[speech-live-primary] run=${comparison.runId} attempt=${String(attempt.id || "unknown")} itemType=${comparison.itemType} evalMode=${comparison.evalMode} score=${comparison.suggestedScore.toFixed(2)} source=${String(attempt.assessmentSource || "live-stream")}`
  );
}

function buildAttemptCandidateInputs(req: Request, fallbackDurationMs: unknown, referenceText: string): AttemptCandidateInput[] {
  const files: Record<string, Express.Multer.File[]> = req.files && !Array.isArray(req.files) ? req.files : {};
  const fullFile = files.audio?.[0] || req.file;
  if (!fullFile?.buffer?.length) {
    return [
      {
        id: "full-session",
        kind: "full-session",
        durationMs: Number(fallbackDurationMs || countWords(referenceText) * 650),
        quality: parseRecordingQuality(req.body.recordingQuality),
        audio: undefined
      }
    ];
  }

  const metadata = parseCandidateMetadata(req.body.candidateMetadata);
  const segmentMetadata = metadata.filter((candidate) => candidate.kind === "speech-segment");
  const fullMetadata = metadata.find((candidate) => candidate.kind === "full-session");
  const segmentFiles = Array.isArray(files.candidateAudio) ? files.candidateAudio.slice(0, 2) : [];
  const candidates: AttemptCandidateInput[] = segmentFiles.map((file, index) => ({
    id: String(segmentMetadata[index]?.id || `segment-${index + 1}`),
    kind: "speech-segment" as const,
    durationMs: Number(segmentMetadata[index]?.durationMs || fallbackDurationMs || countWords(referenceText) * 650),
    quality: segmentMetadata[index]?.quality,
    audio: file.buffer
  }));

  candidates.push({
    id: String(fullMetadata?.id || "full-session"),
    kind: "full-session",
    durationMs: Number(fullMetadata?.durationMs || fallbackDurationMs || countWords(referenceText) * 650),
    quality: fullMetadata?.quality || parseRecordingQuality(req.body.recordingQuality),
    audio: fullFile.buffer
  });
  return candidates;
}

function parseRecordingQuality(value: unknown): UnknownRecord | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseClientDevice(value: unknown): UnknownRecord | undefined {
  const parsed = parseRecordingQuality(value);
  if (!parsed) return undefined;
  const text = (candidate: unknown, maxLength = 320) =>
    typeof candidate === "string" ? candidate.trim().slice(0, maxLength) : undefined;
  const finiteNumber = (candidate: unknown, minimum: number, maximum: number) => {
    const number = Number(candidate);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : undefined;
  };
  const size = (candidate: unknown) => isRecord(candidate)
    ? {
        width: finiteNumber(candidate.width, 0, 20_000),
        height: finiteNumber(candidate.height, 0, 20_000)
      }
    : undefined;
  const connection = isRecord(parsed.connection)
    ? {
        effectiveType: text(parsed.connection.effectiveType, 24),
        downlink: finiteNumber(parsed.connection.downlink, 0, 100_000),
        rtt: finiteNumber(parsed.connection.rtt, 0, 300_000),
        saveData: typeof parsed.connection.saveData === "boolean" ? parsed.connection.saveData : undefined
      }
    : undefined;
  return {
    userAgent: text(parsed.userAgent, 512),
    platform: text(parsed.platform, 120),
    language: text(parsed.language, 40),
    viewport: size(parsed.viewport),
    screen: size(parsed.screen),
    devicePixelRatio: finiteNumber(parsed.devicePixelRatio, 0.1, 20),
    maxTouchPoints: finiteNumber(parsed.maxTouchPoints, 0, 100),
    online: typeof parsed.online === "boolean" ? parsed.online : undefined,
    connection
  };
}

function parseCandidateMetadata(value: unknown): CandidateMetadata[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter(isRecord).slice(0, 3) as CandidateMetadata[] : [];
  } catch {
    return [];
  }
}

async function saveAttemptDiagnostics(
  attempt: AttemptRecord,
  audio: Buffer,
  fullSessionAudio?: Buffer,
  rawAudio?: Buffer
) {
  if (process.env.KID_READING_SAVE_AUDIO !== "1" || !audio?.length) return;

  try {
    await fs.mkdir(attemptAudioDir, { recursive: true });
    const basePath = path.join(attemptAudioDir, attempt.id);
    const writes = [
      fs.writeFile(
        `${basePath}.json`,
        JSON.stringify(
          {
            id: attempt.id,
            childId: attempt.childId,
            sentenceId: attempt.sentenceId,
            referenceText: attempt.referenceText,
            createdAt: attempt.createdAt,
            audioBytes: attempt.audioBytes,
            recordingQuality: attempt.recordingQuality,
            clientDevice: attempt.clientDevice,
            candidateSelection: attempt.candidateSelection,
            assessmentItemType: attempt.assessmentItemType,
            assessmentSource: attempt.assessmentSource,
            speechEnhancement: attempt.speechEnhancement,
            speechProviderComparison: attempt.speechProviderComparison,
            liveSpeechComparison: attempt.liveSpeechComparison,
            processingTimings: attempt.processingTimings,
            rejectedReason: attempt.rejectedReason,
            gate: {
              passed: attempt.passed,
              severeIssues: attempt.severeIssues,
              extraIssues: attempt.extraIssues,
              unscoredIssues: attempt.unscoredIssues,
              lowAccuracyIssues: attempt.lowAccuracyIssues,
              minWordAccuracy: attempt.minWordAccuracy
            },
            result: attempt.result
          },
          null,
          2
        ),
        "utf8"
      )
    ];
    if (attempt.rejectedReason) {
      writes.push(fs.writeFile(`${basePath}.wav`, audio));
    }
    if (attempt.rejectedReason && rawAudio?.length && attempt.speechEnhancement?.applied) {
      writes.push(fs.writeFile(`${basePath}.raw.wav`, rawAudio));
    }
    if (fullSessionAudio?.length && attempt.candidateSelection?.selectedKind !== "full-session") {
      writes.push(fs.writeFile(`${basePath}.full-session.wav`, fullSessionAudio));
    }
    await Promise.all(writes);
  } catch (error) {
    console.warn(`[attempt-audio] Unable to save diagnostics for ${attempt.id}:`, error);
  }
}

async function updateAttemptDiagnosticsLiveComparison(
  attemptId: string,
  comparison: LiveSpeechTestComparison
) {
  if (process.env.KID_READING_SAVE_AUDIO !== "1") return;
  const diagnosticsPath = path.join(attemptAudioDir, `${attemptId}.json`);
  try {
    const stored = JSON.parse(await fs.readFile(diagnosticsPath, "utf8")) as UnknownRecord;
    await fs.writeFile(
      diagnosticsPath,
      JSON.stringify({ ...stored, liveSpeechComparison: comparison }, null, 2),
      "utf8"
    );
  } catch (error: unknown) {
    const code = isRecord(error) ? String(error.code || "") : "";
    if (code !== "ENOENT") {
      console.warn(`[attempt-audio] Unable to attach live comparison for ${attemptId}:`, error);
    }
  }
}

async function saveAttemptRecording(attempt: AttemptRecord, audio: Buffer, rawAudio?: Buffer) {
  if (!audio?.length) return { audioAvailable: false, rawAudioAvailable: false };

  try {
    await fs.mkdir(attemptAudioDir, { recursive: true });
    const writes = [fs.writeFile(getAttemptAudioPath(attempt.id), audio)];
    const rawAudioAvailable = Boolean(rawAudio?.length && attempt.speechEnhancement?.applied);
    if (rawAudioAvailable && rawAudio) writes.push(fs.writeFile(getAttemptAudioPath(attempt.id, "raw"), rawAudio));
    await Promise.all(writes);
    return { audioAvailable: true, rawAudioAvailable };
  } catch (error) {
    console.warn(`[attempt-audio] Unable to save recording for ${attempt.id}:`, error);
    return { audioAvailable: false, rawAudioAvailable: false };
  }
}

const attemptUploadFields = upload.fields([
  { name: "audio", maxCount: 1 },
  { name: "candidateAudio", maxCount: 2 }
]);

app.post("/api/attempts", attemptUploadFields, async (req, res, next) => {
  await handleAttempt(req, res, next);
});

app.post("/api/attempts/live", async (req, res, next) => {
  await handleAttempt(req, res, next, speechProvider, { liveOnly: true });
});

app.post("/api/attempts/mock", attemptUploadFields, async (req, res, next) => {
  await handleAttempt(req, res, next, "mock");
});

app.get("/api/storybooks/:bookId/attempts", (req, res, next) => {
  try {
    const childId = String(req.query.childId || "");
    if (!childId) {
      res.status(400).json({ error: "childId is required" });
      return;
    }
    if (!hasChildAccess(req, childId)) {
      res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
      return;
    }
    res.json(listStorybookAttempts({ householdId: req.parentSession.householdId, childId, bookId: req.params.bookId }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/storybooks/import-preview", pdfUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "PDF file is required" });
      return;
    }
    if (req.file.mimetype !== "application/pdf" && !req.file.originalname.toLowerCase().endsWith(".pdf")) {
      res.status(400).json({ error: "Only PDF picture books are supported for now" });
      return;
    }

    const originalName = decodeMultipartFileName(req.file.originalname);
    const parser = new PDFParse({ data: req.file.buffer });
    let textResult: Awaited<ReturnType<PDFParse["getText"]>>;
    let screenshots: Awaited<ReturnType<PDFParse["getScreenshot"]>>;
    try {
      textResult = await parser.getText();
      const totalPages = Number(textResult.total || textResult.pages?.length || 0);
      if (!totalPages || totalPages > 40) {
        res.status(400).json({ error: totalPages > 40 ? "Picture-book PDF cannot exceed 40 pages" : "No readable PDF pages were found" });
        return;
      }
      screenshots = await parser.getScreenshot({ desiredWidth: 1200, imageBuffer: true });
    } finally {
      await parser.destroy();
    }

    const previewId = nanoid();
    const previewDir = path.join(storybookImportsDir, req.parentSession.householdId, previewId);
    await fs.mkdir(previewDir, { recursive: true });
    const pages: StorybookPreviewPage[] = [];
    for (const screenshot of screenshots.pages || []) {
      const pageNumber: number = Number(screenshot.pageNumber || pages.length + 1);
      const fileName = `page-${String(pageNumber).padStart(2, "0")}.png`;
      await fs.writeFile(path.join(previewDir, fileName), screenshot.data);
      const pageText = String(textResult.pages?.[pageNumber - 1]?.text || "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
      const reviewReason = getStorybookPageReviewReason(pageText, pageNumber);
      const candidateSentences = reviewReason ? [] : splitStorybookSentences(pageText);
      pages.push({
        id: `${previewId}-page-${pageNumber}`,
        pageNumber,
        imageUrl: `/api/admin/storybooks/import-previews/${previewId}/pages/${pageNumber}`,
        text: pageText,
        sentences: candidateSentences,
        practiceEnabled: candidateSentences.length > 0,
        reviewReason
      });
    }
    const preview: StorybookPreview = {
      id: previewId,
      title: path.parse(originalName).name.replace(/[-_]+/g, " ").trim(),
      originalName,
      pageCount: pages.length,
      pages
    };
    await fs.writeFile(path.join(previewDir, "manifest.json"), JSON.stringify(preview, null, 2), "utf8");
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/storybooks/import-previews/:previewId/pages/:pageNumber", (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(req.params.previewId) || !/^\d{1,2}$/.test(req.params.pageNumber)) {
      res.status(400).end();
      return;
    }
    const imagePath = path.join(storybookImportsDir, req.parentSession.householdId, req.params.previewId, `page-${String(Number(req.params.pageNumber)).padStart(2, "0")}.png`);
    res.type("image/png");
    res.sendFile(imagePath);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/storybooks/import-previews/:previewId/save", async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(req.params.previewId)) {
      res.status(400).json({ error: "Invalid preview" });
      return;
    }
    const previewDir = path.join(storybookImportsDir, req.parentSession.householdId, req.params.previewId);
    const preview = JSON.parse(await fs.readFile(path.join(previewDir, "manifest.json"), "utf8")) as StorybookPreview;
    const title = String(req.body.title || preview.title || "Imported picture book").trim().slice(0, 160);
    const storybookId = `imported-${req.params.previewId}`;
    const slug = `${slugifyStorybookTitle(title) || "picture-book"}-${req.params.previewId.slice(0, 6).toLowerCase()}`;
    const requestedPages: RequestedStorybookPage[] = Array.isArray(req.body.pages)
      ? req.body.pages.filter(isRecord) as RequestedStorybookPage[]
      : [];
    const requestedPageMap = new Map(requestedPages.map((page) => [Number(page.pageNumber), page]));
    const pages = preview.pages.map((page, pageIndex) => {
      const requested = requestedPageMap.get(Number(page.pageNumber));
      const practiceEnabled = requested
        ? requested.practiceEnabled === true
        : page.practiceEnabled !== false && Array.isArray(page.sentences) && page.sentences.length > 0;
      const requestedSentences = requested && Array.isArray(requested.sentences) ? requested.sentences : page.sentences;
      const sentences = practiceEnabled
        ? requestedSentences.map((text: unknown) => String(text || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20)
        : [];
      if (sentences.some((text) => text.length > 500)) throw new Error(`Page ${page.pageNumber} contains a sentence longer than 500 characters`);
      return {
        id: `${storybookId}-page-${pageIndex + 1}`,
        position: pageIndex,
        kind: pageIndex === 0 ? "cover" : "story",
        storage: { previewId: req.params.previewId, pageNumber: page.pageNumber },
        practiceEnabled,
        sourceText: page.text || "",
        sentences: sentences.map((text, sentenceIndex) => ({
          id: `${storybookId}-page-${pageIndex + 1}-sentence-${sentenceIndex + 1}`,
          text,
          position: sentenceIndex,
          required: true
        }))
      };
    });
    const emptyPracticePage = pages.find((page) => page.practiceEnabled && page.sentences.length === 0);
    if (emptyPracticePage) {
      res.status(400).json({ error: `第 ${emptyPracticePage.position + 1} 页已开启跟读，请至少添加一个句子` });
      return;
    }
    const saved = createStorybook({
      id: storybookId,
      householdId: req.parentSession.householdId,
      title,
      slug,
      summary: "由本地 PDF 自动解析生成，建议家长核对逐页文字和句子。",
      language: "en",
      level: "启蒙",
      tags: ["本地导入", "待校对"],
      creators: [],
      source: { name: "本地 PDF", url: "" },
      license: { code: "待确认", name: "请家长确认原文件版权", url: "", attribution: `Imported from ${preview.originalName}` },
      pages
    });
    if (!saved) throw new Error("Unable to save picture book");
    res.status(201).json(serializeStoredStorybook(saved));
  } catch (error) {
    next(error);
  }
});

app.get("/api/storybooks", (req, res) => {
  res.json(listStorybooks(req.parentSession.householdId).map(serializeStoredStorybook));
});

app.get("/api/storybooks/:bookId", (req, res) => {
  const book = findStorybookById(req.params.bookId, req.parentSession.householdId);
  if (!book) {
    res.status(404).json({ error: "Picture book not found" });
    return;
  }
  res.json(serializeStoredStorybook(book));
});

app.delete("/api/admin/storybooks/:bookId", (req, res) => {
  const deleted = deleteStorybook(req.params.bookId, req.parentSession.householdId);
  if (!deleted) {
    res.status(404).json({ error: "Picture book not found" });
    return;
  }
  res.status(204).end();
});

app.get("/api/storybooks/:bookId/pages/:pageNumber/image", (req, res, next) => {
  try {
    const book = findStorybookById(req.params.bookId, req.parentSession.householdId);
    const page = book?.pages?.[Number(req.params.pageNumber) - 1];
    if (!page?.storage?.previewId || !page.storage.pageNumber) {
      res.status(404).end();
      return;
    }
    const imagePath = path.join(storybookImportsDir, req.parentSession.householdId, page.storage.previewId, `page-${String(page.storage.pageNumber).padStart(2, "0")}.png`);
    res.type("image/png");
    res.sendFile(imagePath);
  } catch (error) {
    next(error);
  }
});

function serializeStoredStorybook(book: HydratedStorybook) {
  const pages = (book.pages || []).map((page, index) => ({
    ...page,
    imageUrl: `/api/storybooks/${encodeURIComponent(book.id)}/pages/${index + 1}/image`
  }));
  return { ...book, pages, coverImageUrl: pages[0]?.imageUrl || "" };
}

function slugifyStorybookTitle(value: unknown) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function splitStorybookSentences(text: string) {
  if (!text) return [];
  return (text.match(/[^.!?]+[.!?]+(?:[”\"])?|[^.!?]+$/g) || [])
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => /[A-Za-z]/.test(sentence) && sentence.length >= 2)
    .slice(0, 20);
}

function decodeMultipartFileName(value: unknown) {
  const source = String(value || "");
  if (!/[\u0080-\u00ff]/.test(source)) return source;
  const decoded = Buffer.from(source, "latin1").toString("utf8");
  return decoded && !decoded.includes("�") ? decoded : source;
}

function getStorybookPageReviewReason(text: string, pageNumber: number) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return "本页没有可提取文字";
  if (pageNumber <= 2) return "封面或署名页，建议不设跟读句子";
  if (/(?:creative commons|licensed under|you are free to share|the licensor|bookdash\.org)/i.test(normalized)) return "版权说明页，建议不设跟读句子";
  return "";
}

function configuredPrimaryAuthHosts() {
  return new Set(
    String(process.env.PRIMARY_AUTH_HOSTS || "")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getAuthenticationCookieRoot() {
  return String(process.env.AUTH_COOKIE_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
}

function getPrimaryAuthenticationOrigin() {
  const configured = String(process.env.PRIMARY_AUTH_ORIGIN || "").trim();
  try {
    const origin = new URL(configured).origin;
    return origin.startsWith("https://") ? origin : "";
  } catch {
    return "";
  }
}

function shouldRedirectSecondaryHostToLogin(req: Request) {
  if (!["GET", "HEAD"].includes(req.method) || !req.accepts("html")) return false;
  const primaryHosts = configuredPrimaryAuthHosts();
  const primaryOrigin = getPrimaryAuthenticationOrigin();
  const cookieRoot = getAuthenticationCookieRoot();
  if (!primaryHosts.size || !primaryOrigin || !cookieRoot) return false;

  const hostname = String(req.hostname || "").trim().toLowerCase();
  if (!hostname || primaryHosts.has(hostname)) return false;
  if (hostname !== cookieRoot && !hostname.endsWith(`.${cookieRoot}`)) return false;
  return !readAccessSession(req);
}

app.post("/api/ai/hint", async (_req, res) => {
  if (aiProvider !== "openai") {
    res.status(501).json({
      error: "AI hints are disabled. Set AI_PROVIDER=openai and OPENAI_API_KEY after adding the OpenAI backend call."
    });
    return;
  }

  res.status(501).json({
    error: "OpenAI hint provider is reserved for the backend. Do not call OpenAI directly from the browser or mini program."
  });
});

if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (!req.path.startsWith("/admin") || !["GET", "HEAD"].includes(req.method) || !req.accepts("html")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-store, private");
    const session = readAccessSession(req);
    if (!session) {
      const loginUrl = new URL("/login", getPrimaryAuthenticationOrigin() || `${req.protocol}://${req.get("host")}`);
      loginUrl.searchParams.set("next", req.originalUrl.startsWith("/") ? req.originalUrl : "/admin");
      res.redirect(302, loginUrl.toString());
      return;
    }
    if (session.kind !== "parent" || !isPlatformAdminSession(session)) {
      res.redirect(302, "/parent");
      return;
    }
    next();
  });
  app.use((req, res, next) => {
    if (!shouldRedirectSecondaryHostToLogin(req)) {
      next();
      return;
    }
    const nextPath = req.originalUrl.startsWith("/") ? req.originalUrl : "/practice";
    const loginUrl = new URL("/login", getPrimaryAuthenticationOrigin());
    loginUrl.searchParams.set("next", nextPath);
    res.redirect(302, loginUrl.toString());
  });
  app.use(express.static(distPath));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
});

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = app.listen(port, host, () => {
    console.log(`Kid English Reading API listening on http://${host}:${port}`);
  });
  attachLiveSpeechServer(server);
}

export {
  app,
  attachLiveSpeechServer,
  buildProgress,
  buildPdfImportChaptersFromStructure,
  buildPdfStructureFromLayout,
  mergePepReadingParagraphs
};
