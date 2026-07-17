import assert from "node:assert/strict";
import test from "node:test";

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
} from "../server/courseSync.js";

const sharedKey = "course-sync-test-key-1234567890";

function validManifest() {
  const asset = Buffer.from("page-image");
  return {
    schemaVersion: 1,
    packageId: createCourseSyncPackageId({ importId: "pdf-20260714120000-AbCd1234" }),
    generatedAt: "2026-07-14T12:00:00.000Z",
    source: { importId: "pdf-20260714120000-AbCd1234", parser: "test", rule: "pep" },
    metadata: {
      resourceId: "official-course-test",
      title: "Test course",
      description: "Reviewed on the local workstation.",
      sourceLabel: "PDF import"
    },
    content: {
      chapters: [{ id: "unit-1", title: "Unit 1", sentences: [{ id: "s-1", text: "Hello." }] }]
    },
    assets: [{ fileName: "page-001.png", pageNumber: 1, bytes: asset.length, sha256: sha256(asset) }]
  };
}

test("course sync accepts HTTPS targets and local HTTP only", () => {
  const remote = getCourseSyncConfiguration({ COURSE_SYNC_TARGET_URL: "https://learn.example.com/path/", COURSE_SYNC_KEY: sharedKey });
  assert.equal(remote.targetEnabled, true);
  assert.equal(remote.publicStatus.targetUrl, "https://learn.example.com/path");
  assert.equal(remote.publicStatus.secure, true);

  const local = getCourseSyncConfiguration({ COURSE_SYNC_TARGET_URL: "http://127.0.0.1:4174", COURSE_SYNC_KEY: sharedKey });
  assert.equal(local.targetEnabled, true);
  assert.equal(local.publicStatus.secure, false);

  const insecure = getCourseSyncConfiguration({ COURSE_SYNC_TARGET_URL: "http://learn.example.com", COURSE_SYNC_KEY: sharedKey });
  assert.equal(insecure.targetEnabled, false);
  assert.equal(insecure.inboundEnabled, true);
});

test("course sync keys are compared exactly and require a strong minimum length", () => {
  assert.equal(courseSyncKeyMatches(sharedKey, sharedKey), true);
  assert.equal(courseSyncKeyMatches(`${sharedKey}x`, sharedKey), false);
  assert.equal(courseSyncKeyMatches("short", "short"), false);
});

test("course sync supports key rotation without exposing key values", () => {
  const configuration = getCourseSyncConfiguration({
    COURSE_SYNC_TARGET_URL: "https://www.qiangzihang.com",
    COURSE_SYNC_KEY_ID: "current",
    COURSE_SYNC_KEY: sharedKey,
    COURSE_SYNC_KEYS: "previous:previous-course-sync-key-123456789,current:ignored-duplicate-key-123456789"
  });
  assert.equal(configuration.keyId, "current");
  assert.deepEqual(configuration.publicStatus.acceptedKeyIds, ["current", "previous"]);
  assert.equal(configuration.publicStatus.signatureRequired, true);
  assert.equal(JSON.stringify(configuration.publicStatus).includes(sharedKey), false);
});

test("course sync HMAC signatures bind the request and expire", () => {
  const timestamp = String(Date.now());
  const nonce = createCourseSyncNonce();
  const packageHash = sha256("manifest");
  const input = { key: sharedKey, keyId: "primary", timestamp, nonce, packageHash };
  const signature = createCourseSyncSignature(input);
  assert.equal(isCourseSyncNonce(nonce), true);
  assert.equal(isCourseSyncTimestampFresh(timestamp), true);
  assert.equal(verifyCourseSyncSignature({ ...input, signature }), true);
  assert.equal(verifyCourseSyncSignature({ ...input, packageHash: sha256("tampered"), signature }), false);
  assert.equal(isCourseSyncTimestampFresh(String(Date.now() - 6 * 60 * 1000)), false);
});

test("course sync keeps only referenced page evidence plus the cover", () => {
  const chapters = [{ id: "unit-1", sentences: [{ id: "s-1", text: "Hello." }] }];
  const structure = {
    units: [{ sections: [{ pageStart: 8, pageEnd: 9, blocks: [{ page: 10 }, { layout: { page: 11 } }] }] }]
  };
  const pages = collectReferencedPageNumbers(structure, 94);
  assert.deepEqual(pages, [1, 8, 9, 10, 11]);
  const snapshot = {
    pageAssets: [1, 2, 8].map((pageNumber) => ({ pageNumber })),
    layers: {
      local: { pages: [1, 2, 8].map((pageNumber) => ({ pageNumber })) },
      upstream: { providers: [{ pages: [{ pageNumber: 2 }, { pageNumber: 8 }] }], visualReview: { pages: [{ page: 8 }, { page: 9 }] } },
      differences: { items: [{ pageNumber: 2, status: "pending" }, { pageNumber: 8, status: "pending" }] },
      final: { chapters: [] }
    }
  };
  const filtered = filterSnapshotForCourseSync(snapshot, pages, chapters);
  assert.ok(filtered);
  assert.deepEqual(filtered.pageAssets.map((asset) => asset.pageNumber), [1, 8]);
  assert.deepEqual(filtered.layers.local.pages.map((page) => page.pageNumber), [1, 8]);
  assert.deepEqual(filtered.layers.upstream.providers[0].pages.map((page) => page.pageNumber), [8]);
  assert.deepEqual(filtered.layers.differences.pages, [8]);
  assert.equal(filtered.layers.differences.pending, 1);
  assert.deepEqual(filtered.layers.final.chapters, chapters);
});

test("course sync manifest validation rejects malformed packages", () => {
  const manifest = validManifest();
  const validated = validateCourseSyncManifest(manifest);
  assert.equal(validated.sentenceCount, 1);
  assert.equal(validated.assets.length, 1);

  assert.throws(
    () => validateCourseSyncManifest({ ...manifest, assets: [{ ...manifest.assets[0], fileName: "../page.png" }] }),
    /COURSE_SYNC_ASSETS_INVALID/
  );
  assert.throws(
    () => validateCourseSyncManifest({ ...manifest, content: { chapters: [] } }),
    /COURSE_SYNC_CONTENT_INVALID/
  );
});
