import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";
process.env.KID_READING_SAVE_AUDIO = "0";
process.env.NODE_ENV = "development";
process.env.SPEECH_PROVIDER = "mock";

const { app } = await import("../server/index.js");
const { createChild, createLesson } = await import("../server/db.js");
const { createRegistrationKey } = await import("../server/parentAuth.js");

test("smart attempt route evaluates a recent contiguous speech segment without persisting discarded candidates", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.equal(typeof address, "object");
  const registrationKey = createRegistrationKey({ label: "route test" }).key;
  const registrationResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/register`, {
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
  const registration = await registrationResponse.json();
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

  const response = await fetch(`http://127.0.0.1:${address.port}/api/attempts/mock`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form
  });
  assert.equal(response.status, 200);
  const attempt = await response.json();
  assert.equal(attempt.candidateSelection.strategy, "latest-complete-contiguous");
  assert.equal(attempt.candidateSelection.selectedId, "segment-2");
  assert.equal(attempt.candidateSelection.evaluated.length, 1);
  assert.equal(attempt.passed, true);
});
