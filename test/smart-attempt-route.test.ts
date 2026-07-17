import assert from "node:assert/strict";
import test from "node:test";
import { listeningPort, responseJson } from "../test-support/helpers.js";

interface RegistrationResponse {
  session: { household: { id: string } };
}

interface AttemptResponse {
  candidateSelection: {
    strategy: string;
    selectedId: string;
    evaluated: unknown[];
  };
  assessmentSource?: string;
  result?: { SuggestedScore?: number };
  passed: boolean;
}

process.env.KID_READING_DB_PATH = ":memory:";
process.env.KID_READING_SAVE_AUDIO = "0";
process.env.NODE_ENV = "development";
process.env.SPEECH_PROVIDER = "mock";

const { app } = await import("../server/index.js");
const { createChild, createLesson } = await import("../server/db.js");
const { createRegistrationKey } = await import("../server/parentAuth.js");
const { recordLiveSpeechTestResult } = await import("../server/liveSpeech.js");

test("lesson batch fallback evaluates the full raw recording exactly once", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const port = listeningPort(server);
  const registrationKey = createRegistrationKey({ label: "route test" }).key;
  const registrationResponse = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      registrationKey,
      householdName: "Route household",
      username: "route_parent",
      password: "route-password"
    })
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await responseJson<RegistrationResponse>(registrationResponse);
  const cookie = registrationResponse.headers.get("set-cookie")?.split(";")[0] || "";
  const householdId = registration.session.household.id;
  createChild({ id: "smart-route-child", name: "Route child", householdId });
  createLesson({
    id: "smart-route-lesson",
    title: "Route lesson",
    householdId,
    chapters: [
      {
        id: "smart-route-chapter",
        title: "Unit 1",
        sentences: [{ id: "smart-route-sentence", text: "Can you help?", minScore: 75 }]
      }
    ]
  });
  const form = new FormData();
  form.append("childId", "smart-route-child");
  form.append("sentenceId", "smart-route-sentence");
  form.append("referenceText", "Can you help?");
  form.append("minScore", "75");
  form.append("durationMs", "4000");
  form.append(
    "candidateMetadata",
    JSON.stringify([
      { id: "segment-2", kind: "speech-segment", durationMs: 2200 },
      { id: "full-session", kind: "full-session", durationMs: 4000 }
    ])
  );
  form.append("audio", new Blob([new Uint8Array(128)], { type: "audio/wav" }), "full.wav");
  form.append("candidateAudio", new Blob([new Uint8Array(96)], { type: "audio/wav" }), "segment-2.wav");

  const response = await fetch(`http://127.0.0.1:${port}/api/attempts/mock`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form
  });
  assert.equal(response.status, 200);
  const attempt = await responseJson<AttemptResponse>(response);
  assert.equal(attempt.candidateSelection.strategy, "single-raw-fallback");
  assert.equal(attempt.candidateSelection.selectedId, "full-session");
  assert.equal(attempt.candidateSelection.evaluated.length, 1);
  assert.equal(attempt.passed, true);

  const runId = `live-test-route-${Date.now()}`;
  recordLiveSpeechTestResult({
    runId,
    householdId,
    childId: "smart-route-child",
    sentenceId: "smart-route-sentence",
    itemType: "sentence",
    referenceText: "Can you help?",
    audio: Buffer.alloc(128, 1),
    result: {
      SuggestedScore: 91,
      PronAccuracy: 91,
      PronFluency: 0.9,
      PronCompletion: 1,
      Words: [
        { Word: "Can", ReferenceWord: "Can", PronAccuracy: 92, PronFluency: 0.9, MatchTag: 0, PhoneInfos: [] },
        { Word: "you", ReferenceWord: "you", PronAccuracy: 90, PronFluency: 0.9, MatchTag: 0, PhoneInfos: [] },
        { Word: "help", ReferenceWord: "help", PronAccuracy: 91, PronFluency: 0.9, MatchTag: 0, PhoneInfos: [] }
      ]
    },
    endRequestedAt: Date.now() - 80,
    interimCount: 2,
    audioBytes: 84,
    audioChunks: 3
  });
  const liveResponse = await fetch(`http://127.0.0.1:${port}/api/attempts/live`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      childId: "smart-route-child",
      sentenceId: "smart-route-sentence",
      referenceText: "Can you help?",
      liveSpeechTestRunId: runId,
      minScore: "75",
      durationMs: "2400",
      recordingQuality: JSON.stringify({ rms: 0.08 })
    })
  });
  assert.equal(liveResponse.status, 200);
  const liveAttempt = await responseJson<AttemptResponse>(liveResponse);
  assert.equal(liveAttempt.assessmentSource, "live-stream");
  assert.equal(liveAttempt.candidateSelection.strategy, "stream-primary-full-session");
  assert.equal(liveAttempt.result?.SuggestedScore, 91);
});
