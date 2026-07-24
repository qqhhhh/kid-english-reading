import cors from "cors";
import type { Application, NextFunction, Request, Response } from "express";
import express from "express";
import { nanoid } from "nanoid";
import { createPlatformAdminAuditLog } from "../db.js";
import { isFilingReviewSentenceText, sendFilingReviewReadModel } from "../filingReviewSandbox.js";
import { createAuthRateLimit } from "./authRateLimit.js";
import {
  configuredCorsOrigins,
  createTrustedMutationOriginGuard,
  isAllowedCorsOrigin
} from "./originPolicy.js";
import {
  authenticateParent,
  clearChildSessionCookie,
  clearParentSessionCookie,
  clearReviewSessionCookie,
  createParentSession,
  isPlatformAdminSession,
  pairChildDevice,
  publicAccessSession,
  publicParentSession,
  readAccessSession,
  registerParent,
  revokeChildSession,
  revokeParentSession,
  setChildSessionCookie,
  setParentSessionCookie,
  setReviewSessionCookie
} from "../parentAuth.js";

interface PlatformAdminAuditInput {
  action: string;
  status: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

interface PlatformAdminMutationDescription {
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformAdminAuditHandle {
  addMetadata(metadata?: Record<string, unknown>): void;
}

const filingReviewAttemptTimes = new Map<string, number[]>();
const checkAuthRateLimit = createAuthRateLimit();

function reviewAttemptAllowed(request: Request): boolean {
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (filingReviewAttemptTimes.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (recent.length >= 20) return false;
  recent.push(now);
  filingReviewAttemptTimes.set(key, recent);
  return true;
}

function sendAuthError(response: Response, error: unknown): void {
  const code = String(error instanceof Error ? error.message : "AUTH_FAILED");
  const knownCodes = new Set([
    "USERNAME_INVALID",
    "USERNAME_TAKEN",
    "PASSWORD_INVALID",
    "REGISTRATION_KEY_INVALID",
    "REGISTRATION_KEY_EXPIRED",
    "REGISTRATION_KEY_USED"
  ]);
  response.status(knownCodes.has(code) ? 400 : 500).json({ error: knownCodes.has(code) ? code : "AUTH_FAILED" });
}

function writePlatformAdminAudit(
  request: Request,
  { action, status, summary, metadata = {} }: PlatformAdminAuditInput
): void {
  try {
    createPlatformAdminAuditLog({
      id: `admin-audit-${nanoid(14)}`,
      actorUserId: request.parentSession?.kind === "parent" ? request.parentSession.id : "",
      actorUsername: request.parentSession?.kind === "parent" ? request.parentSession.username : "unknown",
      action,
      status,
      summary,
      metadata
    });
  } catch (error) {
    console.error("[platform-admin-audit] unable to persist log", error);
  }
}

export function beginPlatformAdminAudit(
  request: Request,
  response: Response,
  { action, summary, metadata = {} }: PlatformAdminMutationDescription
): PlatformAdminAuditHandle {
  const startedAt = Date.now();
  const baseMetadata: Record<string, unknown> = {
    method: request.method,
    path: String(request.originalUrl || request.path || "").split("?")[0],
    ...metadata
  };
  writePlatformAdminAudit(request, {
    action,
    status: "started",
    summary: `${summary}：开始`,
    metadata: baseMetadata
  });
  response.once("finish", () => {
    const succeeded = response.statusCode < 400;
    writePlatformAdminAudit(request, {
      action,
      status: succeeded ? "success" : "failure",
      summary: `${summary}：${succeeded ? "完成" : "失败"}`,
      metadata: {
        ...baseMetadata,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      }
    });
  });
  return {
    addMetadata(nextMetadata: Record<string, unknown> = {}) {
      Object.assign(baseMetadata, nextMetadata);
    }
  };
}

function describePlatformAdminMutation(request: Request): PlatformAdminMutationDescription | null {
  if (request.method === "POST" && request.path === "/registration-keys/batch") {
    const quantity = Math.min(100, Math.max(1, Number(request.body?.quantity) || 1));
    return {
      action: "registration-key.batch.create",
      summary: `批量生成 ${quantity} 个注册 Key`,
      metadata: { quantity }
    };
  }
  if (request.method === "PATCH" && /^\/registration-keys\/[^/]+$/.test(request.path)) {
    const keyId = decodeURIComponent(request.path.split("/")[2] || "").slice(0, 100);
    return { action: "registration-key.note.update", summary: "更新注册 Key 备注", metadata: { keyId } };
  }
  if (request.method === "POST" && /^\/registration-keys\/[^/]+\/disable$/.test(request.path)) {
    const keyId = decodeURIComponent(request.path.split("/")[2] || "").slice(0, 100);
    return { action: "registration-key.disable", summary: "停用注册 Key", metadata: { keyId } };
  }
  if (request.method === "POST" && request.path === "/hunyuan-ocr/start") {
    return { action: "hunyuan.start", summary: "启动 HunyuanOCR" };
  }
  if (request.method === "POST" && request.path === "/hunyuan-ocr/stop") {
    return { action: "hunyuan.stop", summary: "停止 HunyuanOCR" };
  }
  if (request.method === "POST" && request.path === "/paddle-ocr/start") {
    return { action: "paddle.start", summary: "启动 PaddleOCR" };
  }
  if (request.method === "POST" && request.path === "/paddle-ocr/stop") {
    return { action: "paddle.stop", summary: "停止 PaddleOCR" };
  }
  if (request.method === "POST" && request.path === "/courses") {
    const title = String(request.body?.title || "未命名课程").trim().slice(0, 100);
    const isVersion = Boolean(String(request.body?.resourceId || "").trim());
    return {
      action: isVersion ? "course.version.publish" : "course.publish",
      summary: `${isVersion ? "发布课程新版本" : "发布官方课程"}《${title}》`,
      metadata: {
        resourceId: String(request.body?.resourceId || "").slice(0, 100),
        importId: String(request.body?.importId || "").slice(0, 100)
      }
    };
  }
  if (request.method === "POST" && request.path === "/course-sync/send") {
    const title = String(request.body?.title || "未命名课程").trim().slice(0, 100);
    return {
      action: "course.sync.send",
      summary: `同步课程草稿《${title}》到服务器`,
      metadata: { importId: String(request.body?.importId || "").slice(0, 100) }
    };
  }
  if (request.method === "POST" && /^\/course-sync\/drafts\/[^/]+\/publish$/.test(request.path)) {
    const draftId = decodeURIComponent(request.path.split("/")[3] || "").slice(0, 100);
    return {
      action: "course.sync.publish",
      summary: `发布服务器课程草稿 ${draftId}`,
      metadata: { draftId }
    };
  }
  if (request.method === "PATCH" && /^\/courses\/[^/]+\/status$/.test(request.path)) {
    const status = request.body?.status === "published" ? "published" : "unpublished";
    const resourceId = decodeURIComponent(request.path.split("/")[2] || "").slice(0, 100);
    return {
      action: status === "published" ? "course.restore" : "course.unpublish",
      summary: `${status === "published" ? "恢复" : "下架"}官方课程 ${resourceId}`,
      metadata: { resourceId, requestedStatus: status }
    };
  }
  return null;
}

export function requireLocalCourseStudio(request: Request, response: Response, next: NextFunction): void {
  const enabled = ["1", "true", "yes"].includes(
    String(process.env.LOCAL_COURSE_STUDIO_ENABLED || "").trim().toLowerCase()
  );
  const remoteAddress = String(request.socket?.remoteAddress || "");
  const loopback = remoteAddress === "127.0.0.1"
    || remoteAddress === "::1"
    || remoteAddress === "::ffff:127.0.0.1";
  if (!enabled || !loopback) {
    response.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  next();
}

export function hasChildAccess(request: Request, childId: string): boolean {
  const session = request.parentSession!;
  return session.kind !== "child" || session.childId === childId;
}

export function registerSecurityAndAuthRoutes(app: Application): void {
  const allowedCorsOrigins = configuredCorsOrigins();
  app.disable("x-powered-by");

  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    if (process.env.NODE_ENV === "production") {
      response.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
      response.setHeader("Content-Security-Policy", [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "form-action 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
        "manifest-src 'self'"
      ].join("; "));
    }
    next();
  });
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin, process.env.NODE_ENV, allowedCorsOrigins));
    }
  }));
  app.use(express.json({ limit: "4mb" }));
  app.use("/api", createTrustedMutationOriginGuard({
    nodeEnv: process.env.NODE_ENV,
    allowedOrigins: allowedCorsOrigins
  }));

  app.get("/api/auth/session", (request, response) => {
    const session = readAccessSession(request);
    response.json({ authenticated: Boolean(session), session: publicAccessSession(session) });
  });

  app.post("/api/auth/filing-review", checkAuthRateLimit, (_request, response) => {
    setReviewSessionCookie(response);
    response.status(201).json({
      authenticated: true,
      session: {
        kind: "child",
        child: { id: "filing-review-child", name: "体验学生" },
        household: { id: "filing-review-household", name: "体验家庭" },
        device: { id: "filing-review-session", label: "体验设备" },
        reviewOnly: true
      }
    });
  });

  app.post("/api/auth/child-pair", checkAuthRateLimit, (request, response) => {
    try {
      const paired = pairChildDevice({ code: request.body.code, label: request.body.label });
      revokeParentSession(request);
      clearParentSessionCookie(response);
      setChildSessionCookie(response, paired.token);
      clearReviewSessionCookie(response);
      response.status(201).json({
        authenticated: true,
        session: publicAccessSession({ ...paired.session, kind: "child" })
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      response.status(400).json({ error: code === "CHILD_PAIR_CODE_INVALID" ? code : "AUTH_FAILED" });
    }
  });

  app.post("/api/auth/register", checkAuthRateLimit, async (request, response) => {
    try {
      const user = await registerParent({
        registrationKey: request.body.registrationKey,
        username: request.body.username,
        password: request.body.password,
        householdName: request.body.householdName
      });
      const session = createParentSession(user.id);
      revokeChildSession(request);
      setParentSessionCookie(response, session.token);
      clearChildSessionCookie(response);
      clearReviewSessionCookie(response);
      response.status(201).json({
        authenticated: true,
        session: publicParentSession({ ...user, id: user.id })
      });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/auth/login", checkAuthRateLimit, async (request, response) => {
    const user = await authenticateParent(request.body.username, request.body.password);
    if (!user) {
      response.status(401).json({ error: "LOGIN_INVALID" });
      return;
    }
    const session = createParentSession(user.id);
    revokeChildSession(request);
    setParentSessionCookie(response, session.token);
    clearChildSessionCookie(response);
    clearReviewSessionCookie(response);
    response.json({ authenticated: true, session: publicParentSession(user) });
  });

  app.post("/api/auth/logout", (request, response) => {
    revokeParentSession(request);
    revokeChildSession(request);
    clearParentSessionCookie(response);
    clearChildSessionCookie(response);
    clearReviewSessionCookie(response);
    response.status(204).end();
  });

  app.use("/api", (request, response, next) => {
    if (request.path === "/health" || request.path === "/tts/voices" || request.path === "/course-sync/packages") {
      next();
      return;
    }
    const session = readAccessSession(request);
    if (!session) {
      response.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    request.parentSession = session;
    if (session.kind === "review") {
      const isEphemeralAttempt = request.method === "POST" && request.path === "/attempts";
      if (isEphemeralAttempt && !reviewAttemptAllowed(request)) {
        response.status(429).json({ error: "REVIEW_RATE_LIMITED" });
        return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isEphemeralAttempt) {
        response.status(403).json({ error: "REVIEW_READ_ONLY" });
        return;
      }
      if (request.path === "/tts/storybook" && !isFilingReviewSentenceText(request.query.text)) {
        response.status(403).json({ error: "REVIEW_CONTENT_RESTRICTED" });
        return;
      }
      if (sendFilingReviewReadModel(request, response)) return;
    }
    next();
  });

  app.use("/api/admin", (request, response, next) => {
    if (request.parentSession!.kind !== "parent") {
      response.status(403).json({ error: "PARENT_AUTH_REQUIRED" });
      return;
    }
    next();
  });

  // Shared content-import entry point used by both the household console and the
  // platform administrator. Keep the legacy /api/admin/import alias while clients migrate.
  app.use("/api/import", (request, response, next) => {
    if (request.parentSession!.kind !== "parent") {
      response.status(403).json({ error: "PARENT_AUTH_REQUIRED" });
      return;
    }
    next();
  });

  app.use("/api/platform-admin", (request, response, next) => {
    if (request.parentSession!.kind !== "parent" || !isPlatformAdminSession(request.parentSession!)) {
      response.status(403).json({ error: "PLATFORM_ADMIN_REQUIRED" });
      return;
    }
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    const audit = describePlatformAdminMutation(request);
    if (audit) beginPlatformAdminAudit(request, response, audit);
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (process.env.NODE_ENV === "production" && mutation && request.get("X-Admin-Request") !== "1") {
      response.status(403).json({ error: "ADMIN_REQUEST_VERIFICATION_REQUIRED" });
      return;
    }
    next();
  });
}
