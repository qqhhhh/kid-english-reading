import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { listeningPort, responseJson } from "../test-support/helpers.js";

interface HostRequestOptions {
  port: number;
  path: string;
  host: string;
  accept: string;
  cookie?: string;
}

interface HostResponse {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
}

interface ErrorResponse {
  error: string;
}

process.env.KID_READING_DB_PATH = ":memory:";
process.env.NODE_ENV = "production";
process.env.AUTH_COOKIE_DOMAIN = ".qiangzihang.com";
process.env.PRIMARY_AUTH_HOSTS = "qiangzihang.com,www.qiangzihang.com";
process.env.PRIMARY_AUTH_ORIGIN = "https://www.qiangzihang.com";

const { app } = await import("../server/index.js");
const {
  createParentSession,
  createRegistrationKey,
  readParentSession,
  registerParent,
  setChildSessionCookie,
  setParentSessionCookie
} = await import("../server/parentAuth.js");

function requestWithHost({ port, path, host, accept, cookie = "" }: HostRequestOptions): Promise<HostResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers: { Host: host, Accept: accept, ...(cookie ? { Cookie: cookie } : {}) } },
      (response) => {
        response.resume();
        response.once("end", () => resolve({ status: response.statusCode, headers: response.headers }));
      }
    );
    request.once("error", reject);
    request.end();
  });
}

test("production session cookies are shared across the configured domain", () => {
  const parentHeaders = new Map<string, string | string[]>();
  setParentSessionCookie({ setHeader: (name, value) => parentHeaders.set(name, value) }, "parent-token");
  const parentCookies = parentHeaders.get("Set-Cookie");
  assert.ok(Array.isArray(parentCookies));
  assert.equal(parentCookies.length, 2);
  assert.doesNotMatch(parentCookies[0], /Domain=/);
  assert.match(parentCookies[0], /Max-Age=0/);
  assert.match(parentCookies[1], /Domain=\.qiangzihang\.com/);
  assert.match(parentCookies[1], /; Secure/);

  const childHeaders: string[] = [];
  setChildSessionCookie({ append: (_name, value) => { childHeaders.push(value); } }, "child-token");
  assert.equal(childHeaders.length, 2);
  assert.doesNotMatch(childHeaders[0], /Domain=/);
  assert.match(childHeaders[0], /Max-Age=0/);
  assert.match(childHeaders[1], /Domain=\.qiangzihang\.com/);
  assert.match(childHeaders[1], /; Secure/);
});

test("a stale host-only cookie cannot hide a valid shared-domain session", async () => {
  const registrationKey = createRegistrationKey({ label: "duplicate cookie test" }).key;
  const user = await registerParent({
    registrationKey,
    username: "duplicate_cookie_parent",
    password: "duplicate-cookie-password",
    householdName: "Duplicate cookie household"
  });
  const valid = createParentSession(user.id);
  const request = {
    headers: {
      cookie: `kid_parent_session=stale-host-cookie; kid_parent_session=${encodeURIComponent(valid.token)}`
    }
  };
  assert.equal(readParentSession(request)?.username, "duplicate_cookie_parent");
});

test("an unauthenticated secondary hostname redirects HTML navigation to the primary login", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = listeningPort(server);

  const secondary = await requestWithHost({
    port,
    path: "/practice?lesson=1",
    host: "learn.qiangzihang.com",
    accept: "text/html"
  });
  assert.equal(secondary.status, 302);
  assert.equal(
    secondary.headers.location,
    "https://www.qiangzihang.com/login?next=%2Fpractice%3Flesson%3D1"
  );

  const primary = await requestWithHost({
    port,
    path: "/practice",
    host: "www.qiangzihang.com",
    accept: "text/html"
  });
  assert.notEqual(primary.status, 302);

  const api = await requestWithHost({
    port,
    path: "/api/auth/session",
    host: "learn.qiangzihang.com",
    accept: "application/json"
  });
  assert.equal(api.status, 200);
});

test("production admin navigation is protected before the application shell is served", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = listeningPort(server);

  const unauthenticated = await requestWithHost({ port, path: "/admin", host: "www.qiangzihang.com", accept: "text/html" });
  assert.equal(unauthenticated.status, 302);
  assert.equal(unauthenticated.headers.location, "https://www.qiangzihang.com/login?next=%2Fadmin");

  const key = createRegistrationKey({ label: "admin page protection" }).key;
  const user = await registerParent({ registrationKey: key, username: "admin_guard_parent", password: "admin-guard-password", householdName: "Guard household" });
  const session = createParentSession(user.id);
  const cookie = `kid_parent_session=${encodeURIComponent(session.token)}`;
  const ordinaryParent = await requestWithHost({ port, path: "/admin", host: "www.qiangzihang.com", accept: "text/html", cookie });
  assert.equal(ordinaryParent.status, 302);
  assert.equal(ordinaryParent.headers.location, "/parent");

  process.env.PLATFORM_ADMIN_USERNAMES = "admin_guard_parent";
  const administrator = await requestWithHost({ port, path: "/admin", host: "www.qiangzihang.com", accept: "text/html", cookie });
  assert.equal(administrator.status, 200);
  const unverifiedMutation = await fetch(`http://127.0.0.1:${port}/api/platform-admin/registration-keys/batch`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: 1, expiresInHours: 24 })
  });
  assert.equal(unverifiedMutation.status, 403);
  assert.equal((await responseJson<ErrorResponse>(unverifiedMutation)).error, "ADMIN_REQUEST_VERIFICATION_REQUIRED");
  const verifiedMutation = await fetch(`http://127.0.0.1:${port}/api/platform-admin/registration-keys/batch`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", "X-Admin-Request": "1" },
    body: JSON.stringify({ quantity: 1, expiresInHours: 24 })
  });
  assert.equal(verifiedMutation.status, 201);
  delete process.env.PLATFORM_ADMIN_USERNAMES;
});
