import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PdfImportChapter } from "./types/pdf.js";

type UnknownRecord = Record<string, unknown>;

export interface CourseSyncSignatureInput {
  key: string | Buffer;
  keyId: string;
  timestamp: string | number;
  nonce: string;
  packageHash: string;
  method?: string;
  pathname?: string;
}

export interface CourseSyncSignatureVerificationInput extends CourseSyncSignatureInput {
  signature: string;
}

interface CourseSyncBlock extends UnknownRecord {
  page?: unknown;
  layout?: { page?: unknown; [key: string]: unknown } | null;
}

interface CourseSyncSection extends UnknownRecord {
  pageStart?: unknown;
  pageEnd?: unknown;
  blocks?: CourseSyncBlock[];
}

interface CourseSyncStructure {
  units?: Array<{ sections?: CourseSyncSection[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface CourseSyncPageAsset extends UnknownRecord {
  pageNumber: unknown;
}

export interface CourseSyncSnapshot extends UnknownRecord {
  householdId?: unknown;
  pageAssets?: CourseSyncPageAsset[];
  layers: {
    local: UnknownRecord & { pages?: Array<UnknownRecord & { pageNumber: unknown }> };
    upstream: UnknownRecord & {
      providers?: Array<UnknownRecord & { pages?: Array<UnknownRecord & { pageNumber: unknown }> }>;
      visualReview?: (UnknownRecord & { pages?: Array<UnknownRecord & { page: unknown }> }) | null;
    };
    differences: UnknownRecord & { items?: Array<UnknownRecord & { pageNumber: unknown; status?: unknown }> };
    final: UnknownRecord;
    [key: string]: unknown;
  };
}

export interface ValidatedCourseSyncAsset extends UnknownRecord {
  fileName?: unknown;
  pageNumber?: unknown;
  bytes?: unknown;
  sha256?: unknown;
  mimeType?: unknown;
}

export interface NormalizedCourseSyncAsset extends UnknownRecord {
  fileName: string;
  pageNumber: number;
  bytes: number;
  sha256: string;
  mimeType: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const packageIdPattern = /^course-package-[a-f0-9]{24}$/;
const importIdPattern = /^pdf-\d{14}-[A-Za-z0-9_-]{8}$/;
const pageFilePattern = /^page-\d{3}\.png$/;
const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/;
const noncePattern = /^[A-Za-z0-9_-]{16,80}$/;
const signaturePattern = /^[a-f0-9]{64}$/;
export const courseSyncReplayWindowSeconds = 5 * 60;

function parseCourseSyncKeys(env: NodeJS.ProcessEnv) {
  const keys = new Map<string, string>();
  const preferredKeyId = keyIdPattern.test(String(env.COURSE_SYNC_KEY_ID || "").trim())
    ? String(env.COURSE_SYNC_KEY_ID).trim()
    : "primary";
  const legacyKey = String(env.COURSE_SYNC_KEY || "").trim();
  if (legacyKey.length >= 24) keys.set(preferredKeyId, legacyKey);
  for (const entry of String(env.COURSE_SYNC_KEYS || "").split(",")) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0) continue;
    const keyId = entry.slice(0, separatorIndex).trim();
    const key = entry.slice(separatorIndex + 1).trim();
    if (keyIdPattern.test(keyId) && key.length >= 24 && !keys.has(keyId)) keys.set(keyId, key);
  }
  const senderKeyId = keys.has(preferredKeyId) ? preferredKeyId : keys.keys().next().value || "";
  return {
    keys,
    sender: senderKeyId ? { id: senderKeyId, key: keys.get(senderKeyId) || "" } : null
  };
}

function normalizedTargetUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function getCourseSyncConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const target = normalizedTargetUrl(env.COURSE_SYNC_TARGET_URL);
  const parsedKeys = parseCourseSyncKeys(env);
  const keyReady = parsedKeys.keys.size > 0;
  const legacyBearerAllowed = ["1", "true", "yes"].includes(String(env.COURSE_SYNC_ALLOW_LEGACY_BEARER || "").trim().toLowerCase());
  return {
    target,
    key: parsedKeys.sender?.key || "",
    keyId: parsedKeys.sender?.id || "",
    keys: parsedKeys.keys,
    legacyBearerAllowed,
    targetEnabled: Boolean(target && parsedKeys.sender),
    inboundEnabled: keyReady,
    publicStatus: {
      targetEnabled: Boolean(target && parsedKeys.sender),
      inboundEnabled: keyReady,
      targetUrl: target ? `${target.protocol}//${target.host}${target.pathname}` : "",
      secure: Boolean(target?.protocol === "https:"),
      signatureRequired: !legacyBearerAllowed,
      legacyBearerAllowed,
      activeKeyId: parsedKeys.sender?.id || "",
      acceptedKeyIds: [...parsedKeys.keys.keys()],
      replayWindowSeconds: courseSyncReplayWindowSeconds,
      maxUploadBytes: 128 * 1024 * 1024,
      message: !keyReady
        ? "尚未配置课程同步密钥"
        : target
          ? "HMAC 签名通道已就绪，可以将本机审核结果同步为服务器草稿"
          : "HMAC 签名接收已启用，尚未配置上游目标地址"
    }
  };
}

export function courseSyncKeyMatches(received: unknown, configured: unknown) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(configured || ""));
  return left.length >= 24 && left.length === right.length && timingSafeEqual(left, right);
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function safeHexEqual(leftValue: unknown, rightValue: unknown) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === 64 && left.length === right.length && timingSafeEqual(left, right);
}

export function createCourseSyncNonce() {
  return randomBytes(18).toString("base64url");
}

export function createCourseSyncSignature({
  key,
  keyId,
  timestamp,
  nonce,
  packageHash,
  method = "POST",
  pathname = "/api/course-sync/packages"
}: CourseSyncSignatureInput) {
  const canonical = [String(method).toUpperCase(), pathname, String(timestamp), nonce, packageHash, keyId].join("\n");
  return createHmac("sha256", key).update(canonical).digest("hex");
}

export function verifyCourseSyncSignature(input: CourseSyncSignatureVerificationInput) {
  const signature = String(input.signature || "").toLowerCase();
  if (!signaturePattern.test(signature)) return false;
  return safeHexEqual(signature, createCourseSyncSignature(input));
}

export function isCourseSyncTimestampFresh(timestamp: unknown, now = Date.now(), windowSeconds = courseSyncReplayWindowSeconds) {
  const parsed = Number(timestamp);
  return Number.isSafeInteger(parsed) && Math.abs(now - parsed) <= Math.max(30, Number(windowSeconds || 0)) * 1000;
}

export function isCourseSyncNonce(value: unknown) {
  return noncePattern.test(String(value || ""));
}

export function createCourseSyncPackageId(payload: unknown) {
  return `course-package-${sha256(JSON.stringify(payload)).slice(0, 24)}`;
}

export function collectReferencedPageNumbers(structure: CourseSyncStructure | null | undefined, totalPages: number) {
  const pages = new Set([1]);
  const add = (value: unknown) => {
    const page = Number(value || 0);
    if (Number.isInteger(page) && page >= 1 && page <= totalPages) pages.add(page);
  };
  for (const unit of structure?.units || []) {
    for (const section of unit.sections || []) {
      add(section.pageStart);
      add(section.pageEnd);
      for (const block of section.blocks || []) {
        add(block.page);
        add(block.layout?.page);
      }
    }
  }
  return [...pages].sort((left, right) => left - right);
}

export function filterSnapshotForCourseSync(snapshot: CourseSyncSnapshot | null | undefined, pageNumbers: number[], chapters: unknown[]) {
  if (!snapshot) return null;
  const allowed = new Set(pageNumbers);
  const pageAssets = (snapshot.pageAssets || []).filter((asset) => allowed.has(Number(asset.pageNumber)));
  const localPages = (snapshot.layers?.local?.pages || []).filter((page) => allowed.has(Number(page.pageNumber)));
  const providers = (snapshot.layers?.upstream?.providers || []).map((provider) => ({
    ...provider,
    pages: (provider.pages || []).filter((page) => allowed.has(Number(page.pageNumber)))
  }));
  const visualReview = snapshot.layers?.upstream?.visualReview
    ? {
        ...snapshot.layers.upstream.visualReview,
        pages: (snapshot.layers.upstream.visualReview.pages || []).filter((page) => allowed.has(Number(page.page)))
      }
    : null;
  const differenceItems = (snapshot.layers?.differences?.items || []).filter((item) => allowed.has(Number(item.pageNumber)));
  return {
    ...snapshot,
    pageAssets,
    layers: {
      ...snapshot.layers,
      local: { ...snapshot.layers.local, pages: localPages },
      upstream: { ...snapshot.layers.upstream, providers, visualReview },
      differences: {
        ...snapshot.layers.differences,
        total: differenceItems.length,
        pending: differenceItems.filter((item) => item.status === "pending").length,
        pages: [...new Set(differenceItems.map((item) => Number(item.pageNumber)))].sort((a, b) => a - b),
        items: differenceItems
      },
      final: { ...snapshot.layers.final, chapters }
    }
  };
}

export function validateCourseSyncManifest(manifest: unknown) {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || !packageIdPattern.test(String(manifest.packageId || ""))) {
    throw new Error("COURSE_SYNC_PACKAGE_INVALID");
  }
  const source = isRecord(manifest.source) ? manifest.source : {};
  const metadata = isRecord(manifest.metadata) ? manifest.metadata : {};
  const content = isRecord(manifest.content) ? manifest.content : {};
  if (!importIdPattern.test(String(source.importId || ""))) throw new Error("COURSE_SYNC_SOURCE_INVALID");
  const title = String(metadata.title || "").trim();
  const description = String(metadata.description || "").trim();
  const sourceLabel = String(metadata.sourceLabel || "").trim();
  const chapters = Array.isArray(content.chapters) ? content.chapters.filter(isRecord) : [];
  const sentences = chapters.flatMap((chapter) => Array.isArray(chapter.sentences) ? chapter.sentences.filter(isRecord) : []);
  const sentenceCount = sentences.length;
  if (!title || title.length > 100 || !description || description.length > 500 || !sourceLabel || sourceLabel.length > 100
    || chapters.length === 0 || chapters.length > 100 || sentenceCount === 0 || sentenceCount > 480
    || sentences.some((sentence) => !String(sentence?.id || "").trim() || !String(sentence?.text || "").trim() || String(sentence.text).length > 2000)) {
    throw new Error("COURSE_SYNC_CONTENT_INVALID");
  }
  const assets = Array.isArray(manifest.assets) ? manifest.assets.filter(isRecord) as ValidatedCourseSyncAsset[] : [];
  const fileNames = new Set();
  const pageNumbers = new Set();
  if (assets.length === 0 || assets.length > 100 || assets.some((asset) => {
    const fileName = String(asset.fileName || "");
    const pageNumber = Number(asset.pageNumber || 0);
    const bytes = Number(asset.bytes || 0);
    const valid = pageFilePattern.test(fileName)
      && /^[a-f0-9]{64}$/.test(String(asset.sha256 || ""))
      && String(asset.mimeType || "image/png") === "image/png"
      && Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 999
      && Number.isInteger(bytes) && bytes > 0 && bytes <= 12 * 1024 * 1024
      && !fileNames.has(fileName) && !pageNumbers.has(pageNumber);
    fileNames.add(fileName);
    pageNumbers.add(pageNumber);
    return !valid;
  }) || assets.reduce((sum, asset) => sum + Number(asset.bytes || 0), 0) > 120 * 1024 * 1024) {
    throw new Error("COURSE_SYNC_ASSETS_INVALID");
  }
  return {
    title,
    chapters: chapters as unknown as PdfImportChapter[],
    sentenceCount,
    assets: assets as unknown as NormalizedCourseSyncAsset[]
  };
}
