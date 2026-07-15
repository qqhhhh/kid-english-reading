import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kid-reading-platform-pdf-"));
process.env.KID_READING_DB_PATH = ":memory:";
process.env.KID_READING_DATA_DIR = dataDir;
process.env.NODE_ENV = "development";
process.env.PLATFORM_ADMIN_USERNAMES = "pdf_platform_admin";
process.env.LOCAL_COURSE_STUDIO_ENABLED = "1";

const { app } = await import("../server/index.js");
const { createRegistrationKey } = await import("../server/parentAuth.js");

function cookieFrom(response, name) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  return (values.find((value) => value.startsWith(`${name}=`)) || "").split(";")[0];
}

test("platform admin publishes a PDF preview without creating a household lesson", async (context) => {
  context.after(async () => {
    const resolved = path.resolve(dataDir);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(resolved, { recursive: true, force: true });
  });

  const importId = "pdf-20260713102000-testAB12";
  const importDir = path.join(dataDir, "imports", importId);

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const key = createRegistrationKey({ label: "PDF platform publish" }).key;
  const registration = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationKey: key, householdName: "Platform", username: "pdf_platform_admin", password: "route-password" })
  });
  assert.equal(registration.status, 201);
  const registrationBody = await registration.json();
  const cookie = cookieFrom(registration, "kid_parent_session");

  await fs.mkdir(importDir, { recursive: true });
  await fs.writeFile(path.join(importDir, "result.json"), JSON.stringify({ importId, householdId: registrationBody.session.household.id, title: "PDF official test", structure: null }));
  await fs.writeFile(path.join(importDir, "layout.json"), JSON.stringify({ importId, householdId: registrationBody.session.household.id, layout: null }));

  const chapters = [{
    id: "pdf-chapter-1",
    title: "Unit 1",
    text: "Can you help? Yes, I can help you.",
    sections: [{
      id: "pdf-section-1",
      title: "Let's talk",
      type: "lets-talk",
      sentences: [
        { id: "pdf-sentence-1", text: "Can you help?", required: true },
        { id: "pdf-sentence-2", text: "Yes, I can help you.", required: true }
      ]
    }],
    sentences: [
      { id: "pdf-sentence-1", text: "Can you help?", required: true },
      { id: "pdf-sentence-2", text: "Yes, I can help you.", required: true }
    ]
  }];

  const published = await fetch(`${base}/api/platform-admin/courses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      importId,
      chapters,
      title: "PDF official test",
      description: "Published directly from an reviewed PDF preview.",
      level: "Starter",
      language: "English",
      tags: ["PDF"],
      sourceLabel: "Test-owned PDF"
    })
  });
  const publishedText = await published.text();
  assert.equal(published.status, 201, publishedText);
  const resource = JSON.parse(publishedText);
  assert.equal(resource.version, 1);
  assert.equal(resource.sourceLessonId, `official-upload-${importId}`);
  assert.equal(resource.stats.sentences, 2);

  const householdLessons = await fetch(`${base}/api/admin/lessons`, { headers: { Cookie: cookie } }).then((response) => response.json());
  assert.equal(householdLessons.length, 0);
});
