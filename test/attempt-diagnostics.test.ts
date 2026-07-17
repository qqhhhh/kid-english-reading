import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isRecord, listeningPort, responseJson } from "../test-support/helpers.js";

interface RegistrationResponse {
  session: { household: { id: string } };
}

interface CalibrationSummary {
  totalSamples: number;
  reviewed: number;
  providers: Record<string, { errorRate: number; unavailable: number }>;
}

interface DiagnosticAttemptResponse {
  id: string;
  contentTitle?: string;
  audioAvailable: boolean;
  diagnosticStatus?: string;
  rejectionStage?: string;
  rejectionCode?: string;
}

interface DiagnosticsResponse {
  attempts: DiagnosticAttemptResponse[];
  calibrationSummary: CalibrationSummary;
}

interface CalibrationResponse {
  calibration: { label: string };
  calibrationSummary: CalibrationSummary;
}

interface RejectedAttemptResponse {
  id: string;
}

interface ServerRejectedResponse {
  code: string;
  attemptId: string;
}

process.env.KID_READING_DB_PATH = ":memory:";
const diagnosticDataDir = mkdtempSync(path.join(tmpdir(), "kid-reading-diagnostic-api-"));
process.env.KID_READING_DATA_DIR = diagnosticDataDir;
process.env.KID_READING_SAVE_AUDIO = "1";
process.env.NODE_ENV = "development";
test.after(() => rmSync(diagnosticDataDir, { recursive: true, force: true }));

const {
  createChild,
  createHousehold,
  createLesson,
  initDatabase,
  insertAttempt,
  insertStorybookAttempt,
  listAttemptDiagnostics
} = await import("../server/db.js");
const { app } = await import("../server/index.js");
const { createRegistrationKey } = await import("../server/parentAuth.js");

initDatabase();

function seedHousehold(suffix: string) {
  const householdId = `diagnostic-household-${suffix}`;
  const childId = `diagnostic-child-${suffix}`;
  const lessonId = `diagnostic-lesson-${suffix}`;
  const sentenceId = `diagnostic-sentence-${suffix}`;
  createHousehold({ id: householdId, name: `Diagnostic household ${suffix}` });
  createChild({ id: childId, name: `Diagnostic child ${suffix}`, householdId });
  createLesson({
    id: lessonId,
    title: `Diagnostic lesson ${suffix}`,
    householdId,
    chapters: [{
      id: `${lessonId}-chapter`,
      title: "Unit 1",
      sentences: [{ id: sentenceId, text: `Hello ${suffix}.`, minScore: 75 }]
    }]
  });
  return { householdId, childId, lessonId, sentenceId };
}

function assessment(score: number) {
  return {
    SuggestedScore: score,
    PronAccuracy: score,
    PronFluency: score / 100,
    PronCompletion: 1,
    Words: [{ Word: "Hello", ReferenceWord: "Hello", PronAccuracy: score, PronFluency: 1, MatchTag: 0, PhoneInfos: [] }]
  };
}

test("scoring diagnostics combine lesson and storybook attempts without crossing households", () => {
  const first = seedHousehold("first");
  const second = seedHousehold("second");
  insertAttempt({
    id: "diagnostic-lesson-attempt",
    ...first,
    referenceText: "Hello first.",
    createdAt: "2026-07-15T08:00:00.000Z",
    speechProvider: "tencent",
    audioBytes: 1024,
    result: assessment(88),
    passed: true,
    recordingQuality: { inputSampleRate: 48_000, rawDurationMs: 1800, processedDurationMs: 1500, voiceDurationMs: 1100, peak: 0.3, rms: 0.04, silenceTrimmedMs: 300 },
    clientDevice: { userAgent: "Diagnostic Safari", platform: "iPad" },
    speechProviderComparison: {
      mode: "shadow",
      comparedAt: "2026-07-15T08:00:00.000Z",
      primary: { provider: "tencent", status: "success", durationMs: 800, suggestedScore: 88 },
      shadow: { provider: "xfyun", status: "success", durationMs: 900, suggestedScore: 80, result: assessment(80) }
    }
  });
  insertStorybookAttempt({
    id: "diagnostic-storybook-attempt",
    householdId: first.householdId,
    childId: first.childId,
    storybookId: "storybook-sample",
    storybookPageId: "page-1",
    sentenceId: "storybook-sentence-1",
    referenceText: "A little mouse.",
    createdAt: "2026-07-15T09:00:00.000Z",
    speechProvider: "tencent",
    audioBytes: 2048,
    result: assessment(76),
    passed: true
  });
  insertAttempt({
    id: "diagnostic-other-household-attempt",
    ...second,
    referenceText: "Hello second.",
    createdAt: "2026-07-15T10:00:00.000Z",
    speechProvider: "tencent",
    audioBytes: 512,
    result: assessment(91),
    passed: true
  });

  const rows = listAttemptDiagnostics({ householdId: first.householdId, childId: first.childId, limit: 10 });
  assert.deepEqual(rows.map((attempt) => attempt.id), ["diagnostic-storybook-attempt", "diagnostic-lesson-attempt"]);
  assert.equal(rows[0]?.sourceType, "storybook");
  assert.equal(rows[1]?.sourceType, "lesson");
  assert.equal(rows[1]?.contentTitle, "Diagnostic lesson first");
  assert.equal(rows[1]?.childName, "Diagnostic child first");
  const lessonRow: unknown = rows[1];
  assert.ok(isRecord(lessonRow));
  assert.ok(isRecord(lessonRow.clientDevice));
  assert.equal(lessonRow.clientDevice.platform, "iPad");
  assert.equal(JSON.stringify(rows).includes(second.householdId), false);

  const searched = listAttemptDiagnostics({ householdId: first.householdId, query: "lesson-attempt", limit: 10 });
  assert.deepEqual(searched.map((attempt) => attempt.id), ["diagnostic-lesson-attempt"]);
});

test("parent diagnostics API returns policy-normalized attempts for its own child", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${listeningPort(server)}`;
  const key = createRegistrationKey({ label: "diagnostic route" }).key;
  const registrationResponse = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationKey: key,
      householdName: "Diagnostic route household",
      username: "diagnostic_route_parent",
      password: "diagnostic-password"
    })
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await responseJson<RegistrationResponse>(registrationResponse);
  const cookie = registrationResponse.headers.get("set-cookie")?.split(";")[0] || "";
  const householdId = registration.session.household.id;
  createChild({ id: "diagnostic-route-child", name: "Route child", householdId });
  createLesson({
    id: "diagnostic-route-lesson",
    title: "Route lesson",
    householdId,
    chapters: [{ id: "diagnostic-route-chapter", title: "Unit", sentences: [{ id: "diagnostic-route-sentence", text: "Read clearly.", minScore: 75 }] }]
  });
  insertAttempt({
    id: "diagnostic-route-attempt",
    householdId,
    childId: "diagnostic-route-child",
    sentenceId: "diagnostic-route-sentence",
    referenceText: "Read clearly.",
    createdAt: "2026-07-15T12:00:00.000Z",
    speechProvider: "tencent",
    audioBytes: 900,
    result: assessment(86),
    passed: true
  });

  const response = await fetch(`${base}/api/admin/attempt-diagnostics?childId=diagnostic-route-child&query=route-attempt`, {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 200);
  const body = await responseJson<DiagnosticsResponse>(response);
  assert.equal(body.attempts.length, 1);
  assert.equal(body.attempts[0].id, "diagnostic-route-attempt");
  assert.equal(body.attempts[0].contentTitle, "Route lesson");
  assert.equal(body.attempts[0].audioAvailable, false);
  assert.equal(body.calibrationSummary.totalSamples, 1);
  assert.equal(body.calibrationSummary.reviewed, 0);

  const calibrationResponse = await fetch(`${base}/api/admin/attempt-diagnostics/diagnostic-route-attempt/calibration`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ childId: "diagnostic-route-child", label: "correct", note: "Clearly read" })
  });
  assert.equal(calibrationResponse.status, 200);
  const calibration = await responseJson<CalibrationResponse>(calibrationResponse);
  assert.equal(calibration.calibration.label, "correct");
  assert.equal(calibration.calibrationSummary.providers.tencent?.errorRate, 0);
  assert.equal(calibration.calibrationSummary.providers.xfyun?.unavailable, 1);

  const rejectedForm = new FormData();
  rejectedForm.set("childId", "diagnostic-route-child");
  rejectedForm.set("sentenceId", "diagnostic-route-sentence");
  rejectedForm.set("referenceText", "Read clearly.");
  rejectedForm.set("rejectionCode", "too-quiet");
  rejectedForm.set("sourceType", "lesson");
  rejectedForm.set("recordingQuality", JSON.stringify({ rawDurationMs: 1200, processedDurationMs: 900, rms: 0.001, peak: 0.005 }));
  rejectedForm.set("clientDevice", JSON.stringify({ userAgent: "Test Safari", platform: "iPad" }));
  rejectedForm.set("audio", new Blob([Buffer.alloc(64)], { type: "audio/wav" }), "too-quiet.wav");
  const rejectedResponse = await fetch(`${base}/api/attempt-diagnostics/rejections`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: rejectedForm
  });
  assert.equal(rejectedResponse.status, 201);
  const rejected = await responseJson<RejectedAttemptResponse>(rejectedResponse);
  assert.match(rejected.id, /^rejected-/u);

  const rejectedListResponse = await fetch(`${base}/api/admin/attempt-diagnostics?childId=diagnostic-route-child&query=${encodeURIComponent(rejected.id)}`, {
    headers: { Cookie: cookie }
  });
  assert.equal(rejectedListResponse.status, 200);
  const rejectedList = await responseJson<DiagnosticsResponse>(rejectedListResponse);
  assert.equal(rejectedList.attempts.length, 1);
  assert.equal(rejectedList.attempts[0].diagnosticStatus, "rejected");
  assert.equal(rejectedList.attempts[0].rejectionStage, "client");
  assert.equal(rejectedList.attempts[0].rejectionCode, "too-quiet");
  assert.equal(rejectedList.attempts[0].audioAvailable, true);
  assert.equal(rejectedList.calibrationSummary.totalSamples, 2);
  assert.equal(rejectedList.calibrationSummary.reviewed, 1);

  const rejectedAudioResponse = await fetch(`${base}/api/admin/attempt-diagnostics/${encodeURIComponent(rejected.id)}/audio?childId=diagnostic-route-child`, {
    headers: { Cookie: cookie }
  });
  assert.equal(rejectedAudioResponse.status, 200);
  assert.equal(rejectedAudioResponse.headers.get("content-type"), "audio/wav");

  const serverRejectedForm = new FormData();
  serverRejectedForm.set("childId", "diagnostic-route-child");
  serverRejectedForm.set("sentenceId", "diagnostic-route-sentence");
  serverRejectedForm.set("referenceText", "Read clearly.");
  serverRejectedForm.set("durationMs", "100");
  serverRejectedForm.set("recordingQuality", JSON.stringify({ rawDurationMs: 100, processedDurationMs: 100, voiceDurationMs: 0, rms: 0.001, peak: 0.005 }));
  serverRejectedForm.set("audio", new Blob([Buffer.alloc(96)], { type: "audio/wav" }), "server-rejected.wav");
  const serverRejectedResponse = await fetch(`${base}/api/attempts/mock`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: serverRejectedForm
  });
  assert.equal(serverRejectedResponse.status, 422);
  const serverRejected = await responseJson<ServerRejectedResponse>(serverRejectedResponse);
  assert.equal(serverRejected.code, "NO_SPEECH_DETECTED");
  assert.match(serverRejected.attemptId, /^[A-Za-z0-9_-]+$/u);
  const serverRejectedListResponse = await fetch(`${base}/api/admin/attempt-diagnostics?childId=diagnostic-route-child&query=${encodeURIComponent(serverRejected.attemptId)}`, {
    headers: { Cookie: cookie }
  });
  const serverRejectedList = await responseJson<DiagnosticsResponse>(serverRejectedListResponse);
  assert.equal(serverRejectedList.attempts[0].rejectionStage, "server");
  assert.equal(serverRejectedList.attempts[0].rejectionCode, "NO_SPEECH_DETECTED");
  assert.equal(serverRejectedList.calibrationSummary.totalSamples, 3);

  const foreignChildResponse = await fetch(`${base}/api/admin/attempt-diagnostics?childId=diagnostic-child-first`, {
    headers: { Cookie: cookie }
  });
  assert.equal(foreignChildResponse.status, 404);
});
