import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const calibrationLabels = ["correct", "missed", "misread", "silent", "noise", "other"] as const;

export type CalibrationLabel = (typeof calibrationLabels)[number];
export type CalibrationProvider = "tencent" | "xfyun";

export interface CalibrationProviderOutcome {
  status?: string;
  passed?: boolean;
  [key: string]: unknown;
}

export interface CalibrationSample {
  id?: string;
  childId?: string;
  createdAt?: string;
  householdId?: string;
  [key: string]: unknown;
}

export interface CalibrationRecord {
  schemaVersion?: number;
  id?: string;
  childId?: string;
  sample?: CalibrationSample;
  review?: {
    label: CalibrationLabel;
    note: string;
    reviewedAt: string;
    reviewedBy: { id: string; username: string };
  };
  providerOutcomes?: Partial<Record<CalibrationProvider, CalibrationProviderOutcome>>;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface ProviderSummary {
  evaluated: number;
  mismatches: number;
  falseAccepts: number;
  falseRejects: number;
  unavailable: number;
  errorRate: number | null;
}

const calibrationLabelSet = new Set<string>(calibrationLabels);
const safeStorageIdPattern = /^[A-Za-z0-9_-]{1,160}$/u;

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function requireSafeStorageId(value: unknown, label: string) {
  const normalized = String(value || "").trim();
  if (!safeStorageIdPattern.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

function householdDirectory(rootDir: string, householdId: string) {
  return path.join(rootDir, requireSafeStorageId(householdId, "household id"));
}

function recordPath(rootDir: string, householdId: string, sampleId: string) {
  return path.join(householdDirectory(rootDir, householdId), `${requireSafeStorageId(sampleId, "sample id")}.json`);
}

async function readJsonFile(filePath: string): Promise<CalibrationRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as CalibrationRecord : null;
  } catch (error: unknown) {
    if ((isFileSystemError(error) && error.code === "ENOENT") || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporaryPath, filePath);
}

export async function findCalibrationRecord({ rootDir, householdId, sampleId }: { rootDir: string; householdId: string; sampleId: string }) {
  return readJsonFile(recordPath(rootDir, householdId, sampleId));
}

export async function listCalibrationRecords({ rootDir, householdId, childId = "" }: { rootDir: string; householdId: string; childId?: string }) {
  const directory = householdDirectory(rootDir, householdId);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isFileSystemError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const scopedChildId = String(childId || "").trim();
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .slice(0, 10_000)
      .map((entry) => readJsonFile(path.join(directory, entry.name)))
  );
  return records
    .filter((record): record is CalibrationRecord => Boolean(record && (!scopedChildId || record.childId === scopedChildId)))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

export async function upsertRejectedCalibrationSample({ rootDir, householdId, sample }: {
  rootDir: string;
  householdId: string;
  sample: CalibrationSample;
}) {
  const id = requireSafeStorageId(sample?.id, "sample id");
  const childId = requireSafeStorageId(sample?.childId, "child id");
  const filePath = recordPath(rootDir, householdId, id);
  const existing = await readJsonFile(filePath);
  const now = new Date().toISOString();
  const next = {
    ...(existing || {}),
    schemaVersion: 1,
    id,
    childId,
    sample: { ...sample, id, childId, householdId: undefined },
    createdAt: existing?.createdAt || sample.createdAt || now,
    updatedAt: now
  };
  await writeJsonAtomic(filePath, next);
  return next;
}

export async function saveCalibrationReview({
  rootDir,
  householdId,
  sampleId,
  childId,
  label,
  note = "",
  reviewedBy,
  providerOutcomes = {}
}: {
  rootDir: string;
  householdId: string;
  sampleId: string;
  childId: string;
  label: string;
  note?: string;
  reviewedBy?: { id?: string; username?: string } | null;
  providerOutcomes?: Partial<Record<CalibrationProvider, CalibrationProviderOutcome>>;
}) {
  const id = requireSafeStorageId(sampleId, "sample id");
  const scopedChildId = requireSafeStorageId(childId, "child id");
  const filePath = recordPath(rootDir, householdId, id);
  const existing = await readJsonFile(filePath);
  const normalizedLabel = String(label || "").trim();
  if (!normalizedLabel) {
    if (!existing?.sample) {
      await fs.unlink(filePath).catch((error: unknown) => {
        if (!isFileSystemError(error) || error.code !== "ENOENT") throw error;
      });
      return null;
    }
    const next = { ...existing, review: undefined, providerOutcomes: undefined, updatedAt: new Date().toISOString() };
    await writeJsonAtomic(filePath, next);
    return next;
  }
  if (!calibrationLabelSet.has(normalizedLabel)) throw new Error("Invalid calibration label");
  if (existing?.childId && existing.childId !== scopedChildId) throw new Error("Calibration child mismatch");
  const now = new Date().toISOString();
  const next = {
    ...(existing || {}),
    schemaVersion: 1,
    id,
    childId: scopedChildId,
    review: {
      label: normalizedLabel as CalibrationLabel,
      note: String(note || "").trim().slice(0, 500),
      reviewedAt: now,
      reviewedBy: {
        id: String(reviewedBy?.id || "").slice(0, 160),
        username: String(reviewedBy?.username || "").slice(0, 120)
      }
    },
    providerOutcomes,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  await writeJsonAtomic(filePath, next);
  return next;
}

function createProviderSummary(): ProviderSummary {
  return { evaluated: 0, mismatches: 0, falseAccepts: 0, falseRejects: 0, unavailable: 0, errorRate: null };
}

export function summarizeCalibration(records: Array<CalibrationRecord | null | undefined>, totalSamples = 0) {
  const providers: Record<CalibrationProvider, ProviderSummary> = {
    tencent: createProviderSummary(),
    xfyun: createProviderSummary()
  };
  const labels = Object.fromEntries(calibrationLabels.map((label) => [label, 0])) as Record<CalibrationLabel, number>;
  let reviewed = 0;

  for (const record of records) {
    if (!record) continue;
    const label = record?.review?.label;
    if (!label || !calibrationLabelSet.has(label)) continue;
    reviewed += 1;
    labels[label] += 1;
    const expectedPass = label === "correct" ? true : label === "other" ? null : false;
    if (expectedPass === null) continue;
    for (const provider of Object.keys(providers) as CalibrationProvider[]) {
      const outcome = record.providerOutcomes?.[provider];
      if (!outcome || outcome.status !== "success" || typeof outcome.passed !== "boolean") {
        providers[provider].unavailable += 1;
        continue;
      }
      providers[provider].evaluated += 1;
      if (outcome.passed === expectedPass) continue;
      providers[provider].mismatches += 1;
      if (outcome.passed) providers[provider].falseAccepts += 1;
      else providers[provider].falseRejects += 1;
    }
  }

  for (const summary of Object.values(providers)) {
    summary.errorRate = summary.evaluated > 0 ? Math.round((summary.mismatches / summary.evaluated) * 10_000) / 100 : null;
  }

  return {
    totalSamples,
    reviewed,
    unreviewed: Math.max(0, totalSamples - reviewed),
    labels,
    providers
  };
}
