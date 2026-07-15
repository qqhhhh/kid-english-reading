import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kid-course-sync-security-"));
const sharedKey = "course-sync-security-key-123456789";
process.env.KID_READING_DB_PATH = ":memory:";
process.env.KID_READING_DATA_DIR = dataDir;
process.env.NODE_ENV = "production";
process.env.COURSE_SYNC_KEY = sharedKey;
process.env.COURSE_SYNC_KEY_ID = "primary";
process.env.COURSE_SYNC_ALLOW_LEGACY_BEARER = "0";

const { app } = await import("../server/index.js");
const {
  createCourseSyncPackageId,
  createCourseSyncSignature,
  sha256
} = await import("../server/courseSync.js");
const { listPlatformAdminAuditLogs } = await import("../server/db.js");

function startServer(context) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      context.after(() => new Promise((done) => server.close(done)));
      resolve(server.address().port);
    });
  });
}

function buildPackage() {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const manifest = {
    schemaVersion: 1,
    packageId: createCourseSyncPackageId({ importId: "pdf-20260715120000-AbCd1234" }),
    generatedAt: new Date().toISOString(),
    source: { importId: "pdf-20260715120000-AbCd1234", parser: "test", rule: "pep" },
    metadata: { resourceId: "secure-course", title: "Secure course", description: "Signed upload.", sourceLabel: "Test" },
    content: { chapters: [{ id: "unit-1", title: "Unit 1", sentences: [{ id: "sentence-1", text: "Hello." }] }] },
    assets: [{ fileName: "page-001.png", pageNumber: 1, mimeType: "image/png", bytes: png.length, sha256: sha256(png) }]
  };
  const manifestRaw = JSON.stringify(manifest);
  return { manifestRaw, packageHash: sha256(manifestRaw), png };
}

function signedHeaders(packageHash, nonce, timestamp) {
  return {
    Authorization: `Bearer ${sharedKey}`,
    "X-Course-Key-Id": "primary",
    "X-Course-Timestamp": timestamp,
    "X-Course-Nonce": nonce,
    "X-Course-Package-Sha256": packageHash,
    "X-Course-Signature": createCourseSyncSignature({ key: sharedKey, keyId: "primary", timestamp, nonce, packageHash })
  };
}

function packageForm({ manifestRaw, png }) {
  const form = new FormData();
  form.append("manifest", manifestRaw);
  form.append("assets", new Blob([png], { type: "image/png" }), "page-001.png");
  return form;
}

test("signed course packages are accepted once and replay is rejected before parsing", async (context) => {
  const port = await startServer(context);
  const payload = buildPackage();
  const nonce = "secure_nonce_1234567890";
  const timestamp = String(Date.now());
  const headers = signedHeaders(payload.packageHash, nonce, timestamp);
  const first = await fetch(`http://127.0.0.1:${port}/api/course-sync/packages`, {
    method: "POST",
    headers,
    body: packageForm(payload)
  });
  assert.equal(first.status, 201);
  const replay = await fetch(`http://127.0.0.1:${port}/api/course-sync/packages`, {
    method: "POST",
    headers,
    body: packageForm(payload)
  });
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error, "COURSE_SYNC_REPLAY_REJECTED");
  const logs = listPlatformAdminAuditLogs({ limit: 20 }).filter((entry) => entry.action === "course.sync.receive");
  assert.ok(logs.some((entry) => entry.status === "success" && entry.metadata.keyId === "primary"));
  assert.ok(logs.some((entry) => entry.status === "failure" && entry.metadata.statusCode === 409));
  assert.equal(JSON.stringify(logs).includes(sharedKey), false);
});

test("invalid upload credentials are rejected and production security headers are present", async (context) => {
  const port = await startServer(context);
  const response = await fetch(`http://127.0.0.1:${port}/api/course-sync/packages`, {
    method: "POST",
    headers: {
      Authorization: "Bearer invalid-key-with-enough-characters",
      "Content-Type": "application/octet-stream",
      "Content-Length": "1",
      "X-Course-Key-Id": "primary"
    },
    body: "x"
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.match(response.headers.get("content-security-policy"), /object-src 'none'/);
});

test("course sync rejects oversized requests from headers before reading a body", async (context) => {
  const port = await startServer(context);
  const result = await new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/api/course-sync/packages",
      method: "POST",
      headers: {
        "Content-Length": String(128 * 1024 * 1024 + 1),
        "X-Forwarded-For": "203.0.113.20"
      }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(result.status, 413);
  assert.equal(JSON.parse(result.body).error, "COURSE_SYNC_PACKAGE_TOO_LARGE");
});

test("course sync rate limits repeated invalid senders and CORS does not trust arbitrary origins", async (context) => {
  const port = await startServer(context);
  const statuses = [];
  for (let index = 0; index < 13; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/course-sync/packages`, {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-key-with-enough-characters",
        "Content-Type": "application/octet-stream",
        "Content-Length": "1",
        "X-Course-Key-Id": "primary",
        "X-Forwarded-For": "203.0.113.30",
        Origin: "https://evil.example"
      },
      body: "x"
    });
    statuses.push(response.status);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  assert.deepEqual(statuses.slice(0, 12), Array(12).fill(401));
  assert.equal(statuses[12], 429);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
