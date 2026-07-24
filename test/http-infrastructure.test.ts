import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

import { createAuthRateLimit } from "../server/http/authRateLimit.js";
import { assignRequestId, handleHttpError } from "../server/http/errorHandler.js";
import {
  configuredCorsOrigins,
  createTrustedMutationOriginGuard,
  isAllowedCorsOrigin
} from "../server/http/originPolicy.js";
import { configureTrustedProxy, resolveTrustedProxySetting } from "../server/http/trustedProxy.js";
import { startApplicationServer } from "../server/runtime.js";
import { listeningPort, responseJson } from "../test-support/helpers.js";

test("production trusts only the local reverse proxy by default", async (context) => {
  assert.equal(resolveTrustedProxySetting({ nodeEnv: "production", configuredValue: "" }), "loopback");
  assert.equal(resolveTrustedProxySetting({ nodeEnv: "development", configuredValue: "" }), false);
  assert.throws(
    () => resolveTrustedProxySetting({ nodeEnv: "production", configuredValue: "true" }),
    /unrestricted proxy is unsafe/
  );

  const app = express();
  configureTrustedProxy(app, { nodeEnv: "production", configuredValue: "" });
  app.get("/ip", (request, response) => response.json({ ip: request.ip }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const response = await fetch(`http://127.0.0.1:${listeningPort(server)}/ip`, {
    headers: { "X-Forwarded-For": "203.0.113.42" }
  });
  assert.deepEqual(await responseJson<{ ip: string }>(response), { ip: "203.0.113.42" });
});

test("authentication limits failures without charging successful requests or another client", async (context) => {
  const app = express();
  configureTrustedProxy(app, { nodeEnv: "production", configuredValue: "" });
  app.use(express.json());
  app.post("/api/auth/login", createAuthRateLimit({
    windowMs: 60_000,
    ipFailureLimit: 2,
    identityFailureLimit: 2
  }), (request, response) => {
    response.status(request.body.password === "correct" ? 204 : 401).end();
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${listeningPort(server)}/api/auth/login`;
  const send = (ip: string, username: string, password: string) => fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip
    },
    body: JSON.stringify({ username, password })
  });

  assert.equal((await send("203.0.113.10", "parent-a", "correct")).status, 204);
  assert.equal((await send("203.0.113.10", "parent-a", "correct")).status, 204);
  assert.equal((await send("203.0.113.10", "parent-a", "wrong")).status, 401);
  assert.equal((await send("203.0.113.10", "parent-a", "wrong")).status, 401);
  const blocked = await send("203.0.113.10", "parent-a", "wrong");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  assert.equal((await send("203.0.113.11", "parent-b", "wrong")).status, 401);
});

test("production CORS and mutation checks trust only explicit or same origins", async (context) => {
  const allowedOrigins = configuredCorsOrigins("https://www.example.com");
  assert.equal(isAllowedCorsOrigin("https://www.example.com", "production", allowedOrigins), true);
  assert.equal(isAllowedCorsOrigin("https://unlisted.example.com", "production", allowedOrigins), false);
  assert.equal(isAllowedCorsOrigin("http://127.0.0.1:5173", "development", new Set()), true);

  const app = express();
  app.use(createTrustedMutationOriginGuard({ nodeEnv: "production", allowedOrigins }));
  app.post("/api/change", (_request, response) => response.status(204).end());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${listeningPort(server)}/api/change`;
  assert.equal((await fetch(url, { method: "POST" })).status, 204);
  assert.equal((await fetch(url, {
    method: "POST",
    headers: { Origin: "https://unlisted.example.com" }
  })).status, 403);
  assert.equal((await fetch(url, {
    method: "POST",
    headers: { Origin: "https://www.example.com" }
  })).status, 204);
});

test("unexpected errors expose only a request id to the client", async (context) => {
  const app = express();
  app.use(assignRequestId);
  app.get("/failure", () => {
    throw new Error("secret provider and database detail");
  });
  app.use(handleHttpError);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const response = await fetch(`http://127.0.0.1:${listeningPort(server)}/failure`);
  const body = await responseJson<{ error: string; requestId: string }>(response);
  assert.equal(response.status, 500);
  assert.equal(body.error, "INTERNAL_ERROR");
  assert.equal(body.requestId, response.headers.get("x-request-id"));
  assert.equal(JSON.stringify(body).includes("secret provider"), false);
});

test("application runtime stops accepting requests and runs cleanup", async () => {
  const app = express();
  app.get("/health", (_request, response) => response.json({ ok: true }));
  let cleanedUp = false;
  let attachmentClosed = false;
  const runtime = startApplicationServer({
    app,
    host: "127.0.0.1",
    port: 0,
    installSignalHandlers: false,
    attachServer() {
      return {
        close() {
          attachmentClosed = true;
        }
      };
    },
    cleanup() {
      cleanedUp = true;
    }
  });
  await once(runtime.server, "listening");
  const port = listeningPort(runtime.server);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  await runtime.shutdown("test");
  assert.equal(cleanedUp, true);
  assert.equal(attachmentClosed, true);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
});
