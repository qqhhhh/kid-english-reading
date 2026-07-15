import cors from "cors";
import express from "express";
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
  createLesson,
  createPlatformAdminAuditLog,
  disableRegistrationKey,
  consumeCourseSyncNonce,
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
import { selectAttemptCandidate } from "./candidateSelection.js";
import { getAssessmentRejection } from "./assessmentValidity.js";
import { cropAttemptPlaybackAudio } from "./attemptPlaybackAudio.js";
import { evaluateNoiseGate } from "./noiseQuality.js";
import { applyScorePolicy, getPolicyScore, hasValidPassedScore, selectBestPassedAttempt } from "./scoringPolicy.js";
import { enhanceSpeech, getSpeechEnhancementStatus } from "./speechEnhancement.js";
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
import { extractPdfLayout } from "./pdfLayout.js";
import { assessPdfImportQuality, getPdfPublicationBlockers } from "./pdfImportQuality.js";
import { verifyPdfImport } from "./pdfImportVerification.js";
import { buildPdfImportSnapshot, renderPdfPageAssets } from "./pdfImportArtifacts.js";
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
import { cloneCourseLibraryResource, cloneCourseLibrarySnapshot, listCourseLibraryResources } from "./courseLibrary.js";
import { evaluatePass } from "./passGate.js";
import { findTtsVoice, getDefaultTtsVoice, tencentTtsVoices } from "./ttsVoices.js";
import { findFilingReviewSentence, isFilingReviewSentenceText, sendFilingReviewReadModel } from "./filingReviewSandbox.js";
import {
  authenticateParent,
  clearParentSessionCookie,
  clearChildSessionCookie,
  clearReviewSessionCookie,
  createChildPairingCode,
  createParentSession,
  createRegistrationKey,
  pairChildDevice,
  publicAccessSession,
  publicParentSession,
  isPlatformAdminSession,
  readAccessSession,
  registerParent,
  revokeChildSession,
  revokeParentSession,
  setChildSessionCookie,
  setParentSessionCookie,
  setReviewSessionCookie
} from "./parentAuth.js";
import { listChildDeviceSessions, revokeChildDeviceSession } from "./db.js";

loadEnvFile();
initDatabase();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || "127.0.0.1";
const speechProvider = process.env.SPEECH_PROVIDER || "mock";
const ttsProvider = process.env.TTS_PROVIDER || "tencent";
const aiProvider = process.env.AI_PROVIDER || "disabled";
const supportedSpeechProviders = ["mock", "tencent", "azure", "xfyun"];
const supportedTtsProviders = ["tencent", "openai"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const courseSyncUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 100, fields: 4, fieldSize: 20 * 1024 * 1024 }
});
const courseSyncMaxRequestBytes = 128 * 1024 * 1024;
const courseSyncRateWindowMs = 15 * 60 * 1000;
const courseSyncRateLimit = 12;
const courseSyncConcurrentLimit = 2;
const distPath = path.join(__dirname, "..", "dist");
const allowedLessonSourceTypes = new Set(["manual", "preset", "pdf", "ebook", "import", "textbook"]);
const maxPdfImportSentences = 480;
const automaticPracticeStopReasons = new Set([
  "manual",
  "completed",
  "no-speech",
  "failed-attempts",
  "interrupted",
  "service-error",
  "navigation"
]);
const pdfNoisePhrasePattern =
  /\b(?:listen and (?:chant|sing|repeat|circle|write|number|choose|match)|look(?:, listen)? and (?:think|write|say)|read(?:, listen)? and (?:circle|number|tick|write)|(?:let['’]?s|lets)\s+(?:chant|sing|talk|learn|spell)|draw and say|match and say|choose and write|make a list and talk|talk about your best friend|do a survey|self-check|project:|activity name|big question)\b/gi;
const pdfNoisePhraseMatcher = new RegExp(pdfNoisePhrasePattern.source, "i");
const pdfNoiseSentencePattern =
  /\b(?:listen|circle|number|tick|match|choose|draw|survey|self-check|project|activity|contents|revision|picture|big question)\b/i;
const pdfGuidingQuestionPattern =
  /\b(?:what do family do together|what makes .+ special|how are these children|how do these children|how special are your friends)\b/i;
const pdfTargetActivityPatterns = [
  {
    key: "listen-and-chant",
    label: "Listen and chant",
    pattern: /listen\s+and\s+chant/i
  },
  {
    key: "lets-talk",
    label: "Let's talk",
    pattern: /(?:let['’]?s|lets)\s+talk/i
  }
];
const pdfImportRuleLabels = {
  default: "通用PDF",
  "pep-textbook": "PEP课本"
};

app.disable("x-powered-by");

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const configured = new Set(String(process.env.CORS_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
  if (configured.has(origin)) return true;
  try {
    const url = new URL(origin);
    const loopback = ["http:", "https:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    return loopback;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "manifest-src 'self'"
    ].join("; "));
  }
  next();
});
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    callback(null, isAllowedCorsOrigin(origin));
  }
}));
app.use(express.json({ limit: "4mb" }));

const authAttempts = new Map();
const filingReviewAttemptTimes = new Map();
const courseSyncAttempts = new Map();
const courseSyncFailureAuditTimes = new Map();
let activeCourseSyncUploads = 0;

function checkAuthRateLimit(request, response, next) {
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (recent.length >= 12) {
    response.status(429).json({ error: "AUTH_RATE_LIMITED" });
    return;
  }
  recent.push(now);
  authAttempts.set(key, recent);
  next();
}

function reviewAttemptAllowed(request) {
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (filingReviewAttemptTimes.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (recent.length >= 20) return false;
  recent.push(now);
  filingReviewAttemptTimes.set(key, recent);
  return true;
}

function sendAuthError(response, error) {
  const code = String(error?.message || "AUTH_FAILED");
  const knownCodes = new Set([
    "USERNAME_INVALID",
    "USERNAME_TAKEN",
    "PASSWORD_INVALID",
    "REGISTRATION_KEY_INVALID",
    "REGISTRATION_KEY_EXPIRED",
    "REGISTRATION_KEY_USED"
  ]);
  response.status(knownCodes.has(code) ? 400 : 500).json({ error: knownCodes.has(code) ? code : "AUTH_FAILED" });
}

app.get("/api/auth/session", (req, res) => {
  const session = readAccessSession(req);
  res.json({ authenticated: Boolean(session), session: publicAccessSession(session) });
});

app.post("/api/auth/filing-review", checkAuthRateLimit, (req, res) => {
  setReviewSessionCookie(res);
  res.status(201).json({
    authenticated: true,
    session: {
      kind: "child",
      child: { id: "filing-review-child", name: "体验学生" },
      household: { id: "filing-review-household", name: "体验家庭" },
      device: { id: "filing-review-session", label: "体验设备" },
      reviewOnly: true
    }
  });
});

app.post("/api/auth/child-pair", checkAuthRateLimit, (req, res) => {
  try {
    const paired = pairChildDevice({ code: req.body.code, label: req.body.label });
    revokeParentSession(req);
    clearParentSessionCookie(res);
    setChildSessionCookie(res, paired.token);
    clearReviewSessionCookie(res);
    res.status(201).json({ authenticated: true, session: publicAccessSession({ ...paired.session, kind: "child" }) });
  } catch (error) {
    res.status(400).json({ error: String(error?.message || "") === "CHILD_PAIR_CODE_INVALID" ? "CHILD_PAIR_CODE_INVALID" : "AUTH_FAILED" });
  }
});

app.post("/api/auth/register", checkAuthRateLimit, async (req, res) => {
  try {
    const user = await registerParent({
      registrationKey: req.body.registrationKey,
      username: req.body.username,
      password: req.body.password,
      householdName: req.body.householdName
    });
    const session = createParentSession(user.id);
    revokeChildSession(req);
    setParentSessionCookie(res, session.token);
    clearChildSessionCookie(res);
    clearReviewSessionCookie(res);
    res.status(201).json({ authenticated: true, session: publicParentSession({ ...user, id: user.id }) });
  } catch (error) {
    sendAuthError(res, error);
  }
});

app.post("/api/auth/login", checkAuthRateLimit, async (req, res) => {
  const user = await authenticateParent(req.body.username, req.body.password);
  if (!user) {
    res.status(401).json({ error: "LOGIN_INVALID" });
    return;
  }
  const session = createParentSession(user.id);
  revokeChildSession(req);
  setParentSessionCookie(res, session.token);
  clearChildSessionCookie(res);
  clearReviewSessionCookie(res);
  res.json({ authenticated: true, session: publicParentSession(user) });
});

app.post("/api/auth/logout", (req, res) => {
  revokeParentSession(req);
  revokeChildSession(req);
  clearParentSessionCookie(res);
  clearChildSessionCookie(res);
  clearReviewSessionCookie(res);
  res.status(204).end();
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/tts/voices" || req.path === "/course-sync/packages") {
    next();
    return;
  }
  const session = readAccessSession(req);
  if (!session) {
    res.status(401).json({ error: "AUTH_REQUIRED" });
    return;
  }
  req.parentSession = session;
  if (session.kind === "review") {
    const isEphemeralAttempt = req.method === "POST" && req.path === "/attempts";
    if (isEphemeralAttempt && !reviewAttemptAllowed(req)) {
      res.status(429).json({ error: "REVIEW_RATE_LIMITED" });
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !isEphemeralAttempt) {
      res.status(403).json({ error: "REVIEW_READ_ONLY" });
      return;
    }
    if (req.path === "/tts/storybook" && !isFilingReviewSentenceText(req.query.text)) {
      res.status(403).json({ error: "REVIEW_CONTENT_RESTRICTED" });
      return;
    }
    if (sendFilingReviewReadModel(req, res)) return;
  }
  next();
});

app.use("/api/admin", (req, res, next) => {
  if (req.parentSession.kind !== "parent") {
    res.status(403).json({ error: "PARENT_AUTH_REQUIRED" });
    return;
  }
  next();
});

// Shared content-import entry point used by both the household console and the
// platform administrator. Keep the legacy /api/admin/import alias below while
// clients migrate to /api/import.
app.use("/api/import", (req, res, next) => {
  if (req.parentSession.kind !== "parent") {
    res.status(403).json({ error: "PARENT_AUTH_REQUIRED" });
    return;
  }
  next();
});

function writePlatformAdminAudit(req, { action, status, summary, metadata = {} }) {
  try {
    createPlatformAdminAuditLog({
      id: `admin-audit-${nanoid(14)}`,
      actorUserId: req.parentSession?.id || "",
      actorUsername: req.parentSession?.username || "unknown",
      action,
      status,
      summary,
      metadata
    });
  } catch (error) {
    console.error("[platform-admin-audit] unable to persist log", error);
  }
}

function beginPlatformAdminAudit(req, res, { action, summary, metadata = {} }) {
  const startedAt = Date.now();
  const baseMetadata = {
    method: req.method,
    path: String(req.originalUrl || req.path || "").split("?")[0],
    ...metadata
  };
  writePlatformAdminAudit(req, { action, status: "started", summary: `${summary}：开始`, metadata: baseMetadata });
  res.once("finish", () => {
    const succeeded = res.statusCode < 400;
    writePlatformAdminAudit(req, {
      action,
      status: succeeded ? "success" : "failure",
      summary: `${summary}：${succeeded ? "完成" : "失败"}`,
      metadata: {
        ...baseMetadata,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      }
    });
  });
  return {
    addMetadata(nextMetadata = {}) {
      if (nextMetadata && typeof nextMetadata === "object") Object.assign(baseMetadata, nextMetadata);
    }
  };
}

function describePlatformAdminMutation(req) {
  if (req.method === "POST" && req.path === "/registration-keys/batch") {
    return {
      action: "registration-key.batch.create",
      summary: `批量生成 ${Math.min(100, Math.max(1, Number(req.body?.quantity) || 1))} 个注册 Key`,
      metadata: { quantity: Math.min(100, Math.max(1, Number(req.body?.quantity) || 1)) }
    };
  }
  if (req.method === "PATCH" && /^\/registration-keys\/[^/]+$/.test(req.path)) {
    const keyId = decodeURIComponent(req.path.split("/")[2] || "").slice(0, 100);
    return { action: "registration-key.note.update", summary: "更新注册 Key 备注", metadata: { keyId } };
  }
  if (req.method === "POST" && /^\/registration-keys\/[^/]+\/disable$/.test(req.path)) {
    const keyId = decodeURIComponent(req.path.split("/")[2] || "").slice(0, 100);
    return { action: "registration-key.disable", summary: "停用注册 Key", metadata: { keyId } };
  }
  if (req.method === "POST" && req.path === "/hunyuan-ocr/start") {
    return { action: "hunyuan.start", summary: "启动 HunyuanOCR" };
  }
  if (req.method === "POST" && req.path === "/hunyuan-ocr/stop") {
    return { action: "hunyuan.stop", summary: "停止 HunyuanOCR" };
  }
  if (req.method === "POST" && req.path === "/courses") {
    const title = String(req.body?.title || "未命名课程").trim().slice(0, 100);
    const isVersion = Boolean(String(req.body?.resourceId || "").trim());
    return {
      action: isVersion ? "course.version.publish" : "course.publish",
      summary: `${isVersion ? "发布课程新版本" : "发布官方课程"}《${title}》`,
      metadata: {
        resourceId: String(req.body?.resourceId || "").slice(0, 100),
        importId: String(req.body?.importId || "").slice(0, 100)
      }
    };
  }
  if (req.method === "POST" && req.path === "/course-sync/send") {
    const title = String(req.body?.title || "未命名课程").trim().slice(0, 100);
    return {
      action: "course.sync.send",
      summary: `同步课程草稿《${title}》到服务器`,
      metadata: { importId: String(req.body?.importId || "").slice(0, 100) }
    };
  }
  if (req.method === "POST" && /^\/course-sync\/drafts\/[^/]+\/publish$/.test(req.path)) {
    const draftId = decodeURIComponent(req.path.split("/")[3] || "").slice(0, 100);
    return {
      action: "course.sync.publish",
      summary: `发布服务器课程草稿 ${draftId}`,
      metadata: { draftId }
    };
  }
  if (req.method === "PATCH" && /^\/courses\/[^/]+\/status$/.test(req.path)) {
    const status = req.body?.status === "published" ? "published" : "unpublished";
    const resourceId = decodeURIComponent(req.path.split("/")[2] || "").slice(0, 100);
    return {
      action: status === "published" ? "course.restore" : "course.unpublish",
      summary: `${status === "published" ? "恢复" : "下架"}官方课程 ${resourceId}`,
      metadata: { resourceId, requestedStatus: status }
    };
  }
  return null;
}

app.use("/api/platform-admin", (req, res, next) => {
  if (req.parentSession.kind !== "parent" || !isPlatformAdminSession(req.parentSession)) {
    res.status(403).json({ error: "PLATFORM_ADMIN_REQUIRED" });
    return;
  }
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  const audit = describePlatformAdminMutation(req);
  if (audit) beginPlatformAdminAudit(req, res, audit);
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (process.env.NODE_ENV === "production" && mutation && req.get("X-Admin-Request") !== "1") {
    res.status(403).json({ error: "ADMIN_REQUEST_VERIFICATION_REQUIRED" });
    return;
  }
  next();
});

function requireLocalCourseStudio(req, res, next) {
  const enabled = ["1", "true", "yes"].includes(String(process.env.LOCAL_COURSE_STUDIO_ENABLED || "").trim().toLowerCase());
  const remoteAddress = String(req.socket?.remoteAddress || "");
  const loopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (!enabled || !loopback) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  next();
}

function hasChildAccess(req, childId) {
  return req.parentSession.kind !== "child" || req.parentSession.childId === childId;
}

const dataDir = process.env.KID_READING_DATA_DIR
  ? path.resolve(process.env.KID_READING_DATA_DIR)
  : path.join(__dirname, "data");
const attemptAudioDir = path.join(dataDir, "attempt-audio");
const ttsDir = path.join(dataDir, "tts");
const pdfImportsDir = path.join(dataDir, "imports");
const storybookImportsDir = path.join(dataDir, "storybook-imports");
const courseSyncDir = path.join(dataDir, "course-sync");

function getAttemptAudioPath(attemptId, variant = "enhanced") {
  return path.join(attemptAudioDir, `${attemptId}${variant === "raw" ? ".raw" : ""}.wav`);
}

async function hasAttemptAudio(attemptId, variant = "enhanced") {
  try {
    await fs.access(getAttemptAudioPath(attemptId, variant));
    return true;
  } catch {
    return false;
  }
}

async function buildProgress(childId, householdId) {
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
      const completed = passed || (optional && sentenceAttempts.length > 0);
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

async function findSentence(sentenceId, householdId) {
  return findSentenceById(sentenceId, householdId);
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function splitReadingText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/[.!?]$/.test(item) ? item : `${item}.`));
}

function normalizeLessonSourceType(sourceType) {
  const normalized = String(sourceType || "manual").trim();
  return allowedLessonSourceTypes.has(normalized) ? normalized : "manual";
}

function normalizePdfImportRule(rule) {
  const normalized = String(rule || "pep-textbook").trim();
  return Object.hasOwn(pdfImportRuleLabels, normalized) ? normalized : "pep-textbook";
}

function repairPossiblyMojibake(value = "") {
  const text = String(value || "");
  if (!text) return text;

  const repaired = Buffer.from(text, "latin1").toString("utf8");
  const score = (candidate) => {
    const cjk = candidate.match(/[\u4e00-\u9fff]/g)?.length || 0;
    const mojibake = candidate.match(/[ÃÂÄÅÆÇÈÉåèéæçï¼]/g)?.length || 0;
    const replacement = candidate.match(/\uFFFD/g)?.length || 0;
    return cjk * 3 - mojibake * 2 - replacement * 4;
  };

  return score(repaired) > score(text) ? repaired : text;
}

function sanitizeImportTitle(fileName = "") {
  const repairedFileName = repairPossiblyMojibake(fileName);
  const baseName = path.basename(repairedFileName, path.extname(repairedFileName));
  const title = baseName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || "PDF 导入课程";
}

function isLikelyPdfPageMarker(line) {
  const value = line.trim();
  if (!value) return false;
  if (/^pep\s*\.?\s*com\.?$/i.test(value)) return true;
  if (/^contents$/i.test(value)) return true;
  if (/^致\s*同\s*学$/.test(value)) return true;
  if (/^[-–—]{2,}\s*\d+\s+of\s+\d+\s*[-–—]*$/i.test(value)) return true;
  if (/^\d{1,4}$/.test(value)) return true;
  if (/^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(value)) return true;
  if (/^page\s+\d{1,4}(\s+of\s+\d{1,4})?$/i.test(value)) return true;
  return false;
}

function getImportHeading(line) {
  const value = line.trim();
  if (!value || value.length > 96) return false;
  if (/^unit\s+\d+\s+.+\s+\d{1,3}$/i.test(value)) return false;
  if (/^(unit|module|chapter|lesson|part|story)\s+[\w\d]+(?:\b|[:：.-])/i.test(value)) {
    return value.replace(/\s+/g, " ");
  }
  if (/^第\s*[\d一二三四五六七八九十]+\s*(单元|章|课)\b/.test(value)) {
    return value.replace(/\s+/g, " ");
  }
  return "";
}

function isImportHeading(line) {
  return Boolean(getImportHeading(line));
}

function normalizeImportKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStructureLines(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[◆●■]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isTocEntry(line) {
  return /^unit\s+\d+\s+.+\s+\d{1,3}$/i.test(line.trim());
}

function parseTocEntry(line) {
  const match = line.trim().match(/^unit\s+(\d+)\s+(.+?)\s+(\d{1,3})$/i);
  if (!match) return null;
  const unitNumber = Number(match[1]);
  const title = match[2].trim().replace(/\s+/g, " ");
  return {
    id: `pdf-toc-${nanoid(8)}`,
    unitNumber,
    unitLabel: `Unit ${unitNumber}`,
    title: `Unit ${unitNumber} ${title}`,
    shortTitle: title,
    page: Number(match[3])
  };
}

function extractPdfTocEntries(pages) {
  const entries = [];
  const seen = new Set();
  for (const page of pages) {
    for (const line of normalizeStructureLines(page.text)) {
      const entry = parseTocEntry(line);
      if (!entry) continue;
      const key = `${entry.unitNumber}:${normalizeImportKey(entry.shortTitle)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => a.unitNumber - b.unitNumber || a.page - b.page);
}

function findTocEntryForHeading(heading, tocEntries) {
  const match = String(heading || "").match(/^unit\s+(\d+)/i);
  if (!match) return null;
  const unitNumber = Number(match[1]);
  return tocEntries.find((entry) => entry.unitNumber === unitNumber) || null;
}

function getTargetActivity(text) {
  const value = String(text || "");
  return pdfTargetActivityPatterns.find((activity) => activity.pattern.test(value)) || null;
}

function removeTargetActivityText(text) {
  return pdfTargetActivityPatterns
    .reduce((nextText, activity) => nextText.replace(activity.pattern, " "), String(text || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function isDialogueActivity(activity) {
  return activity?.key === "lets-talk";
}

function isLikelyUtteranceEnd(line) {
  return /[.!?。！？]["'”’)]?$/.test(String(line || "").trim());
}

function isRepeatedUnitTitle(line, unit) {
  if (!unit) return false;
  const lineKey = normalizeImportKey(line);
  if (!lineKey) return false;
  const titleKey = normalizeImportKey(unit.title);
  const unitLabelKey = normalizeImportKey(unit.toc?.unitLabel || unit.title);
  const shortTitleKey = normalizeImportKey(unit.toc?.shortTitle || "");
  return lineKey === titleKey || (Boolean(shortTitleKey) && lineKey === shortTitleKey) || lineKey === unitLabelKey;
}

function findExistingPdfUnit(units, tocEntry, heading) {
  if (tocEntry) {
    return units.find((unit) => unit.toc?.unitNumber === tocEntry.unitNumber) || null;
  }

  const headingKey = normalizeImportKey(heading);
  return units.find((unit) => normalizeImportKey(unit.title) === headingKey) || null;
}

function extractSectionPrefix(line) {
  const match = line.trim().match(/^([ABC])(?:\s+|$)(.*)$/);
  if (!match) return null;
  const rest = (match[2] || "").trim();
  return {
    title: `Part ${match[1].toUpperCase()}`,
    rest
  };
}

function hasVocabularyLeadIn(text) {
  const value = String(text || "")
    .replace(/^\d+\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:[a-z]+(?:['’][a-z]+)?\s+){3,}[A-Z]/.test(value);
}

function classifyStructureBlock(rawText, page, context = {}) {
  const text = cleanImportedSentence(rawText);
  const sentences = splitImportedSentences(text, {
    preserveAsUtterance: Boolean(context.preserveAsUtterance)
  });
  const activity = context.activity || "";
  const targetActivity = Boolean(context.targetActivity);

  const withActivity = (block) => ({
    ...block,
    ...(activity ? { activity } : {}),
    ...(targetActivity ? { targetActivity: true } : {})
  });

  if (!text || isLikelyPdfPageMarker(text)) {
    return null;
  }

  if (isTocEntry(text)) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "note",
      text,
      page,
      candidate: false,
      reason: "目录项",
      sentences: []
    });
  }

  if (pdfNoisePhraseMatcher.test(text)) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "activity",
      text,
      page,
      candidate: false,
      reason: "教材活动指令",
      sentences: []
    });
  }

  if (hasVocabularyLeadIn(rawText) || hasVocabularyLeadIn(text)) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "vocabulary",
      text,
      page,
      candidate: false,
      reason: "词汇表或单词练习块",
      sentences: []
    });
  }

  if (sentences.length > 0) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: /[?？]$/.test(text) ? "question" : "reading",
      text,
      page,
      candidate: true,
      sentences
    });
  }

  if (/[?？]$/.test(text) || pdfGuidingQuestionPattern.test(text)) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "question",
      text,
      page,
      candidate: false,
      reason: "教材引导问题",
      sentences: []
    });
  }

  const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  const hasPunctuation = /[.!?。！？]/.test(text);
  if (!hasPunctuation && words.length >= 2 && words.length <= 16) {
    return withActivity({
      id: `pdf-block-${nanoid(8)}`,
      type: "vocabulary",
      text,
      page,
      candidate: false,
      reason: "词汇或短语块",
      sentences: []
    });
  }

  return withActivity({
    id: `pdf-block-${nanoid(8)}`,
    type: "note",
    text,
    page,
    candidate: false,
    reason: "非跟读文本",
    sentences: []
  });
}

function createPdfSection(title, page) {
  return {
    id: `pdf-section-${nanoid(8)}`,
    title,
    pageStart: page,
    pageEnd: page,
    blocks: []
  };
}

function createPdfUnit(title, page, toc = null) {
  return {
    id: `pdf-unit-${nanoid(8)}`,
    title,
    ...(toc ? { toc } : {}),
    pageStart: page,
    pageEnd: page,
    sections: [createPdfSection("正文", page)]
  };
}

function appendStructureBlock(target, block) {
  if (!block) return;
  target.blocks.push(block);
  target.pageEnd = Math.max(target.pageEnd, block.page);
}

function buildPdfStructure({ title, pages }) {
  const toc = extractPdfTocEntries(pages);
  const units = [];
  const frontMatter = [];
  let currentUnit = null;
  let currentSection = null;
  let currentActivity = null;
  let pendingDialogue = null;

  const addFrontMatter = (block) => {
    if (block) frontMatter.push(block);
  };

  const flushPendingDialogue = () => {
    if (!pendingDialogue?.lines.length) {
      pendingDialogue = null;
      return;
    }

    const block = classifyStructureBlock(pendingDialogue.lines.join(" "), pendingDialogue.page, {
      activity: pendingDialogue.activity.label,
      targetActivity: true,
      preserveAsUtterance: true
    });
    appendStructureBlock(pendingDialogue.section, block);
    pendingDialogue.unit.pageEnd = Math.max(pendingDialogue.unit.pageEnd, block?.page || pendingDialogue.page);
    pendingDialogue = null;
  };

  for (const page of pages) {
    const pageNumber = Number(page.num || page.page || 0) || pages.indexOf(page) + 1;
    for (const rawLine of normalizeStructureLines(page.text)) {
      const heading = getImportHeading(rawLine);
      if (heading) {
        flushPendingDialogue();
        const tocEntry = findTocEntryForHeading(heading, toc);
        const unitTitle = tocEntry?.title || heading;
        const existingUnit = findExistingPdfUnit(units, tocEntry, unitTitle);
        if (existingUnit) {
          currentUnit = existingUnit;
          currentUnit.pageEnd = Math.max(currentUnit.pageEnd, pageNumber);
          currentSection = createPdfSection("正文", pageNumber);
          currentUnit.sections.push(currentSection);
        } else {
          currentUnit = createPdfUnit(unitTitle, pageNumber, tocEntry);
          units.push(currentUnit);
          currentSection = currentUnit.sections[0];
        }
        currentActivity = null;
        continue;
      }

      if (currentUnit && isRepeatedUnitTitle(rawLine, currentUnit)) {
        flushPendingDialogue();
        appendStructureBlock(currentSection, {
          id: `pdf-block-${nanoid(8)}`,
          type: "heading",
          text: rawLine,
          page: pageNumber,
          candidate: false,
          reason: "重复章节名",
          sentences: []
        });
        continue;
      }

      const sectionPrefix = extractSectionPrefix(rawLine);
      let line = rawLine;
      if (sectionPrefix && currentUnit) {
        flushPendingDialogue();
        currentSection = createPdfSection(sectionPrefix.title, pageNumber);
        currentUnit.sections.push(currentSection);
        currentActivity = null;
        line = sectionPrefix.rest;
        if (!line) continue;
      }

      const targetActivity = getTargetActivity(line);
      if (targetActivity && currentUnit) {
        flushPendingDialogue();
        currentActivity = targetActivity;
        currentSection = createPdfSection(targetActivity.label, pageNumber);
        currentUnit.sections.push(currentSection);
        appendStructureBlock(currentSection, {
          id: `pdf-block-${nanoid(8)}`,
          type: "activity",
          text: targetActivity.label,
          page: pageNumber,
          candidate: false,
          reason: "目标听读栏目",
          activity: targetActivity.label,
          targetActivity: true,
          sentences: []
        });
        line = removeTargetActivityText(line);
        if (!line) {
          continue;
        }
      } else if (pdfNoisePhraseMatcher.test(line)) {
        flushPendingDialogue();
        currentActivity = null;
      }

      if (currentUnit && currentSection && isDialogueActivity(currentActivity)) {
        if (!pendingDialogue) {
          pendingDialogue = {
            activity: currentActivity,
            unit: currentUnit,
            section: currentSection,
            page: pageNumber,
            lines: []
          };
        }
        pendingDialogue.lines.push(line);
        if (isLikelyUtteranceEnd(line)) {
          flushPendingDialogue();
        }
        continue;
      }

      const block = classifyStructureBlock(line, pageNumber, {
        activity: currentActivity?.label || "",
        targetActivity: Boolean(currentActivity)
      });
      if (currentUnit && currentSection) {
        appendStructureBlock(currentSection, block);
        currentUnit.pageEnd = Math.max(currentUnit.pageEnd, block?.page || pageNumber);
      } else {
        addFrontMatter(block);
      }
    }
  }
  flushPendingDialogue();

  for (const entry of toc) {
    const hasUnit = units.some((unit) => unit.toc?.unitNumber === entry.unitNumber || normalizeImportKey(unit.title).startsWith(normalizeImportKey(entry.unitLabel)));
    if (!hasUnit) {
      units.push({
        id: `pdf-unit-${nanoid(8)}`,
        title: entry.title,
        toc: entry,
        pageStart: entry.page,
        pageEnd: entry.page,
        sections: []
      });
    }
  }

  units.sort((a, b) => {
    const unitA = a.toc?.unitNumber || Number.MAX_SAFE_INTEGER;
    const unitB = b.toc?.unitNumber || Number.MAX_SAFE_INTEGER;
    return unitA - unitB || a.pageStart - b.pageStart;
  });

  const sections = units.flatMap((unit) => unit.sections);
  const blocks = [...frontMatter, ...sections.flatMap((section) => section.blocks)];
  const candidateBlocks = blocks.filter((block) => block.candidate);
  const targetBlocks = candidateBlocks.filter((block) => block.targetActivity);
  return {
    version: 1,
    title,
    toc,
    units,
    frontMatter,
    stats: {
      pages: pages.length,
      tocEntries: toc.length,
      units: units.length,
      sections: sections.length,
      blocks: blocks.length,
      candidateBlocks: candidateBlocks.length,
      candidateSentences: candidateBlocks.reduce((sum, block) => sum + block.sentences.length, 0),
      targetBlocks: targetBlocks.length,
      targetSentences: targetBlocks.reduce((sum, block) => sum + block.sentences.length, 0),
      ignoredBlocks: blocks.filter((block) => !block.candidate).length
    }
  };
}

function buildPdfStructureStats({ pages, toc, units, frontMatter }) {
  const sections = units.flatMap((unit) => unit.sections || []);
  const blocks = [...frontMatter, ...sections.flatMap((section) => section.blocks || [])];
  const candidateBlocks = blocks.filter((block) => block.candidate);
  const targetBlocks = candidateBlocks.filter((block) => block.targetActivity);

  return {
    pages,
    tocEntries: toc.length,
    units: units.length,
    sections: sections.length,
    blocks: blocks.length,
    candidateBlocks: candidateBlocks.length,
    candidateSentences: candidateBlocks.reduce((sum, block) => sum + block.sentences.length, 0),
    targetBlocks: targetBlocks.length,
    targetSentences: targetBlocks.reduce((sum, block) => sum + block.sentences.length, 0),
    ignoredBlocks: blocks.filter((block) => !block.candidate).length
  };
}

function layoutToPageTexts(layout) {
  return (layout?.pages || []).map((page) => ({
    num: page.page,
    text: (page.lines || []).map((line) => line.text).join("\n")
  }));
}

function createLayoutTocEntry({ unitNumber, title, page }) {
  const shortTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (!unitNumber || !shortTitle || !page) return null;
  return {
    id: `pdf-toc-${nanoid(8)}`,
    unitNumber,
    unitLabel: `Unit ${unitNumber}`,
    title: `Unit ${unitNumber} ${shortTitle}`,
    shortTitle,
    page
  };
}

function extractLayoutTocEntries(layout) {
  const entries = [];
  const seen = new Set();
  const contentPages = (layout?.pages || []).filter((page) =>
    (page.lines || []).some((line) => /^contents$/i.test(normalizeLayoutHeadingText(line.text)))
  );
  const pagesToScan = contentPages.length > 0 ? contentPages : (layout?.pages || []).slice(0, 8);

  for (const page of pagesToScan) {
    const lines = page.lines || [];
    for (let index = 0; index < lines.length; index += 1) {
      const text = normalizeLayoutHeadingText(lines[index].text);
      let entry = null;

      const inlineWithPageMatch = text.match(/^unit\s+(\d+)\s+(.+?)\s+(\d{1,3})$/i);
      if (inlineWithPageMatch) {
        entry = createLayoutTocEntry({
          unitNumber: Number(inlineWithPageMatch[1]),
          title: inlineWithPageMatch[2],
          page: Number(inlineWithPageMatch[3])
        });
      } else {
        const inlineTitleMatch = text.match(/^unit\s+(\d+)\s+(.+)$/i);
        if (inlineTitleMatch) {
          const pageNumber = Number(normalizeLayoutHeadingText(lines[index + 1]?.text || ""));
          entry = createLayoutTocEntry({
            unitNumber: Number(inlineTitleMatch[1]),
            title: inlineTitleMatch[2],
            page: pageNumber
          });
        }
      }

      if (!entry) {
        const splitMatch = text.match(/^unit\s+(\d+)$/i);
        const nextText = normalizeLayoutHeadingText(lines[index + 1]?.text || "");
        const splitTitleMatch = nextText.match(/^(.+?)\s+(\d{1,3})$/);
        if (splitMatch && splitTitleMatch) {
          entry = createLayoutTocEntry({
            unitNumber: Number(splitMatch[1]),
            title: splitTitleMatch[1],
            page: Number(splitTitleMatch[2])
          });
        }
      }

      if (!entry) continue;
      const key = `${entry.unitNumber}:${normalizeImportKey(entry.shortTitle)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  return entries.sort((a, b) => a.unitNumber - b.unitNumber || a.page - b.page);
}

function flattenLayoutLines(layout) {
  return (layout?.pages || []).flatMap((page) =>
    (page.lines || []).map((line, index) => ({
      ...line,
      id: `${page.page}-${line.id || index + 1}`,
      page: page.page,
      pageWidth: page.width,
      pageHeight: page.height
    }))
  );
}

function isLayoutTextNoise(text) {
  const value = String(text || "").trim();
  if (!value) return true;
  if (isLikelyPdfPageMarker(value) || isTocEntry(value) || getImportHeading(value)) return true;
  if (getTargetActivity(value)) return true;
  if (pdfNoisePhraseMatcher.test(value)) return true;
  if (/^(?:unit|part)\s+\d+$/i.test(value)) return true;
  if (/^[A-Z]\s*$/.test(value)) return true;
  if (/[\u4e00-\u9fff]/.test(value)) return true;
  return false;
}

function isLayoutPracticeLine(text, mode) {
  const value = cleanImportedSentence(text);
  if (isLayoutTextNoise(value)) return false;
  if (pdfGuidingQuestionPattern.test(value)) return false;
  if (/^['’](?:s|t|re|ve|ll|d|m)\b/i.test(value)) return false;
  if (/\b(?:isn|aren|wasn|weren|don|doesn|didn|hasn|haven|hadn|couldn|wouldn|shouldn|mustn|won)$/i.test(value)) return false;

  const words = value.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  if (words.length > 22) return false;

  if (mode === "listen-and-chant") {
    return words.length >= 2 && value.length <= 150;
  }

  return words.length >= 1 && (/[.!?。！？]$/.test(value) || words.length <= 10);
}

function isLayoutActivityBoundary(text) {
  const value = String(text || "").trim();
  if (!value || getTargetActivity(value)) return false;
  if (/^look[!?.]/i.test(value)) return false;
  const key = normalizeImportKey(value);
  if (
    key.includes("listen and sing") ||
    key.includes("let s sing") ||
    key.includes("lets sing") ||
    key.includes("let s learn") ||
    key.includes("lets learn") ||
    key.includes("draw and say") ||
    key.includes("match and say") ||
    key.includes("share and say") ||
    key.includes("read and write") ||
    key.includes("reading time")
  ) {
    return true;
  }
  if (/^(?:look|listen|read|write|chant|sing|circle|match|choose|tick|number|role[-\s]?play|draw and say|match and say|share and say|say and draw|listen and sing|let['’]?s sing|let['’]?s learn|let['’]?s spell|read and write|reading time|self-check|project\b|big question)\b/i.test(value)) {
    return true;
  }
  return value.length < 72 && pdfNoisePhraseMatcher.test(value);
}

function isAnyLayoutActivityLine(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return Boolean(getTargetActivity(value)) || isLayoutActivityBoundary(value);
}

function getPepLayoutPartHeading(text, page, sourceLine) {
  const value = normalizeLayoutHeadingText(text);
  const match = value.match(/^([AB])\s+(.{4,})$/i);
  if (!match) return null;
  const sourceLineIndex = (page?.lines || []).indexOf(sourceLine);
  const nextActivityLine = (page?.lines || [])
    .slice(Math.max(0, sourceLineIndex + 1))
    .find((line) => line.top > sourceLine.top && isAnyLayoutActivityLine(line.text));
  const headingBottom = Math.min(sourceLine.top + 72, nextActivityLine?.top ?? Number.POSITIVE_INFINITY);
  const itemFocusQuestion = (page?.items || [])
    .filter(
      (item) =>
        item.top >= sourceLine.top - 2 &&
        item.top < headingBottom &&
        !/^[AB]$/i.test(normalizeLayoutHeadingText(item.text))
    )
    .sort((a, b) => a.top - b.top || a.x - b.x)
    .map((item) => normalizeLayoutHeadingText(item.text))
    .filter(Boolean)
    .join(" ")
    .replace(/^[AB]\s+/i, "");
  const focusQuestion = normalizeLayoutHeadingText(itemFocusQuestion || match[2]);
  if (!focusQuestion || !/[A-Za-z]/.test(focusQuestion)) return null;
  return {
    kind: "part",
    label: match[1].toUpperCase(),
    focusQuestion
  };
}

function isPepLayoutExcludedPartHeading(text) {
  return /^C\s+(?:project\b|reading\s+time\b)/i.test(normalizeLayoutHeadingText(text));
}

function normalizeRepeatedSentenceSequence(text) {
  const value = String(text || "")
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  if (parts.length < 2) return value;

  const result = [];
  const seen = new Set();
  for (const part of parts) {
    const cleaned = part.replace(/\s+/g, " ").trim();
    const key = normalizeSentenceKey(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result.length > 0 ? result.join(" ") : value;
}

function normalizeLayoutHeadingText(text) {
  let value = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return "";

  const compact = value.replace(/\s+/g, "");
  if (compact.length % 2 === 0) {
    const halfLength = compact.length / 2;
    const firstHalf = compact.slice(0, halfLength);
    const secondHalf = compact.slice(halfLength);
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      value = value.slice(0, Math.ceil(value.length / 2)).trim();
    }
  }

  return value;
}

function normalizeRepeatedOverlayText(text) {
  let value = cleanImportedSentence(text)
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return "";

  const compact = value.replace(/\s+/g, "");
  if (compact.length % 2 === 0) {
    const halfLength = compact.length / 2;
    const firstHalf = compact.slice(0, halfLength);
    const secondHalf = compact.slice(halfLength);
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      value = value.slice(0, Math.ceil(value.length / 2)).trim();
    }
  }

  return normalizeRepeatedSentenceSequence(value);
}

function getLineVerticalGap(previous, current) {
  return Math.max(0, current.top - previous.bottom);
}

function getHorizontalOverlapRatio(a, b) {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const width = Math.max(1, Math.min(a.width || 0, b.width || 0));
  return overlap / width;
}

function compareLayoutReadingOrder(a, b) {
  const rowTolerance = Math.max(3, Math.min(a.height || 0, b.height || 0) * 0.35);
  if (Math.abs(a.top - b.top) <= rowTolerance) {
    return a.x - b.x || a.top - b.top;
  }
  return a.top - b.top || a.x - b.x;
}

function canJoinDialogueBlock(block, line) {
  const previous = block.lines.at(-1);
  if (!previous) return false;
  if (/[.!?。！？]["'”’)]?$/.test(String(previous.text || "").trim()) && /^[A-Z]/.test(String(line.text || "").trim())) {
    return false;
  }
  const verticalGap = getLineVerticalGap(previous, line);
  const alignedLeft = Math.abs(previous.x - line.x) <= 42;
  const overlaps = getHorizontalOverlapRatio(previous, line) >= 0.24;
  const sameRow = Math.abs(previous.top - line.top) <= Math.max(4, Math.max(previous.height || 0, line.height || 0) * 0.45);
  const horizontalGap = line.x - previous.right;
  const touchesPrevious = horizontalGap >= -1 && horizontalGap <= Math.max(8, Math.max(previous.height || 0, line.height || 0) * 0.65);
  const close = verticalGap <= Math.max(28, Math.max(previous.height || 0, line.height || 0) * 2.2);
  return close && (alignedLeft || overlaps || (sameRow && touchesPrevious));
}

function normalizeLayoutUtterance(lines) {
  return normalizeRepeatedOverlayText(
    lines
      .sort(compareLayoutReadingOrder)
      .map((line) => line.text)
      .join(" ")
  );
}

function isPepReadingPracticeText(text) {
  const value = String(text || "").trim();
  if (!value || /[\u4e00-\u9fff]/.test(value) || isLikelyPdfPageMarker(value)) return false;
  const words = value.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  return words.length > 0 && words.length <= 28 && value.length <= 220;
}

function extractDialogueUtterancesFromLayoutLines(lines, options = {}) {
  const readingMode = options.mode === "reading";
  const blocks = [];
  const candidates = lines
    .map((line) => ({
      ...line,
      text: normalizeRepeatedOverlayText(line.text)
    }))
    .filter((line) => {
      if (readingMode ? !isPepReadingPracticeText(line.text) : isLayoutTextNoise(line.text)) return false;
      if (/^['’]$/.test(line.text)) return true;
      const words = line.text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
      return words.length > 0 && line.text.length <= 180;
    })
    .sort(compareLayoutReadingOrder);

  for (const line of candidates) {
    const target = blocks
      .filter((block) => canJoinDialogueBlock(block, line))
      .sort((a, b) => getLineVerticalGap(a.lines.at(-1), line) - getLineVerticalGap(b.lines.at(-1), line))[0];

    if (target) {
      target.lines.push(line);
      target.top = Math.min(target.top, line.top);
      target.bottom = Math.max(target.bottom, line.bottom);
      target.x = Math.min(target.x, line.x);
      target.right = Math.max(target.right, line.right);
    } else {
      blocks.push({
        top: line.top,
        bottom: line.bottom,
        x: line.x,
        right: line.right,
        lines: [line]
      });
    }
  }

  const seen = new Set();
  return blocks
    .sort((a, b) => a.top - b.top || a.x - b.x)
    .map((block) => ({
      text: normalizeLayoutUtterance(block.lines),
      page: block.lines[0]?.page || 1,
      layout: {
        page: block.lines[0]?.page || 1,
        x: Number(block.x.toFixed(2)),
        top: Number(block.top.toFixed(2)),
        right: Number(block.right.toFixed(2)),
        bottom: Number(block.bottom.toFixed(2)),
        lineIds: block.lines.map((line) => line.id)
      }
    }))
    .filter((utterance) => {
      if (readingMode ? !isPepReadingPracticeText(utterance.text) : !isLayoutPracticeLine(utterance.text, "lets-talk")) return false;
      const key = normalizeSentenceKey(utterance.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function createLayoutCandidateBlock({ text, page, activity, layout }) {
  const cleanedText = normalizeRepeatedOverlayText(text);
  return {
    id: `pdf-block-${nanoid(8)}`,
    type: /[?？]$/.test(cleanedText) ? "question" : "reading",
    text: cleanedText,
    page,
    candidate: true,
    activity: activity.label,
    targetActivity: true,
    source: "layout",
    ...(layout ? { layout } : {}),
    sentences: [cleanedText]
  };
}

function findPepLayoutUnitStarts(layout, toc) {
  const starts = [];
  const seen = new Set();

  for (const page of layout?.pages || []) {
    if ((page.lines || []).some((line) => /^contents$/i.test(normalizeLayoutHeadingText(line.text)))) {
      continue;
    }
    const normalizedLines = (page.lines || []).map((line) => normalizeImportKey(normalizeLayoutHeadingText(line.text)));
    const compactLines = normalizedLines.map((line) => line.replace(/\s+/g, ""));
    const normalizedPageText = normalizeImportKey(normalizedLines.join(" "));
    const compactPageText = normalizedPageText.replace(/\s+/g, "");

    for (const entry of toc) {
      const key = `toc-${entry.unitNumber}`;
      if (seen.has(key)) continue;

      const titleKey = normalizeImportKey(entry.shortTitle);
      const compactTitleKey = titleKey.replace(/\s+/g, "");
      const hasTitle =
        normalizedLines.some((line) => line.includes(titleKey)) ||
        normalizedPageText.includes(titleKey) ||
        compactPageText.includes(compactTitleKey);
      const hasUnitMarker = compactLines.some(
        (line) => line.includes(`unit${entry.unitNumber}`) || line.includes(`unitunit${entry.unitNumber}${entry.unitNumber}`)
      );

      if (!hasTitle || !hasUnitMarker) continue;
      seen.add(key);
      starts.push({
        key,
        page: page.page,
        title: entry.title,
        tocEntry: entry
      });
    }
  }

  if (starts.length > 0 && starts.length < toc.length) {
    const offsetCounts = new Map();
    for (const start of starts) {
      const offset = start.page - start.tocEntry.page;
      offsetCounts.set(offset, (offsetCounts.get(offset) || 0) + 1);
    }
    const inferredOffset = [...offsetCounts.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]?.[0];

    if (Number.isFinite(inferredOffset)) {
      for (const entry of toc) {
        const key = `toc-${entry.unitNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        starts.push({
          key,
          page: Math.max(1, entry.page + inferredOffset),
          title: entry.title,
          tocEntry: entry,
          inferred: true
        });
      }
    }
  }

  return starts.sort((a, b) => a.page - b.page || a.tocEntry.unitNumber - b.tocEntry.unitNumber);
}

function findPepLayoutContentEndPage(layout, unitStarts) {
  const lastUnitPage = unitStarts.at(-1)?.page || 0;
  const backMatterPage = (layout?.pages || []).find((page) => {
    if (page.page <= lastUnitPage) return false;
    return (page.lines || []).some((line) => /^(?:revision\b|appendix\b)/i.test(normalizeLayoutHeadingText(line.text)));
  });
  return backMatterPage?.page || Number.POSITIVE_INFINITY;
}

function findPepLayoutUnitForPage(pageNumber, unitStarts, toc) {
  const start = [...unitStarts].reverse().find((unit) => unit.page <= pageNumber);
  if (start) return start;

  const firstToc = toc[0];
  if (firstToc) {
    return {
      key: `toc-${firstToc.unitNumber}`,
      page: pageNumber,
      title: firstToc.title,
      tocEntry: firstToc
    };
  }

  return {
    key: `page-${pageNumber}`,
    page: pageNumber,
    title: `Chapter ${pageNumber}`,
    tocEntry: null
  };
}

function collectPepLayoutActivityLines(page, headingIndex) {
  const heading = page.lines[headingIndex];
  const collected = [];

  for (let index = headingIndex + 1; index < page.lines.length; index += 1) {
    const line = page.lines[index];
    if (line.top <= heading.top) continue;
    if (isAnyLayoutActivityLine(line.text)) break;

    const text = normalizeRepeatedOverlayText(line.text);
    if (!text) continue;
    collected.push({
      ...line,
      text,
      page: page.page,
      pageWidth: page.width,
      pageHeight: page.height
    });
  }

  return collected;
}

function collectPepLayoutActivityItems(page, headingIndex) {
  const heading = page.lines[headingIndex];
  const boundary = page.lines.slice(headingIndex + 1).find((line) => line.top > heading.top && isAnyLayoutActivityLine(line.text));
  const boundaryTop = boundary?.top ?? Number.POSITIVE_INFINITY;

  return (page.items || [])
    .filter((item) => item.top > heading.top && item.top < boundaryTop)
    .map((item) => ({
      ...item,
      text: normalizeRepeatedOverlayText(item.text),
      page: page.page,
      pageWidth: page.width,
      pageHeight: page.height
    }))
    .filter((item) => item.text);
}

function getPepVocabularyAppendixPages(layout) {
  const pages = layout?.pages || [];
  const startIndex = pages.findIndex((page) => {
    const headings = (page.lines || []).map((line) => normalizeLayoutHeadingText(line.text));
    return headings.some((text) => /^appendix\s+2$/i.test(text)) && headings.some((text) => /\bwords\s+in\s+each\s+unit\b/i.test(text));
  });
  if (startIndex < 0) return [];

  const appendixPages = [];
  for (let index = startIndex; index < pages.length; index += 1) {
    const page = pages[index];
    const isNextAppendix =
      index > startIndex &&
      (page.lines || []).some((line) => /^appendix\s+(?!2\b)\d+\b/i.test(normalizeLayoutHeadingText(line.text)));
    if (isNextAppendix) break;
    appendixPages.push(page);
  }
  return appendixPages;
}

function groupPepVocabularyRows(items) {
  const rows = [];
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);

  for (const item of sorted) {
    const currentRow = rows.at(-1);
    if (currentRow && Math.abs(currentRow.top - item.top) <= 1.2) {
      currentRow.items.push(item);
      continue;
    }
    rows.push({ top: item.top, items: [item] });
  }

  return rows.map((row) => ({
    ...row,
    items: row.items.sort((a, b) => a.x - b.x)
  }));
}

function getPepVocabularyStart(rowItems) {
  const orderedItems = [...rowItems].sort((a, b) => a.x - b.x);
  const bareStar = orderedItems.find((item) => /^\*$/.test(String(item.text || "").trim()));
  const combinedStar = orderedItems.find((item) => /^\*{1,2}[A-Za-z]/.test(String(item.text || "").trim()));
  if (!bareStar && !combinedStar) return null;

  const chineseStart = orderedItems.findIndex((item) => /[\u4e00-\u9fff]/.test(String(item.text || "")));
  const lexicalItems = orderedItems
    .slice(0, chineseStart < 0 ? orderedItems.length : chineseStart)
    .map((item) => ({
      item,
      text: String(item.text || "").trim().replace(/^\*+/, "")
    }))
    .filter(
      ({ text }) =>
        text.toLowerCase() !== "p" &&
        /^[A-Za-z]+(?:[-'’][A-Za-z]+)*(?:\s+[A-Za-z]+(?:[-'’][A-Za-z]+)*)*$/.test(text)
    );
  if (lexicalItems.length === 0) return null;

  const wordFont = lexicalItems[0].item.fontName;
  const wordParts = lexicalItems.filter(({ item }) => item.fontName === wordFont).map(({ text }) => text);
  const text = wordParts.join(" ").replace(/\s+/g, " ").trim();
  const words = text.match(/[A-Za-z]+(?:[-'’][A-Za-z]+)*/g) || [];
  if (words.length < 1 || words.length > 4 || text.length > 60) return null;

  return {
    text,
    required: Boolean(bareStar && wordFont && bareStar.fontName && wordFont !== bareStar.fontName)
  };
}

function getPepVocabularyPhonetics(rowItems) {
  return rowItems
    .map((item) => String(item.text || "").trim())
    .filter((text) => /^\/.+\/$/.test(text));
}

function getPepVocabularyTranslations(rowItems) {
  return rowItems
    .map((item) => String(item.text || "").trim().replace(/^\*+/, ""))
    .filter((text) => /[\u4e00-\u9fff]/.test(text) && !/^（?复数/.test(text));
}

function extractPepVocabulary(layout) {
  const vocabularyByUnit = new Map();
  const seenByUnit = new Map();
  let currentUnitNumber = 0;

  const addEntry = (entry) => {
    if (!entry || !currentUnitNumber) return;
    const key = normalizeImportKey(entry.text);
    if (!key || seenByUnit.get(currentUnitNumber)?.has(key)) return;
    seenByUnit.get(currentUnitNumber).add(key);
    const layoutItems = entry.layoutItems;
    vocabularyByUnit.get(currentUnitNumber).push({
      text: entry.text,
      phonetic: [...new Set(entry.phoneticParts)].join(" "),
      translation: entry.translationParts.join("").replace(/^[；;，,\s]+|[\s]+$/g, ""),
      required: entry.required,
      page: entry.page,
      layout: {
        page: entry.page,
        x: Math.min(...layoutItems.map((item) => item.x)),
        top: Math.min(...layoutItems.map((item) => item.top)),
        right: Math.max(...layoutItems.map((item) => item.right)),
        bottom: Math.max(...layoutItems.map((item) => item.bottom)),
        itemIds: layoutItems.map((item) => item.id)
      }
    });
  };

  for (const page of getPepVocabularyAppendixPages(layout)) {
    const columnSplit = page.width / 2;
    for (const column of ["left", "right"]) {
      let currentEntry = null;
      const columnItems = (page.items || []).filter((item) =>
        column === "left" ? item.x < columnSplit : item.x >= columnSplit
      );

      for (const row of groupPepVocabularyRows(columnItems)) {
        const rowText = row.items.map((item) => item.text).join(" ");
        const unitMatch = rowText.match(/\bunit\s*([1-9]\d*)\b/i);
        if (unitMatch) {
          addEntry(currentEntry);
          currentEntry = null;
          currentUnitNumber = Number(unitMatch[1]);
          if (!vocabularyByUnit.has(currentUnitNumber)) vocabularyByUnit.set(currentUnitNumber, []);
          if (!seenByUnit.has(currentUnitNumber)) seenByUnit.set(currentUnitNumber, new Set());
          continue;
        }

        if (!currentUnitNumber) continue;
        const start = getPepVocabularyStart(row.items);
        if (start) {
          addEntry(currentEntry);
          currentEntry = {
            ...start,
            page: page.page,
            phoneticParts: getPepVocabularyPhonetics(row.items),
            translationParts: getPepVocabularyTranslations(row.items),
            layoutItems: [...row.items]
          };
          continue;
        }

        if (!currentEntry) continue;
        currentEntry.phoneticParts.push(...getPepVocabularyPhonetics(row.items));
        currentEntry.translationParts.push(...getPepVocabularyTranslations(row.items));
        currentEntry.layoutItems.push(...row.items);
      }
      addEntry(currentEntry);
    }
  }

  return vocabularyByUnit;
}

function prependPepVocabularySections(units, layout) {
  const vocabularyByUnit = extractPepVocabulary(layout);

  for (const unit of units) {
    const unitNumber = Number(unit.toc?.unitNumber || unit.title.match(/\bunit\s+(\d+)\b/i)?.[1] || 0);
    const vocabulary = vocabularyByUnit.get(unitNumber) || [];
    if (vocabulary.length === 0) continue;

    const section = createPdfSection("Words", vocabulary[0].page);
    section.activityKey = "vocabulary";
    section.source = "layout";
    section.partKind = "vocabulary";
    section.partLabel = "";
    section.focusQuestion = "";

    for (const entry of vocabulary) {
      appendStructureBlock(section, {
        id: `pdf-block-${nanoid(8)}`,
        type: "vocabulary",
        text: entry.text,
        page: entry.page,
        candidate: true,
        activity: "Words",
        targetActivity: true,
        source: "layout",
        itemType: "word",
        phonetic: entry.phonetic,
        translation: entry.translation,
        required: entry.required,
        layout: entry.layout,
        sentences: [entry.text]
      });
    }

    unit.sections.unshift(section);
  }
}

function getPepReadingPanelMarkers(page) {
  return (page.lines || [])
    .map((line) => {
      const text = normalizeLayoutHeadingText(line.text);
      const match = text.match(/^([1-6])(?:\s+|$)/);
      if (!match) return null;
      return {
        number: Number(match[1]),
        x: line.x,
        top: line.top
      };
    })
    .filter(Boolean);
}

function getPepReadingPanelNumber(utterance, markers, pageWidth) {
  const eligible = markers.filter((marker) => marker.top <= utterance.layout.top + 28);
  const candidates = eligible.length > 0 ? eligible : markers;
  if (candidates.length === 0) return 0;
  const utteranceSide = utterance.layout.x < pageWidth / 2 ? "left" : "right";
  return [...candidates]
    .sort((a, b) => {
      const aSide = a.x < pageWidth / 2 ? "left" : "right";
      const bSide = b.x < pageWidth / 2 ? "left" : "right";
      const aScore = Math.abs(utterance.layout.top - a.top) + (aSide === utteranceSide ? 0 : 90);
      const bScore = Math.abs(utterance.layout.top - b.top) + (bSide === utteranceSide ? 0 : 90);
      return aScore - bScore || b.number - a.number;
    })[0].number;
}

function collapsePepReadingRepeatedWords(text) {
  const tokens = String(text || "").match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  if (tokens.length < 4) return text;
  let changed = false;
  let searching = true;

  while (searching) {
    searching = false;
    for (let start = 0; start < tokens.length; start += 1) {
      const maxLength = Math.min(8, Math.floor((tokens.length - start) / 2));
      for (let length = maxLength; length >= 2; length -= 1) {
        const first = tokens.slice(start, start + length).map((token) => token.toLowerCase());
        const second = tokens.slice(start + length, start + length * 2).map((token) => token.toLowerCase());
        if (!first.every((token, index) => token === second[index])) continue;
        tokens.splice(start + length, length);
        changed = true;
        searching = true;
        break;
      }
      if (searching) break;
    }
  }

  if (!changed) return text;
  let result = tokens.join(" ");
  if (/[,，]\s*but\b/i.test(text)) result = result.replace(/\s+but\b/i, ", but");
  const terminal = String(text || "").trim().match(/[.!?]$/)?.[0] || ".";
  return `${result}${terminal}`;
}

function removePepReadingOverlayDuplicates(utterances) {
  const cleaned = utterances.map((utterance) => ({
    ...utterance,
    text: normalizeRepeatedSentenceSequence(collapsePepReadingRepeatedWords(utterance.text))
  }));

  return cleaned.filter((utterance, index) => {
    const key = normalizeImportKey(utterance.text);
    if (!key) return false;
    return !cleaned.some((other, otherIndex) => {
      if (otherIndex === index || other.panelNumber !== utterance.panelNumber) return false;
      const otherKey = normalizeImportKey(other.text);
      return otherKey.length > key.length + 5 && otherKey.includes(key);
    });
  });
}

export function mergePepReadingParagraphs(utterances) {
  const groups = new Map();
  utterances.forEach((utterance, index) => {
    const panelNumber = Number(utterance.panelNumber || 0);
    const key = panelNumber > 0 ? `panel-${panelNumber}` : `unassigned-${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(utterance);
  });

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort(
      (a, b) => a.page - b.page || a.layout.top - b.layout.top || a.layout.x - b.layout.x
    );
    const first = ordered[0];
    const layouts = ordered.map((item) => item.layout);
    const x = Math.min(...layouts.map((layout) => layout.x));
    const top = Math.min(...layouts.map((layout) => layout.top));
    const right = Math.max(...layouts.map((layout) => layout.right ?? layout.x + layout.width));
    const bottom = Math.max(...layouts.map((layout) => layout.bottom ?? layout.top + layout.height));
    return {
      ...first,
      text: ordered.map((item) => String(item.text || "").trim()).filter(Boolean).join(" "),
      layout: {
        ...first.layout,
        x,
        top,
        right,
        bottom,
        width: right - x,
        height: bottom - top
      }
    };
  });
}

function extractPepReadingTimeUtterances(pages, headingPageNumber) {
  const utterances = [];

  for (const page of pages) {
    const heading = (page.lines || []).find((line) => /^reading\s+time/i.test(normalizeLayoutHeadingText(line.text)));
    const markers = getPepReadingPanelMarkers(page);
    const items = (page.items || [])
      .filter((item) => page.page !== headingPageNumber || !heading || item.top > heading.bottom)
      .filter((item) => item.top < page.height - 45)
      .filter((item) => !/^reading\s+time/i.test(normalizeLayoutHeadingText(item.text)))
      .filter((item) => !/^[1-6]$/.test(String(item.text || "").trim()))
      .map((item) => ({
        ...item,
        page: page.page,
        pageWidth: page.width,
        pageHeight: page.height
      }));

    for (const utterance of extractDialogueUtterancesFromLayoutLines(items, { mode: "reading" })) {
      utterances.push({
        ...utterance,
        panelNumber: getPepReadingPanelNumber(utterance, markers, page.width)
      });
    }
  }

  const cleaned = removePepReadingOverlayDuplicates(utterances).sort(
    (a, b) => a.panelNumber - b.panelNumber || a.page - b.page || a.layout.top - b.layout.top || a.layout.x - b.layout.x
  );
  return mergePepReadingParagraphs(cleaned);
}

function appendPepReadingTimeSections(units, layout, unitStarts, contentEndPage) {
  const pages = layout?.pages || [];

  units.forEach((unit, unitIndex) => {
    const unitStart = unitStarts[unitIndex];
    const unitEndPage = unitStarts[unitIndex + 1]?.page || contentEndPage;
    const unitPages = pages.filter((page) => page.page >= unitStart.page && page.page < unitEndPage);
    const headingPage = [...unitPages].reverse().find((page) =>
      (page.lines || []).some((line) => /^reading\s+time/i.test(normalizeLayoutHeadingText(line.text)))
    );
    if (!headingPage) return;

    const readingPages = unitPages.filter((page) => page.page >= headingPage.page && page.page <= headingPage.page + 1);
    const utterances = extractPepReadingTimeUtterances(readingPages, headingPage.page);
    if (utterances.length === 0) return;

    const section = createPdfSection("Reading time", headingPage.page);
    section.activityKey = "reading-time";
    section.source = "layout";
    section.partKind = "reading-time";
    section.partLabel = "";
    section.focusQuestion = "";

    for (const utterance of utterances) {
      appendStructureBlock(section, {
        id: `pdf-block-${nanoid(8)}`,
        type: "reading",
        text: utterance.text,
        page: utterance.page,
        candidate: true,
        activity: "Reading time",
        targetActivity: true,
        source: "layout",
        itemType: "reading",
        required: true,
        panelNumber: utterance.panelNumber,
        layout: utterance.layout,
        sentences: [utterance.text]
      });
    }

    unit.sections.push(section);
  });
}

function buildPdfStructureFromPepLayout({ title, layout }) {
  const pages = layoutToPageTexts(layout);
  const toc = extractLayoutTocEntries(layout);
  const unitStarts = findPepLayoutUnitStarts(layout, toc);
  const contentEndPage = findPepLayoutContentEndPage(layout, unitStarts);
  const frontMatter = [];
  const units = [];
  const unitByKey = new Map();
  const currentPartByUnitId = new Map();

  const getUnit = (pageNumber) => {
    const unitStart = findPepLayoutUnitForPage(pageNumber, unitStarts, toc);
    if (!unitByKey.has(unitStart.key)) {
      const unit = createPdfUnit(unitStart.title, unitStart.page, unitStart.tocEntry);
      unit.source = "layout";
      unit.sections = [];
      unitByKey.set(unitStart.key, unit);
      units.push(unit);
    }
    return unitByKey.get(unitStart.key);
  };

  for (const unitStart of unitStarts) {
    getUnit(unitStart.page);
  }

  for (const page of layout?.pages || []) {
    if (page.page >= contentEndPage) continue;
    if (page.page < (unitStarts[0]?.page || 1)) continue;
    const pageUnit = getUnit(page.page);
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const partHeading = getPepLayoutPartHeading(line.text, page, line);
      if (partHeading) {
        currentPartByUnitId.set(pageUnit.id, partHeading);
        continue;
      }
      if (isPepLayoutExcludedPartHeading(line.text)) {
        currentPartByUnitId.set(pageUnit.id, { kind: "excluded" });
        continue;
      }
      const activity = getTargetActivity(line.text);
      if (!activity) continue;

      const targetLines =
        activity.key === "lets-talk"
          ? collectPepLayoutActivityItems(page, index)
          : collectPepLayoutActivityLines(page, index);
      if (targetLines.length === 0) continue;

      const unit = pageUnit;
      const currentPart = currentPartByUnitId.get(unit.id);
      if (currentPart?.kind === "excluded") continue;
      const section = createPdfSection(activity.label, page.page);
      section.activityKey = activity.key;
      section.source = "layout";
      section.partKind = currentPart ? "part" : "lead-in";
      section.partLabel = currentPart?.label || "Lead-in";
      section.focusQuestion = currentPart?.focusQuestion || "";
      appendLayoutActivityBlocks(section, activity, targetLines);
      if (section.blocks.length === 0) continue;

      unit.sections.push(section);
      unit.pageEnd = Math.max(unit.pageEnd, section.pageEnd);
    }
  }

  prependPepVocabularySections(units, layout);
  appendPepReadingTimeSections(units, layout, unitStarts, contentEndPage);

  return {
    version: 2,
    title,
    toc,
    units,
    frontMatter,
    source: "layout",
    rule: "pep-textbook",
    stats: buildPdfStructureStats({ pages: layout?.pageCount || pages.length, toc, units, frontMatter })
  };
}

function appendLayoutActivityBlocks(section, activity, lines) {
  if (activity.key === "lets-talk") {
    for (const utterance of extractDialogueUtterancesFromLayoutLines(lines)) {
      appendStructureBlock(
        section,
        createLayoutCandidateBlock({
          text: utterance.text,
          page: utterance.page,
          activity,
          layout: utterance.layout
        })
      );
    }
    return;
  }

  const seen = new Set();
  for (const line of lines.sort((a, b) => a.top - b.top || a.x - b.x)) {
    const text = normalizeRepeatedOverlayText(line.text);
    if (!isLayoutPracticeLine(text, "listen-and-chant")) continue;
    const key = normalizeSentenceKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    appendStructureBlock(
      section,
      createLayoutCandidateBlock({
        text,
        page: line.page,
        activity,
        layout: {
          page: line.page,
          x: line.x,
          top: line.top,
          right: line.right,
          bottom: line.bottom,
          lineIds: [line.id]
        }
      })
    );
  }
}

function findLayoutUnitStarts(lines, toc) {
  const starts = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = getImportHeading(line.text);
    if (!heading || isTocEntry(line.text)) continue;
    const tocEntry = findTocEntryForHeading(heading, toc);
    const key = tocEntry ? `toc-${tocEntry.unitNumber}` : normalizeImportKey(heading);
    if (seen.has(key)) continue;
    seen.add(key);
    starts.push({
      index,
      line,
      heading: tocEntry?.title || heading,
      tocEntry
    });
  }

  if (starts.length > 0 || toc.length === 0) {
    return starts;
  }

  return toc
    .map((entry) => {
      const index = lines.findIndex((line) => line.page >= entry.page);
      if (index < 0) return null;
      return {
        index,
        line: lines[index],
        heading: entry.title,
        tocEntry: entry
      };
    })
    .filter(Boolean);
}

function buildLayoutUnitSections(unit, unitLines) {
  const ranges = [];
  let currentRange = null;

  for (const line of unitLines) {
    const activity = getTargetActivity(line.text);
    if (activity) {
      currentRange = {
        activity,
        page: line.page,
        lines: []
      };
      ranges.push(currentRange);

      const remainder = removeTargetActivityText(line.text);
      if (remainder) {
        currentRange.lines.push({ ...line, text: remainder });
      }
      continue;
    }

    if (!currentRange) continue;
    if (isRepeatedUnitTitle(line.text, unit) || isLayoutActivityBoundary(line.text)) {
      currentRange = null;
      continue;
    }
    currentRange.lines.push(line);
  }

  return ranges.map((range) => {
    const section = createPdfSection(range.activity.label, range.page);
    section.activityKey = range.activity.key;
    appendLayoutActivityBlocks(section, range.activity, range.lines);
    return section;
  });
}

function buildPdfStructureFromLayout({ title, layout, rule = "default" }) {
  if (rule === "pep-textbook") {
    return buildPdfStructureFromPepLayout({ title, layout });
  }

  const pages = layoutToPageTexts(layout);
  const toc = extractPdfTocEntries(pages);
  const lines = flattenLayoutLines(layout);
  const unitStarts = findLayoutUnitStarts(lines, toc);
  const frontMatter = [];
  const units = [];

  if (unitStarts.length === 0) {
    return {
      version: 2,
      title,
      toc,
      units,
      frontMatter,
      source: "layout",
      stats: buildPdfStructureStats({ pages: layout?.pageCount || pages.length, toc, units, frontMatter })
    };
  }

  const firstUnitIndex = unitStarts[0]?.index || 0;
  for (const line of lines.slice(0, firstUnitIndex)) {
    const block = classifyStructureBlock(line.text, line.page);
    if (block) frontMatter.push(block);
  }

  for (let startIndex = 0; startIndex < unitStarts.length; startIndex += 1) {
    const start = unitStarts[startIndex];
    const end = unitStarts[startIndex + 1]?.index ?? lines.length;
    const unit = createPdfUnit(start.heading, start.line.page, start.tocEntry);
    unit.source = "layout";
    unit.sections = buildLayoutUnitSections(unit, lines.slice(start.index + 1, end));
    unit.pageEnd = Math.max(unit.pageStart, ...unit.sections.map((section) => section.pageEnd));
    units.push(unit);
  }

  return {
    version: 2,
    title,
    toc,
    units,
    frontMatter,
    source: "layout",
    stats: buildPdfStructureStats({ pages: layout?.pageCount || pages.length, toc, units, frontMatter })
  };
}

function preparePdfTextForImport(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[-–—]{2,}\s*\d+\s+of\s+\d+\s*[-–—]*/gi, "\n")
    .replace(/\(picture\)/gi, "\n")
    .replace(/[◆●■]+/g, "\n")
    .replace(pdfNoisePhrasePattern, "\n")
    .replace(/\bpep\s*\.?\s*com\.?\b/gi, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function isIgnoredPdfLine(line) {
  const value = line.trim();
  if (!value || isLikelyPdfPageMarker(value)) return true;
  if (/^unit\s+\d+\s+.+\s+\d{1,3}$/i.test(value)) return true;

  const cjk = value.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const letters = value.match(/[A-Za-z]/g)?.length || 0;
  if (cjk > letters) return true;

  return false;
}

function shouldJoinPdfLine(previous, current) {
  if (!previous || !current) return false;
  if (getImportHeading(current)) return false;
  if (/^[-•*]\s+/.test(current)) return false;
  if (/^\d+[\).、]\s+/.test(current)) return false;
  if (/[.!?。！？]$/.test(previous)) return false;
  if (/[:：]$/.test(previous) && previous.length <= 24) return false;
  return true;
}

function normalizePdfLines(text) {
  const rawLines = preparePdfTextForImport(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isIgnoredPdfLine(line));

  const lines = [];
  for (const line of rawLines) {
    const previous = lines.at(-1);
    if (previous && /-\s*$/.test(previous)) {
      lines[lines.length - 1] = previous.replace(/-\s*$/, "") + line;
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function mergePdfParagraphLines(lines) {
  const paragraphs = [];
  for (const line of lines) {
    const previous = paragraphs.at(-1);
    if (previous && shouldJoinPdfLine(previous, line)) {
      paragraphs[paragraphs.length - 1] = `${previous} ${line}`;
    } else {
      paragraphs.push(line);
    }
  }
  return paragraphs;
}

function splitImportedSentences(text, options = {}) {
  const compactNormalized = text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  const hasTightSentenceJoin = /[.!?。！？](?=[A-Z])/.test(compactNormalized);
  const normalized = compactNormalized
    .replace(/([.!?。！？])(?=[A-Z])/g, "$1 ")
    .trim();
  if (options.preserveAsUtterance && !hasTightSentenceJoin) {
    const utterance = cleanImportedSentence(normalized);
    return isPracticeSentence(utterance) ? [utterance] : [];
  }

  const parts = normalized.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [];

  return parts
    .map(cleanImportedSentence)
    .filter(isPracticeSentence);
}

function cleanImportedSentence(sentence) {
  return sentence
    .replace(/[-–—]{2,}\s*\d+\s+of\s+\d+\s*[-–—]*/gi, " ")
    .replace(/[◆●■]+/g, " ")
    .replace(/\(picture\)/gi, " ")
    .replace(/\b[ABC]\s+(?=[A-Z])/g, "")
    .replace(/^\d+\s+(?=[A-Za-z])/, "")
    .replace(/\b\d+\s+(?=[A-Z])/g, "")
    .replace(/\s*(['’])\s*/g, "$1")
    .replace(/[!！]+/g, "!")
    .replace(/[?？]+/g, "?")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isPracticeSentence(sentence) {
  const value = sentence.trim();
  if (!value || !/[A-Za-z]/.test(value)) return false;
  if (value.length < 6 || value.length > 120) return false;
  if (/[\u4e00-\u9fff]/.test(value)) return false;
  if (/[◆●■]/.test(value)) return false;
  if (/\.\.\.|\.{2,}|\/|\ba\/an\b/i.test(value)) return false;
  if (hasVocabularyLeadIn(value)) return false;
  if (pdfNoiseSentencePattern.test(value)) return false;
  if (pdfGuidingQuestionPattern.test(value)) return false;

  const words = value.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  if (words.length < 2 || words.length > 16) return false;
  const hasTerminalPunctuation = /[.!?。！？]$/.test(value);
  if (!hasTerminalPunctuation && value === value.toLowerCase()) return false;
  if (!hasTerminalPunctuation && words.length > 8) return false;
  if (words.filter((word) => word.length === 1 && !/^[AI]$/i.test(word)).length >= 3) return false;

  const letters = value.match(/[A-Za-z]/g)?.length || 0;
  if (letters < Math.max(2, Math.floor(value.length * 0.35))) return false;

  if (/\b(?:a|an|the|and|or|with|in|of|for|to|can|is|are|am|have|has|do|does)\.$/i.test(value)) {
    if (!/^(?:yes|no),\s+\w+\s+can\.$/i.test(value)) return false;
  }

  return true;
}

function normalizeSentenceKey(sentence) {
  return sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function limitPdfImportChapters(normalizedChapters) {
  const limitedChapters = [];
  let sentenceCount = 0;
  let wasLimited = false;
  for (const chapter of normalizedChapters) {
    if (sentenceCount >= maxPdfImportSentences) {
      wasLimited = true;
      break;
    }
    const remaining = maxPdfImportSentences - sentenceCount;
    const nextSentences = chapter.sentences.slice(0, remaining);
    if (nextSentences.length < chapter.sentences.length) wasLimited = true;
    const nextSentenceIds = new Set(nextSentences.map((sentence) => sentence.id));
    limitedChapters.push({
      ...chapter,
      sentences: nextSentences,
      sections: Array.isArray(chapter.sections)
        ? chapter.sections
            .map((section) => ({
              ...section,
              sentences: section.sentences.filter((sentence) => nextSentenceIds.has(sentence.id))
            }))
        : undefined,
      text: nextSentences.map((sentence) => sentence.text).join(" ")
    });
    sentenceCount += nextSentences.length;
  }

  return {
    chapters: limitedChapters,
    wasLimited,
    totalDetectedSentences: normalizedChapters.reduce((sum, chapter) => sum + chapter.sentences.length, 0)
  };
}

function buildChapterTitle(chapter, index) {
  const firstLine = chapter.lines[0] || "";
  const topicMatch = firstLine.match(/^(.+?)\s+big question\b/i);
  if (topicMatch?.[1]) {
    return `${chapter.title} ${topicMatch[1].trim()}`;
  }
  return chapter.title || `Chapter ${index + 1}`;
}

function buildPdfImportChapters({ title, lines }) {
  const chapters = [];
  const hasHeading = lines.some((line) => Boolean(getImportHeading(line)));
  let currentChapter = hasHeading ? null : { title: "Chapter 1", lines: [] };
  let foundHeading = hasHeading;

  for (const line of lines) {
    const heading = getImportHeading(line);
    if (heading) {
      if (currentChapter?.title === heading) {
        continue;
      }
      if (currentChapter?.lines.length > 0) {
        chapters.push(currentChapter);
      }
      currentChapter = { title: heading, lines: [] };
      continue;
    }

    if (!currentChapter) {
      continue;
    }
    currentChapter.lines.push(line);
  }

  if (currentChapter?.lines.length > 0) {
    chapters.push(currentChapter);
  }

  const seenSentences = new Set();
  const normalizedChapters = chapters
    .map((chapter, index) => {
      const paragraphs = mergePdfParagraphLines(chapter.lines);
      const chapterText = paragraphs.join("\n");
      const sentences = splitImportedSentences(chapterText).filter((sentenceText) => {
        const key = normalizeSentenceKey(sentenceText);
        if (!key || seenSentences.has(key)) return false;
        seenSentences.add(key);
        return true;
      });
      return {
        id: `import-chapter-${index + 1}-${nanoid(6)}`,
        title: buildChapterTitle(chapter, index),
        text: chapterText,
        sentences: sentences.map((sentenceText) => ({
          id: `import-sentence-${nanoid(10)}`,
          text: sentenceText
        }))
      };
    })
    .filter((chapter) => chapter.sentences.length > 0);

  const limitedResult = limitPdfImportChapters(normalizedChapters);

  return {
    chapters: limitedResult.chapters,
    foundHeading,
    wasLimited: limitedResult.wasLimited,
    totalDetectedSentences: limitedResult.totalDetectedSentences,
    sourceMode: "fallback"
  };
}

function getPdfImportSectionType(section, block) {
  const activityKey = normalizeImportKey(block.activity || section.title);
  if (activityKey === "words" || activityKey.includes("vocabulary")) return "vocabulary";
  if (activityKey.includes("reading time")) return "reading-time";
  if (activityKey.includes("lets talk") || activityKey.includes("let s talk")) return "lets-talk";
  if (activityKey.includes("listen and chant")) return "listen-and-chant";
  return "listen-and-chant";
}

function getPdfImportSectionTitle(type) {
  if (type === "vocabulary") return "Words";
  if (type === "reading-time") return "Reading time";
  if (type === "lets-talk") return "Let's talk";
  return "Listen and chant";
}

function getPdfImportBlockSentences(block, type) {
  if (type === "vocabulary") {
    const text = String(block.text || "").replace(/\s+/g, " ").trim();
    return /^[A-Za-z]+(?:[-'’][A-Za-z]+)*(?:\s+[A-Za-z]+(?:[-'’][A-Za-z]+)*){0,3}$/.test(text) ? [text] : [];
  }
  if (type === "listen-and-chant") {
    const text = cleanImportedSentence(block.text);
    return isPracticeSentence(text) ? [text] : block.sentences || [];
  }
  return block.sentences && block.sentences.length > 0 ? block.sentences : [cleanImportedSentence(block.text)].filter(isPracticeSentence);
}

function createPdfImportSentence(block, type, text) {
  return {
    id: `import-sentence-${nanoid(10)}`,
    text,
    ...(type === "vocabulary"
      ? {
          itemType: "word",
          phonetic: String(block.phonetic || "").trim(),
          translation: String(block.translation || "").trim(),
          required: block.required !== false
        }
      : type === "reading-time"
        ? {
            itemType: "reading",
            required: true,
            panelNumber: Number(block.panelNumber || 0)
          }
        : {})
  };
}

function buildPdfImportHierarchy(sections, chapterIndex) {
  const leadInActivities = sections.filter((section) => section.partKind === "lead-in");
  const partMap = new Map();

  for (const section of sections) {
    if (section.partKind !== "part" || !section.partLabel) continue;
    if (!partMap.has(section.partLabel)) {
      partMap.set(section.partLabel, {
        id: `import-part-${chapterIndex + 1}-${section.partLabel.toLowerCase()}-${nanoid(6)}`,
        label: section.partLabel,
        focusQuestion: section.focusQuestion || "",
        activities: []
      });
    }
    partMap.get(section.partLabel).activities.push(section);
  }

  return {
    ...(leadInActivities.length > 0
      ? {
          leadIn: {
            id: `import-part-${chapterIndex + 1}-lead-in-${nanoid(6)}`,
            label: "Lead-in",
            focusQuestion: "",
            activities: leadInActivities
          }
        }
      : {}),
    parts: [...partMap.values()]
  };
}

function buildPdfImportChaptersFromStructure({ structure, sourceMode = "structure" }) {
  const preserveSourceSectionOrder = structure.source === "layout" || sourceMode === "layout-structure";
  const normalizedChapters = structure.units
    .map((unit, index) => {
      if (preserveSourceSectionOrder) {
        const sections = [];

        for (const sourceSection of unit.sections || []) {
          const sourceBlocks = (sourceSection.blocks || []).filter((block) => block.candidate);
          if (sourceBlocks.length === 0) continue;

          const firstBlock = sourceBlocks[0];
          const sectionType = sourceSection.activityKey || getPdfImportSectionType(sourceSection, firstBlock);
          const targetSection = {
            id: `import-section-${index + 1}-${sectionType}-${nanoid(6)}`,
            title: getPdfImportSectionTitle(sectionType),
            type: sectionType,
            partKind: sourceSection.partKind,
            partLabel: sourceSection.partLabel,
            focusQuestion: sourceSection.focusQuestion,
            sentences: []
          };
          const seenSectionSentences = new Set();

          for (const block of sourceBlocks) {
            for (const sentenceText of getPdfImportBlockSentences(block, sectionType)) {
              const key = `${sectionType === "reading-time" ? `${Number(block.panelNumber || 0)}:` : ""}${normalizeSentenceKey(sentenceText)}`;
              if (!key || seenSectionSentences.has(key)) continue;
              seenSectionSentences.add(key);
              targetSection.sentences.push(createPdfImportSentence(block, sectionType, sentenceText));
            }
          }

          if (targetSection.sentences.length > 0) {
            sections.push(targetSection);
          }
        }

        const sentences = sections.flatMap((section) => section.sentences);
        const hierarchy = buildPdfImportHierarchy(sections, index);
        return {
          id: `import-chapter-${index + 1}-${nanoid(6)}`,
          title: unit.title || `Chapter ${index + 1}`,
          text: sentences.map((sentence) => sentence.text).join(" "),
          ...hierarchy,
          sections,
          sentences
        };
      }

      const sectionMap = new Map();
      const getSection = (type) => {
        if (!sectionMap.has(type)) {
          sectionMap.set(type, {
            id: `import-section-${index + 1}-${type}-${nanoid(6)}`,
            title: getPdfImportSectionTitle(type),
            type,
            sentences: []
          });
        }
        return sectionMap.get(type);
      };
      getSection("listen-and-chant");
      getSection("lets-talk");
      const seenSectionSentences = new Map([
        ["listen-and-chant", new Set()],
        ["lets-talk", new Set()]
      ]);

      for (const section of unit.sections || []) {
        for (const block of section.blocks || []) {
          if (!block.candidate) continue;
          const sectionType = getPdfImportSectionType(section, block);
          const targetSection = getSection(sectionType);
          for (const sentenceText of getPdfImportBlockSentences(block, sectionType)) {
            const key = `${sectionType === "reading-time" ? `${Number(block.panelNumber || 0)}:` : ""}${normalizeSentenceKey(sentenceText)}`;
            const seen = seenSectionSentences.get(sectionType) || new Set();
            seenSectionSentences.set(sectionType, seen);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            targetSection.sentences.push(createPdfImportSentence(block, sectionType, sentenceText));
          }
        }
      }
      const sections = ["listen-and-chant", "lets-talk"].map((type) => getSection(type));
      const sentences = sections.flatMap((section) => section.sentences);

      return {
        id: `import-chapter-${index + 1}-${nanoid(6)}`,
        title: unit.title || `Chapter ${index + 1}`,
        text: sentences.map((sentence) => sentence.text).join(" "),
        sections,
        sentences
      };
    })
    .filter((chapter) => chapter.sentences.length > 0);

  const limitedResult = limitPdfImportChapters(normalizedChapters);

  return {
    chapters: limitedResult.chapters,
    foundHeading: structure.units.length > 0,
    wasLimited: limitedResult.wasLimited,
    totalDetectedSentences: limitedResult.totalDetectedSentences,
    sourceMode
  };
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    return {
      text: textResult.text || "",
      pages: Number(textResult.total || textResult.pages?.length || 0),
      pageTexts: textResult.pages || []
    };
  } finally {
    await parser.destroy();
  }
}

function sanitizeArtifactFileName(fileName = "") {
  const safeName = repairPossiblyMojibake(fileName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return safeName || "source.pdf";
}

async function savePdfImportArtifacts({ buffer, originalName, title, rule, text, lines, layout, structure, importResult, quality, warnings, householdId, totalPages }) {
  const importId = `pdf-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${nanoid(8)}`;
  const importDir = path.join(pdfImportsDir, importId);
  const extractedAt = new Date().toISOString();
  const sourceName = sanitizeArtifactFileName(originalName).toLowerCase().endsWith(".pdf")
    ? sanitizeArtifactFileName(originalName)
    : `${sanitizeArtifactFileName(originalName)}.pdf`;

  await fs.mkdir(importDir, { recursive: true });
  await fs.writeFile(path.join(importDir, sourceName), buffer);
  await fs.writeFile(
    path.join(importDir, "layout.json"),
    JSON.stringify(
      {
        importId,
        originalName: repairPossiblyMojibake(originalName),
        title,
        rule,
        extractedAt,
        householdId,
        layout
      },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(importDir, "result.json"),
    JSON.stringify(
      {
        importId,
        originalName: repairPossiblyMojibake(originalName),
        title,
        rule,
        extractedAt,
        householdId,
        text,
        lines,
        warnings,
        quality: quality || null,
        structure,
        chapters: importResult?.chapters || [],
        stats: {
          pages: layout?.stats?.pages || 0,
          layoutItems: layout?.stats?.items || 0,
          layoutLines: layout?.stats?.lines || 0,
          detectedSentences: importResult?.totalDetectedSentences || 0
        }
      },
      null,
      2
    )
  );

  let pageAssets = [];
  try {
    pageAssets = await renderPdfPageAssets(buffer, {
      importDir,
      importId,
      totalPages: Number(totalPages || layout?.stats?.pages || quality?.ocr?.totalPages || 0)
    });
  } catch (error) {
    warnings?.push(`PDF 页面图片保存未完成：${error instanceof Error ? error.message : String(error || "unknown")}`);
  }
  const snapshot = buildPdfImportSnapshot({
    importId,
    householdId,
    title,
    rule,
    layout,
    structure,
    chapters: importResult?.chapters || [],
    quality,
    pageAssets,
    extractedAt
  });
  await fs.writeFile(path.join(importDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));

  return {
    importId,
    importDir,
    snapshot
  };
}

function buildLessonChapters({ lessonId, title, text, chapters, minScore }) {
  const normalizeLessonItem = (sentence) => ({
    id: sentence.id,
    text: String(sentence.text || "").trim(),
    itemType: ["word", "reading"].includes(String(sentence.itemType || "")) ? String(sentence.itemType) : "sentence",
    phonetic: String(sentence.phonetic || "").trim(),
    translation: String(sentence.translation || "").trim(),
    required: sentence.required !== false,
    panelNumber: Number(sentence.panelNumber || 0)
  });
  const normalizedChapters =
    chapters.length > 0
      ? chapters
          .map((chapter, index) => {
            const chapterTitle = String(chapter.title || `Chapter ${index + 1}`).trim();
            const chapterText = String(chapter.text || "").trim();
            const nestedSections = [
              ...(Array.isArray(chapter.leadIn?.activities)
                ? chapter.leadIn.activities.map((activity) => ({
                    ...activity,
                    partKind: "lead-in",
                    partLabel: chapter.leadIn.label || "Lead-in",
                    focusQuestion: ""
                  }))
                : []),
              ...(Array.isArray(chapter.parts)
                ? chapter.parts.flatMap((part) =>
                    Array.isArray(part.activities)
                      ? part.activities.map((activity) => ({
                          ...activity,
                          partKind: "part",
                          partLabel: part.label,
                          focusQuestion: part.focusQuestion || ""
                        }))
                      : []
                  )
                : [])
            ];
            const sectionSource = nestedSections.length > 0 ? nestedSections : Array.isArray(chapter.sections) ? chapter.sections : [];
            const explicitSections = sectionSource.length > 0
              ? sectionSource
                  .map((section, sectionIndex) => {
                    const sectionTitle = String(section.title || `Section ${sectionIndex + 1}`).trim();
                    const sectionSentences = Array.isArray(section.sentences)
                      ? section.sentences
                          .map(normalizeLessonItem)
                          .filter((sentence) => sentence.text)
                      : [];
                    return {
                      id: section.id,
                      title: sectionTitle || `Section ${sectionIndex + 1}`,
                      type: String(section.type || "custom").trim(),
                      partKind: String(section.partKind || "").trim(),
                      partLabel: String(section.partLabel || "").trim(),
                      focusQuestion: String(section.focusQuestion || "").trim(),
                      sentenceTexts: sectionSentences
                    };
                  })
                  .filter((section) => section.sentenceTexts.length > 0)
              : [];
            const explicitSentences = Array.isArray(chapter.sentences)
              ? chapter.sentences
                  .map(normalizeLessonItem)
                  .filter((sentence) => sentence.text)
              : [];
            const sentenceTexts =
              explicitSections.length > 0
                ? explicitSections.flatMap((section) => section.sentenceTexts)
                : explicitSentences.length > 0
                ? explicitSentences
                : splitReadingText(chapterText).map((sentenceText) => ({ text: sentenceText }));
            return {
              id: chapter.id,
              title: chapterTitle || `Chapter ${index + 1}`,
              body: chapterText || sentenceTexts.map((sentence) => sentence.text).join(" "),
              sections: explicitSections,
              sentenceTexts
            };
          })
          .filter((chapter) => chapter.sentenceTexts.length > 0)
      : [
          {
            title,
            body: text,
            sentenceTexts: splitReadingText(text).map((sentenceText) => ({ text: sentenceText }))
          }
        ];

  return {
    body: normalizedChapters.map((chapter) => chapter.body).join("\n\n"),
    totalSentences: normalizedChapters.reduce((sum, chapter) => sum + chapter.sentenceTexts.length, 0),
    chapters: normalizedChapters.map((chapter, index) => {
      const sentences = chapter.sentenceTexts.map((sentence) => ({
        id: sentence.id || `sentence-${nanoid(10)}`,
        text: sentence.text,
        minScore,
        itemType: sentence.itemType || "sentence",
        phonetic: sentence.phonetic || "",
        translation: sentence.translation || "",
        required: sentence.required !== false,
        panelNumber: Number(sentence.panelNumber || 0)
      }));
      const sentenceByTextQueue = new Map();
      for (const sentence of sentences) {
        const key = normalizeSentenceKey(sentence.text);
        if (!sentenceByTextQueue.has(key)) sentenceByTextQueue.set(key, []);
        sentenceByTextQueue.get(key).push(sentence);
      }

      const sections = (chapter.sections || []).map((section, sectionIndex) => ({
        id: section.id || `${lessonId}-chapter-${index + 1}-section-${sectionIndex + 1}`,
        title: section.title,
        type: section.type,
        partKind: section.partKind,
        partLabel: section.partLabel,
        focusQuestion: section.focusQuestion,
        sentences: section.sentenceTexts
          .map((sentence) => {
            const key = normalizeSentenceKey(sentence.text);
            return sentenceByTextQueue.get(key)?.shift();
          })
          .filter(Boolean)
      }));
      const hierarchy = buildPdfImportHierarchy(sections, index);

      return {
        id: chapter.id || `${lessonId}-chapter-${index + 1}`,
        title: chapter.title,
        body: chapter.body,
        ...hierarchy,
        sections,
        sentences
      };
    })
  };
}

function makeMockAssessment(referenceText, durationMs) {
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

async function assessReading({ provider = speechProvider, referenceText, durationMs, audio }) {
  if (provider === "mock") {
    return makeMockAssessment(referenceText, durationMs);
  }

  if (provider === "tencent") {
    return assessWithTencent({ referenceText, audio });
  }

  if (provider === "azure") {
    return assessWithAzure({ referenceText, audio });
  }

  if (provider === "xfyun") {
    return assessWithXfyun({ referenceText, audio });
  }

  throw new Error(`Unsupported SPEECH_PROVIDER: ${provider}`);
}

async function synthesizeSentence({ provider = ttsProvider, sentence, voice }) {
  if (provider === "tencent") {
    return synthesizeWithTencent({ text: sentence.text, sentenceId: sentence.id, voice });
  }

  if (provider === "openai") {
    return synthesizeWithOpenAI({ text: sentence.text, sentenceId: sentence.id, voice });
  }

  throw new Error(`Unsupported TTS_PROVIDER: ${provider}`);
}

function getTtsCacheFormat(provider = ttsProvider) {
  if (provider === "tencent") {
    const codec = process.env.TENCENT_TTS_CODEC || "mp3";
    return {
      extension: codec === "wav" ? "wav" : "mp3",
      contentType: codec === "wav" ? "audio/wav" : "audio/mpeg"
    };
  }

  return { extension: "mp3", contentType: "audio/mpeg" };
}

function normalizeTtsSubtitles(subtitles = []) {
  if (!Array.isArray(subtitles)) return [];

  return subtitles
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

async function ensureTtsCache({ sentence, voice }) {
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
    speechEnhancement,
    speechProviderComparison,
    supportedSpeechProviders,
    supportedTtsProviders
  });
});

app.get("/api/lessons", async (_req, res, next) => {
  try {
    const lessons = listLessons({ householdId: _req.parentSession.householdId });
    if (_req.parentSession.kind !== "child") {
      res.json(lessons);
      return;
    }
    const child = listChildren(_req.parentSession.householdId).find((item) => item.id === _req.parentSession.childId);
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
    const children = listChildren(_req.parentSession.householdId);
    res.json(_req.parentSession.kind === "child" ? children.filter((child) => child.id === _req.parentSession.childId) : children);
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
    res.json(listAutomaticPracticeSessions(childId, req.query.limit, req.parentSession.householdId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/child-pairing-codes", (req, res, next) => {
  try {
    const childId = String(req.body.childId || "").trim();
    if (!childId) return res.status(400).json({ error: "childId is required" });
    res.status(201).json(createChildPairingCode({ householdId: req.parentSession.householdId, childId, createdByUserId: req.parentSession.id }));
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
    const direction = req.body.direction ? String(req.body.direction) : "";

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
    const pageNumbers = collectReferencedPageNumbers(artifact.result?.structure, pageAssets.length || Number(artifact.result?.stats?.pages || 0));
    const assetFiles = [];
    const assetDescriptors = [];
    for (const pageNumber of pageNumbers) {
      const sourceAsset = pageAssets.find((asset) => Number(asset.pageNumber) === pageNumber);
      if (!sourceAsset || !/^page-\d{3}\.png$/.test(String(sourceAsset.fileName || ""))) continue;
      const buffer = await fs.readFile(path.join(artifact.importDir, "pages", sourceAsset.fileName));
      const descriptor = {
        id: sourceAsset.id,
        pageNumber,
        fileName: sourceAsset.fileName,
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
      tags: Array.isArray(req.body.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20) : [],
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
    const filteredSnapshot = filterSnapshotForCourseSync(artifact.snapshot, pageNumbers, normalized.chapters);
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
    const responseBody = await response.json().catch(() => ({}));
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
  } catch (error) {
    if (error?.name === "TimeoutError") {
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
    const metadata = draft.manifest.metadata;
    const content = draft.manifest.content;
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
      createdByUserId: req.parentSession.id
    });
    markCourseSyncDraftPublished({ id: draft.id, resourceId: resource.id, version: resource.version });
    res.status(201).json({ ...resource, content: undefined });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE constraint failed: official_course_resources.slug")) {
      res.status(409).json({ error: "OFFICIAL_COURSE_SLUG_TAKEN" });
      return;
    }
    next(error);
  }
});

app.get("/api/platform-admin/logs", (req, res) => {
  res.json(listPlatformAdminAuditLogs({ limit: req.query.limit }));
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
    createdByUserId: req.parentSession.id
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

async function readPdfImportArtifact(importId, householdId = "") {
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
    const result = JSON.parse(resultJson);
    const snapshot = JSON.parse(snapshotJson);
    const ownerHouseholdId = snapshot?.householdId || result?.householdId || "";
    if (householdId && ownerHouseholdId !== householdId) return null;
    return { result, layout: JSON.parse(layoutJson)?.layout || null, snapshot, importDir };
  } catch {
    return null;
  }
}

async function updatePdfImportFinalArtifact(importId, householdId, chapters) {
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

function serializeCourseSyncDraftSummary(draft) {
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
        ? content.chapters.reduce((sum, chapter) => sum + (chapter.sentences?.length || 0), 0)
        : 0,
      images: draft.assets.length
    },
    receivedAt: draft.receivedAt,
    publishedAt: draft.publishedAt,
    publishedResourceId: draft.publishedResourceId,
    publishedVersion: draft.publishedVersion
  };
}

function courseSyncBearerToken(req) {
  const authorization = String(req.get("authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function courseSyncClientAddress(req) {
  const remoteAddress = String(req.socket?.remoteAddress || "unknown");
  const loopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (!loopback) return remoteAddress;
  return String(req.get("x-forwarded-for") || "").split(",")[0].trim() || remoteAddress;
}

function writeCourseSyncInboundAudit(req, { status, summary, metadata = {} }) {
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

function rejectCourseSyncPreflight(req, res, statusCode, error) {
  const auditKey = `${courseSyncClientAddress(req)}:${error}`;
  const now = Date.now();
  const lastAuditAt = courseSyncFailureAuditTimes.get(auditKey) || 0;
  if (req.courseSyncAuth || now - lastAuditAt >= 60 * 1000) {
    courseSyncFailureAuditTimes.set(auditKey, now);
    writeCourseSyncInboundAudit(req, { status: "failure", summary: `课程同步接收被拒绝：${error}`, metadata: { statusCode } });
  }
  res.status(statusCode).json({ error });
}

function checkCourseSyncRateLimit(req, res, next) {
  const key = courseSyncClientAddress(req);
  const now = Date.now();
  if (courseSyncAttempts.size > 2048) {
    for (const [address, timestamps] of courseSyncAttempts) {
      const active = timestamps.filter((timestamp) => now - timestamp < courseSyncRateWindowMs);
      if (active.length === 0) courseSyncAttempts.delete(address);
      else courseSyncAttempts.set(address, active);
    }
    while (courseSyncAttempts.size > 4096) courseSyncAttempts.delete(courseSyncAttempts.keys().next().value);
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

function checkCourseSyncRequestSize(req, res, next) {
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

function authenticateCourseSyncRequest(req, res, next) {
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

function limitCourseSyncConcurrency(req, res, next) {
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

function rewriteCourseSyncSnapshotUrls(snapshot, draftId, assets) {
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
    const manifest = JSON.parse(manifestRaw);
    const validated = validateCourseSyncManifest(manifest);
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
    const storedAssets = [];
    for (const asset of validated.assets) {
      const file = fileByName.get(asset.fileName);
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
    res.status(201).json(serializeCourseSyncDraftSummary(draft));
  } catch (error) {
    const code = String(error?.message || "");
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

function serializePdfImportPreview(artifact) {
  const result = artifact.result || {};
  const snapshot = artifact.snapshot || undefined;
  if (snapshot?.layers?.local?.pages && artifact.layout?.pages) {
    snapshot.layers.local.pages = snapshot.layers.local.pages.map((localPage) => {
      const layoutPage = artifact.layout.pages.find((page) => Number(page.page) === Number(localPage.pageNumber));
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
      sentences: Array.isArray(result.chapters) ? result.chapters.reduce((sum, chapter) => sum + (chapter.sentences?.length || 0), 0) : 0,
      detectedSentences: Number(result.stats?.detectedSentences || 0)
    },
    chapters: result.chapters || [],
    importSnapshot: snapshot
  };
}

function collectLessonSentenceIds(chapters = []) {
  return new Set(
    chapters.flatMap((chapter) =>
      (chapter.sentences || []).map((sentence) => String(sentence.id || "")).filter(Boolean)
    )
  );
}

async function findPdfImportArtifactForLesson(lesson, householdId) {
  if (!lesson || lesson.sourceType !== "pdf") return null;
  if (lesson.importId) {
    const linkedArtifact = await readPdfImportArtifact(lesson.importId, householdId);
    if (linkedArtifact) return linkedArtifact;
  }

  const lessonSentenceIds = collectLessonSentenceIds(lesson.chapters || []);
  const normalizedTitle = String(lesson.title || "").trim().toLocaleLowerCase();
  const entries = await fs.readdir(pdfImportsDir, { withFileTypes: true }).catch(() => []);
  const importIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  let bestMatch = null;

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
      createdByUserId: req.parentSession.id
    });
    if (importId) await updatePdfImportFinalArtifact(importId, req.parentSession.householdId, lesson.chapters || []);
    res.status(existingId ? 200 : 201).json({ ...resource, content: undefined });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE constraint failed: official_course_resources.slug")) {
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
    const warnings = [];
    const layoutLineCount = layout?.stats?.lines || 0;

    const textStructure = buildPdfStructure({ title, pages: pageTexts });
    const layoutStructure = layout ? buildPdfStructureFromLayout({ title, layout, rule: importRule }) : null;
    const missingPepLayoutUnits =
      importRule === "pep-textbook" && layoutStructure?.toc?.length > 0
        ? layoutStructure.toc.filter((entry) => {
            const unit = layoutStructure.units.find((candidate) => candidate.toc?.unitNumber === entry.unitNumber);
            return !unit || !unit.sections.some((section) => section.blocks.some((block) => block.candidate));
          })
        : [];
    const shouldUseLayoutStructure = Boolean(
      layoutStructure && layoutStructure.stats.targetSentences > 0 && missingPepLayoutUnits.length === 0
    );
    if (layoutStructure?.stats.targetSentences > 0 && missingPepLayoutUnits.length > 0) {
      warnings.push(`PDF 坐标布局未完整识别 Unit ${missingPepLayoutUnits.map((entry) => entry.unitNumber).join("、")}，已停止使用不完整布局结果。`);
    }
    const structure = shouldUseLayoutStructure ? layoutStructure : textStructure;
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
    if (ocr.visualReview?.status === "unavailable") {
      warnings.push(`日日新视觉复核未完成：${ocr.visualReview.message || "服务不可用"}${ocr.visualReview.detail ? ` 技术详情：${ocr.visualReview.detail}` : ""}`);
    } else if (ocr.visualReview?.pagesProcessed > 0) {
      warnings.push(`日日新已复核 ${ocr.visualReview.pagesProcessed} 个冲突页面，结论仅用于辅助确认，不会自行改写教材。`);
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
        totalPages: pages
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
      totalPages: pages
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

async function handleAttempt(req, res, next, provider = speechProvider) {
  try {
    const { childId, sentenceId, referenceText, durationMs, minScore, storybookId, storybookPageId } = req.body;
    if (!childId || !sentenceId || !referenceText) {
      res.status(400).json({ error: "childId, sentenceId and referenceText are required" });
      return;
    }
    const isFilingReviewAttempt = req.parentSession.kind === "review";
    if (!hasChildAccess(req, String(childId)) || (isFilingReviewAttempt && String(childId) !== req.parentSession.childId)) {
      res.status(403).json({ error: "CHILD_ACCESS_DENIED" });
      return;
    }
    const householdId = req.parentSession.householdId;
    const isStorybookAttempt = Boolean(storybookId || storybookPageId);
    let sentence;
    if (isFilingReviewAttempt) {
      sentence = findFilingReviewSentence(sentenceId);
      if (!sentence || sentence.text.trim() !== String(referenceText).trim()) {
        res.status(400).json({ error: "REVIEW_CONTENT_RESTRICTED" });
        return;
      }
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
      sentence = { id: String(sentenceId), text: String(referenceText), minScore: Number(minScore || 75) };
    } else {
      sentence = await findSentence(sentenceId, householdId);
      if (!sentence) {
        res.status(404).json({ error: "Sentence not found" });
        return;
      }
      if (sentence.text.trim() !== String(referenceText).trim()) {
        res.status(400).json({ error: "Reference text does not match the selected sentence" });
        return;
      }
    }
    const assessmentMinScore = Number(sentence.minScore || minScore || 75);

    const candidateInputs = buildAttemptCandidateInputs(req, durationMs, referenceText);
    const evaluatedCandidates = [];
    let lastAssessmentError = null;

    for (const candidate of candidateInputs) {
      try {
        const enhancement = await enhanceCandidateAudio(candidate);
        const assessmentStartedAt = performance.now();
        const providerResult = await assessReading({
          provider,
          referenceText,
          durationMs: candidate.durationMs,
          audio: enhancement.audio
        });
        const result = applyScorePolicy(providerResult);
        const gate = evaluatePass(result, assessmentMinScore);
        evaluatedCandidates.push({
          ...candidate,
          rawAudio: candidate.audio,
          audio: enhancement.audio,
          speechEnhancement: enhancement.metadata,
          assessmentDurationMs: Math.round(performance.now() - assessmentStartedAt),
          result,
          gate
        });
        if (gate.passed) break;
      } catch (error) {
        lastAssessmentError = error;
        console.warn(`[speech] candidate=${candidate.id} status=failed message="${error.message || error}"`);
      }
    }

    if (evaluatedCandidates.length === 0) {
      throw lastAssessmentError || new Error("No recording candidate could be assessed");
    }

    const selectedCandidate = selectAttemptCandidate(evaluatedCandidates);
    const result = selectedCandidate.result;
    const gate = selectedCandidate.gate;
    const recordingQuality = selectedCandidate.quality || parseRecordingQuality(req.body.recordingQuality);
    const rawComparison = isFilingReviewAttempt ? undefined : await assessRawComparison({
      provider,
      referenceText,
      minScore: assessmentMinScore,
      candidate: selectedCandidate
    });
    const noiseGate = evaluateNoiseGate({
      enhancement: selectedCandidate.speechEnhancement,
      enhancedResult: result,
      rawResult: rawComparison?.result
    });
    const attempt = {
      id: nanoid(),
      sentenceId,
      childId: childId ? String(childId) : undefined,
      householdId,
      referenceText,
      createdAt: new Date().toISOString(),
      speechProvider: provider,
      audioBytes: selectedCandidate.audio.length,
      recordingQuality,
      candidateSelection: {
        strategy: candidateInputs.length > 1 ? "latest-complete-contiguous" : "full-session",
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
      result,
      ...(isStorybookAttempt ? { storybookId: String(storybookId), storybookPageId: String(storybookPageId) } : {}),
      ...gate
    };

    const rejectedReason = getAssessmentRejection({ referenceText, result, gate, recordingQuality });
    const responseCode = rejectedReason ? "NO_SPEECH_DETECTED" : noiseGate.rejected ? "RECORDING_TOO_NOISY" : null;
    if (responseCode) {
      attempt.rejectedReason = rejectedReason || noiseGate.reason;
      if (!isFilingReviewAttempt) {
        await saveAttemptDiagnostics(
          attempt,
          selectedCandidate.audio,
          candidateInputs.find((candidate) => candidate.kind === "full-session")?.audio,
          selectedCandidate.rawAudio
        );
      }
      res.status(422).json({
        code: responseCode,
        error: responseCode === "RECORDING_TOO_NOISY" ? "The recording is too noisy to score reliably" : "No valid reading was detected"
      });
      return;
    }

    attempt.speechProviderComparison = isFilingReviewAttempt ? undefined : await assessSpeechProviderComparison({
      primaryProvider: provider,
      primaryResult: result,
      primaryGate: gate,
      primaryDurationMs: selectedCandidate.assessmentDurationMs,
      referenceText,
      durationMs: selectedCandidate.durationMs,
      audio: selectedCandidate.audio,
      minScore: assessmentMinScore,
      assess: assessReading
    });

    if (isFilingReviewAttempt) {
      attempt.reviewOnly = true;
      attempt.audioAvailable = false;
      attempt.rawAudioAvailable = false;
    } else {
      Object.assign(attempt, await saveAttemptRecording(attempt, selectedCandidate.audio, selectedCandidate.rawAudio));
      if (isStorybookAttempt) insertStorybookAttempt(attempt);
      else insertAttempt(attempt);
      await saveAttemptDiagnostics(
        attempt,
        selectedCandidate.audio,
        candidateInputs.find((candidate) => candidate.kind === "full-session")?.audio,
        selectedCandidate.rawAudio
      );
    }
    res.json(attempt);
  } catch (error) {
    next(error);
  }
}

async function enhanceCandidateAudio(candidate) {
  try {
    return await enhanceSpeech(candidate.audio);
  } catch (error) {
    console.warn(`[speech-enhancement] candidate=${candidate.id} status=fallback message="${error.message || error}"`);
    return {
      audio: candidate.audio,
      metadata: { provider: getSpeechEnhancementStatus().provider, applied: false, error: error.message || String(error) }
    };
  }
}

async function assessRawComparison({ provider, referenceText, minScore, candidate }) {
  if (!getSpeechEnhancementStatus().abComparison || !candidate.speechEnhancement?.applied || !candidate.rawAudio?.length) {
    return undefined;
  }
  try {
    const providerResult = await assessReading({
      provider,
      referenceText,
      durationMs: candidate.durationMs,
      audio: candidate.rawAudio
    });
    const result = applyScorePolicy(providerResult);
    const gate = evaluatePass(result, Number(minScore || 75));
    return {
      ...summarizeAssessment(result, gate),
      result
    };
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

function summarizeAssessment(result, gate) {
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

function buildAttemptCandidateInputs(req, fallbackDurationMs, referenceText) {
  const files = req.files && typeof req.files === "object" ? req.files : {};
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
  const candidates = segmentFiles.map((file, index) => ({
    id: String(segmentMetadata[index]?.id || `segment-${index + 1}`),
    kind: "speech-segment",
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

function parseRecordingQuality(value) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseCandidateMetadata(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((candidate) => candidate && typeof candidate === "object").slice(0, 3) : [];
  } catch {
    return [];
  }
}

async function saveAttemptDiagnostics(attempt, audio, fullSessionAudio, rawAudio) {
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
            candidateSelection: attempt.candidateSelection,
            speechEnhancement: attempt.speechEnhancement,
            speechProviderComparison: attempt.speechProviderComparison,
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

async function saveAttemptRecording(attempt, audio, rawAudio) {
  if (!audio?.length) return { audioAvailable: false, rawAudioAvailable: false };

  try {
    await fs.mkdir(attemptAudioDir, { recursive: true });
    const writes = [fs.writeFile(getAttemptAudioPath(attempt.id), audio)];
    const rawAudioAvailable = Boolean(rawAudio?.length && attempt.speechEnhancement?.applied);
    if (rawAudioAvailable) writes.push(fs.writeFile(getAttemptAudioPath(attempt.id, "raw"), rawAudio));
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
    let textResult;
    let screenshots;
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
    const pages = [];
    for (const screenshot of screenshots.pages || []) {
      const pageNumber = Number(screenshot.pageNumber || pages.length + 1);
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
    const preview = {
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
    const preview = JSON.parse(await fs.readFile(path.join(previewDir, "manifest.json"), "utf8"));
    const title = String(req.body.title || preview.title || "Imported picture book").trim().slice(0, 160);
    const storybookId = `imported-${req.params.previewId}`;
    const slug = `${slugifyStorybookTitle(title) || "picture-book"}-${req.params.previewId.slice(0, 6).toLowerCase()}`;
    const requestedPages = Array.isArray(req.body.pages) ? req.body.pages : [];
    const requestedPageMap = new Map(requestedPages.map((page) => [Number(page?.pageNumber), page]));
    const pages = preview.pages.map((page, pageIndex) => {
      const requested = requestedPageMap.get(Number(page.pageNumber));
      const practiceEnabled = requested
        ? requested.practiceEnabled === true
        : page.practiceEnabled !== false && Array.isArray(page.sentences) && page.sentences.length > 0;
      const requestedSentences = requested && Array.isArray(requested.sentences) ? requested.sentences : page.sentences;
      const sentences = practiceEnabled
        ? requestedSentences.map((text) => String(text || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20)
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

function serializeStoredStorybook(book) {
  const pages = (book.pages || []).map((page, index) => ({
    ...page,
    imageUrl: `/api/storybooks/${encodeURIComponent(book.id)}/pages/${index + 1}/image`
  }));
  return { ...book, pages, coverImageUrl: pages[0]?.imageUrl || "" };
}

function slugifyStorybookTitle(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function splitStorybookSentences(text) {
  if (!text) return [];
  return (text.match(/[^.!?]+[.!?]+(?:[”\"])?|[^.!?]+$/g) || [])
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => /[A-Za-z]/.test(sentence) && sentence.length >= 2)
    .slice(0, 20);
}

function decodeMultipartFileName(value) {
  const source = String(value || "");
  if (!/[\u0080-\u00ff]/.test(source)) return source;
  const decoded = Buffer.from(source, "latin1").toString("utf8");
  return decoded && !decoded.includes("�") ? decoded : source;
}

function getStorybookPageReviewReason(text, pageNumber) {
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

function shouldRedirectSecondaryHostToLogin(req) {
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

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Internal server error" });
});

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  app.listen(port, host, () => {
    console.log(`Kid English Reading API listening on http://${host}:${port}`);
  });
}

export {
  app,
  buildProgress,
  buildPdfImportChaptersFromStructure,
  buildPdfStructureFromLayout
};
