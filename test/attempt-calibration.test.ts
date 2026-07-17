import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findCalibrationRecord,
  listCalibrationRecords,
  saveCalibrationReview,
  summarizeCalibration,
  upsertRejectedCalibrationSample
} from "../server/attemptCalibration.js";

test("calibration records preserve rejected samples and compute provider error rates", async (context) => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "kid-reading-calibration-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));

  await upsertRejectedCalibrationSample({
    rootDir,
    householdId: "household-one",
    sample: {
      id: "rejected-sample-one",
      childId: "child-one",
      referenceText: "Read this.",
      createdAt: "2026-07-15T08:00:00.000Z",
      diagnosticStatus: "rejected"
    }
  });
  await upsertRejectedCalibrationSample({
    rootDir,
    householdId: "household-two",
    sample: { id: "foreign-sample", childId: "child-two", referenceText: "Private.", diagnosticStatus: "rejected" }
  });

  await saveCalibrationReview({
    rootDir,
    householdId: "household-one",
    sampleId: "rejected-sample-one",
    childId: "child-one",
    label: "silent",
    note: "No voice heard",
    reviewedBy: { id: "parent-one", username: "parent" },
    providerOutcomes: {
      tencent: { status: "success", passed: true },
      xfyun: { status: "success", passed: false }
    }
  });

  const records = await listCalibrationRecords({ rootDir, householdId: "household-one", childId: "child-one" });
  assert.equal(records.length, 1);
  assert.equal(JSON.stringify(records).includes("Private"), false);
  const summary = summarizeCalibration(records, 3);
  assert.equal(summary.reviewed, 1);
  assert.equal(summary.unreviewed, 2);
  assert.deepEqual(summary.providers.tencent, {
    evaluated: 1,
    mismatches: 1,
    falseAccepts: 1,
    falseRejects: 0,
    unavailable: 0,
    errorRate: 100
  });
  assert.equal(summary.providers.xfyun.errorRate, 0);

  await saveCalibrationReview({
    rootDir,
    householdId: "household-one",
    sampleId: "rejected-sample-one",
    childId: "child-one",
    label: ""
  });
  const cleared = await findCalibrationRecord({ rootDir, householdId: "household-one", sampleId: "rejected-sample-one" });
  assert.ok(cleared);
  assert.ok(cleared.sample);
  assert.equal(cleared.review, undefined);
  assert.equal(cleared.sample.referenceText, "Read this.");
});

test("clearing a review-only calibration record removes it", async (context) => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "kid-reading-calibration-review-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  await saveCalibrationReview({
    rootDir,
    householdId: "household-one",
    sampleId: "stored-attempt-one",
    childId: "child-one",
    label: "correct",
    reviewedBy: { id: "parent-one", username: "parent" },
    providerOutcomes: { tencent: { status: "success", passed: true } }
  });
  await saveCalibrationReview({
    rootDir,
    householdId: "household-one",
    sampleId: "stored-attempt-one",
    childId: "child-one",
    label: ""
  });
  assert.equal(await findCalibrationRecord({ rootDir, householdId: "household-one", sampleId: "stored-attempt-one" }), null);
});
