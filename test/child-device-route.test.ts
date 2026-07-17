import assert from "node:assert/strict";
import test from "node:test";
import { listeningPort, responseJson } from "../test-support/helpers.js";

interface ParentSessionResponse {
  session: { household: { id: string } };
}

interface PairingCodeResponse {
  code: string;
}

interface ChildSummary {
  id: string;
}

interface DeviceSummary {
  id: string;
}

process.env.KID_READING_DB_PATH = ":memory:";
process.env.NODE_ENV = "development";

const { app } = await import("../server/index.js");
const { createChild } = await import("../server/db.js");
const { createRegistrationKey } = await import("../server/parentAuth.js");

function cookieFrom(response: Response, name: string): string {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  const source = values.find((value) => value.startsWith(`${name}=`)) || "";
  return source.split(";")[0];
}

test("student login is restricted to one student and becomes invalid immediately after revocation", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = listeningPort(server);
  const base = `http://127.0.0.1:${port}`;

  const registrationKey = createRegistrationKey({ label: "student route test" }).key;
  const registrationResponse = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationKey, householdName: "Student household", username: "student_route_parent", password: "route-password" })
  });
  assert.equal(registrationResponse.status, 201);
  const parentSession = await responseJson<ParentSessionResponse>(registrationResponse);
  const parentCookie = cookieFrom(registrationResponse, "kid_parent_session");
  const householdId = parentSession.session.household.id;
  createChild({ id: "student-route-a", name: "学生甲", householdId });
  createChild({ id: "student-route-b", name: "学生乙", householdId });

  const codeResponse = await fetch(`${base}/api/admin/child-pairing-codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: parentCookie },
    body: JSON.stringify({ childId: "student-route-a" })
  });
  assert.equal(codeResponse.status, 201);
  const { code } = await responseJson<PairingCodeResponse>(codeResponse);

  const pairResponse = await fetch(`${base}/api/auth/child-pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, label: "学生 iPad" })
  });
  assert.equal(pairResponse.status, 201);
  const studentCookie = cookieFrom(pairResponse, "kid_child_session");
  assert.ok(studentCookie);

  const childrenResponse = await fetch(`${base}/api/children`, { headers: { Cookie: studentCookie } });
  assert.deepEqual((await responseJson<ChildSummary[]>(childrenResponse)).map((child) => child.id), ["student-route-a"]);
  assert.equal((await fetch(`${base}/api/admin/child-devices`, { headers: { Cookie: studentCookie } })).status, 403);

  const devicesResponse = await fetch(`${base}/api/admin/child-devices`, { headers: { Cookie: parentCookie } });
  const devices = await responseJson<DeviceSummary[]>(devicesResponse);
  assert.equal(devices.length, 1);
  assert.equal((await fetch(`${base}/api/admin/child-devices/${devices[0]?.id}`, { method: "DELETE", headers: { Cookie: parentCookie } })).status, 204);
  assert.equal((await fetch(`${base}/api/children`, { headers: { Cookie: studentCookie } })).status, 401);
});
