import assert from "node:assert/strict";
import test from "node:test";

process.env.KID_READING_DB_PATH = ":memory:";
process.env.NODE_ENV = "development";
process.env.LOCAL_COURSE_STUDIO_ENABLED = "0";
delete process.env.PLATFORM_ADMIN_USERNAMES;

const { app } = await import("../server/index.js");
const { createRegistrationKey } = await import("../server/parentAuth.js");

function cookieFrom(response, name) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  return (values.find((value) => value.startsWith(`${name}=`)) || "").split(";")[0];
}

test("platform admin APIs reject an ordinary parent and accept an explicitly configured username", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const key = createRegistrationKey({ label: "platform route test" }).key;
  const registration = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationKey: key, householdName: "Admin test", username: "platform_route_parent", password: "route-password" })
  });
  assert.equal(registration.status, 201);
  const cookie = cookieFrom(registration, "kid_parent_session");

  const importedCourse = await fetch(`${base}/api/admin/course-library/family-helpers-starter/import`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ minScore: 75 })
  });
  assert.equal(importedCourse.status, 201);
  const importedLesson = await importedCourse.json();
  const forbiddenEdit = await fetch(`${base}/api/admin/lessons/${importedLesson.id}`, {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "should not change", chapters: importedLesson.chapters, minScore: 75 })
  });
  assert.equal(forbiddenEdit.status, 403);
  assert.equal((await forbiddenEdit.json()).error, "COURSE_LIBRARY_LESSON_READ_ONLY");

  const denied = await fetch(`${base}/api/platform-admin/courses`, { headers: { Cookie: cookie } });
  assert.equal(denied.status, 403);

  process.env.PLATFORM_ADMIN_USERNAMES = "platform_route_parent";
  const session = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } }).then((response) => response.json());
  assert.equal(session.session.user.role, "platform_admin");
  const allowed = await fetch(`${base}/api/platform-admin/courses`, { headers: { Cookie: cookie } });
  assert.equal(allowed.status, 200);
  const createdKeysResponse = await fetch(`${base}/api/platform-admin/registration-keys/batch`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", "X-Admin-Request": "1" },
    body: JSON.stringify({ quantity: 2, expiresInHours: 24, note: "测试邀请批次" })
  });
  assert.equal(createdKeysResponse.status, 201);
  const createdKeys = await createdKeysResponse.json();
  assert.equal(createdKeys.generated.length, 2);
  assert.match(createdKeys.generated[0].key, /^KID-/);
  assert.equal(createdKeys.snapshot.stats.active, 2);

  const invitedRegistration = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationKey: createdKeys.generated[0].key, householdName: "受邀家庭", username: "invited_key_parent", password: "invited-password" })
  });
  assert.equal(invitedRegistration.status, 201);
  const keySnapshotResponse = await fetch(`${base}/api/platform-admin/registration-keys`, { headers: { Cookie: cookie } });
  assert.equal(keySnapshotResponse.status, 200);
  const keySnapshot = await keySnapshotResponse.json();
  assert.equal(JSON.stringify(keySnapshot).includes(createdKeys.generated[0].key), false);
  const consumedKey = keySnapshot.keys.find((item) => item.id === createdKeys.generated[0].id);
  assert.equal(consumedKey.status, "used");
  assert.equal(consumedKey.consumedByUsername, "invited_key_parent");
  assert.equal(consumedKey.consumedByHouseholdName, "受邀家庭");

  const noteResponse = await fetch(`${base}/api/platform-admin/registration-keys/${encodeURIComponent(createdKeys.generated[0].id)}`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json", "X-Admin-Request": "1" },
    body: JSON.stringify({ note: "已交给测试家庭" })
  });
  assert.equal(noteResponse.status, 200);
  assert.equal((await noteResponse.json()).keys.find((item) => item.id === createdKeys.generated[0].id).note, "已交给测试家庭");

  const disableResponse = await fetch(`${base}/api/platform-admin/registration-keys/${encodeURIComponent(createdKeys.generated[1].id)}/disable`, {
    method: "POST",
    headers: { Cookie: cookie, "X-Admin-Request": "1" }
  });
  assert.equal(disableResponse.status, 200);
  assert.equal((await disableResponse.json()).keys.find((item) => item.id === createdKeys.generated[1].id).status, "disabled");
  const disabledRegistration = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationKey: createdKeys.generated[1].key, householdName: "不可注册", username: "disabled_key_parent", password: "disabled-password" })
  });
  assert.equal(disabledRegistration.status, 400);
  assert.equal((await disabledRegistration.json()).error, "REGISTRATION_KEY_INVALID");
  const hiddenHunyuanStatus = await fetch(`${base}/api/platform-admin/hunyuan-ocr/status`, { headers: { Cookie: cookie } });
  assert.equal(hiddenHunyuanStatus.status, 404);
  process.env.LOCAL_COURSE_STUDIO_ENABLED = "1";
  const hunyuanStatus = await fetch(`${base}/api/platform-admin/hunyuan-ocr/status`, { headers: { Cookie: cookie } });
  assert.equal(hunyuanStatus.status, 200);
  const hunyuanBody = await hunyuanStatus.json();
  assert.equal(typeof hunyuanBody.online, "boolean");
  assert.match(hunyuanBody.endpoint, /^http/);
  delete process.env.LOCAL_COURSE_STUDIO_ENABLED;

  const missingCourse = await fetch(`${base}/api/platform-admin/courses/missing-course/status`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "published" })
  });
  assert.equal(missingCourse.status, 404);
  const logsResponse = await fetch(`${base}/api/platform-admin/logs`, { headers: { Cookie: cookie } });
  assert.equal(logsResponse.status, 200);
  const logs = await logsResponse.json();
  const mutationLogs = logs.filter((entry) => entry.action === "course.restore");
  assert.deepEqual(mutationLogs.map((entry) => entry.status).sort(), ["failure", "started"]);
  assert.equal(mutationLogs.find((entry) => entry.status === "failure")?.metadata.statusCode, 404);
  delete process.env.PLATFORM_ADMIN_USERNAMES;
});
