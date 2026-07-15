import { randomBytes, randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import {
  generateRegistrationKey,
  hashParentPassword,
  normalizeRegistrationKey,
  normalizeUsername,
  sha256,
  validateParentCredentials,
  verifyParentPassword
} from "./authCrypto.js";
import {
  createAuthSessionRecord,
  createChildPairingCodeRecord,
  createRegistrationKeyRecord,
  findAuthSessionByTokenHash,
  findChildDeviceSessionByTokenHash,
  findParentUserByUsername,
  registerParentWithKey,
  revokeAuthSessionByTokenHash,
  consumeChildPairingCode,
  revokeChildDeviceSessionByTokenHash
} from "./db.js";

const sessionCookieName = "kid_parent_session";
const sessionDurationSeconds = 60 * 60 * 24 * 30;
const childSessionCookieName = "kid_child_session";
const childSessionDurationSeconds = 60 * 60 * 24 * 90;
const reviewSessionCookieName = "kid_filing_review_session";
const reviewSessionDurationSeconds = 60 * 60 * 2;
const reviewSessions = new Map();

function sessionCookieDomainAttribute() {
  const configured = String(process.env.AUTH_COOKIE_DOMAIN || "").trim().toLowerCase();
  if (!configured || configured === "localhost") return "";
  if (!/^\.?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(configured) || configured.includes("..")) return "";
  return `; Domain=${configured}`;
}

function configuredPlatformAdminUsernames() {
  return new Set(
    String(process.env.PLATFORM_ADMIN_USERNAMES || "")
      .split(",")
      .map((username) => normalizeUsername(username))
      .filter(Boolean)
  );
}

export function isPlatformAdminSession(session) {
  if (!session || session.kind === "child") return false;
  return session.role === "platform_admin" || configuredPlatformAdminUsernames().has(normalizeUsername(session.username));
}

export function createRegistrationKey({
  label = "",
  note = "",
  maxUses = 1,
  expiresAt = null,
  batchId = "",
  createdByUserId = ""
} = {}) {
  const key = generateRegistrationKey();
  const normalizedKey = normalizeRegistrationKey(key);
  const record = createRegistrationKeyRecord({
    id: `registration-key-${nanoid(12)}`,
    keyHash: sha256(normalizedKey),
    keyPrefix: key.slice(0, 8),
    batchId,
    label,
    note,
    maxUses,
    expiresAt,
    createdByUserId
  });
  return { ...record, key };
}

export async function registerParent({ registrationKey, username, password, householdName = "" }) {
  const normalizedUsername = normalizeUsername(username);
  const validationError = validateParentCredentials(normalizedUsername, password);
  if (validationError) throw new Error(validationError);
  const normalizedKey = normalizeRegistrationKey(registrationKey);
  if (normalizedKey.length < 12) throw new Error("REGISTRATION_KEY_INVALID");
  const passwordHash = await hashParentPassword(password);
  try {
    return registerParentWithKey({
      keyHash: sha256(normalizedKey),
      householdId: `household-${nanoid(12)}`,
      householdName: String(householdName || "").trim().slice(0, 40) || `${normalizedUsername}的家庭`,
      userId: `parent-${nanoid(12)}`,
      username: normalizedUsername,
      passwordHash
    });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE constraint failed: parent_users.username")) {
      throw new Error("USERNAME_TAKEN");
    }
    throw error;
  }
}

export async function authenticateParent(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const validationError = validateParentCredentials(normalizedUsername, password);
  if (validationError) return null;
  const user = findParentUserByUsername(normalizedUsername);
  if (!user || user.status !== "active") return null;
  return (await verifyParentPassword(password, user.passwordHash)) ? user : null;
}

export function createParentSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000).toISOString();
  createAuthSessionRecord({ id: `session-${nanoid(12)}`, userId, tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

function readCookieValues(request, name) {
  return String(request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0 || part.slice(0, separatorIndex) !== name) return [];
      const rawValue = part.slice(separatorIndex + 1);
      if (!rawValue) return [];
      try {
        return [decodeURIComponent(rawValue)];
      } catch {
        return [];
      }
    });
}

function sessionCookie(name, value, maxAge, { includeDomain = true } = {}) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const domain = includeDomain ? sessionCookieDomainAttribute() : "";
  return `${name}=${value ? encodeURIComponent(value) : ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}${domain}`;
}

function sessionCookiesWithLegacyCleanup(name, value, maxAge) {
  if (!sessionCookieDomainAttribute()) return sessionCookie(name, value, maxAge);
  return [
    sessionCookie(name, "", 0, { includeDomain: false }),
    sessionCookie(name, value, maxAge)
  ];
}

function clearedSessionCookies(name) {
  if (!sessionCookieDomainAttribute()) return sessionCookie(name, "", 0);
  return [
    sessionCookie(name, "", 0, { includeDomain: false }),
    sessionCookie(name, "", 0)
  ];
}

export function readParentSession(request) {
  for (const token of readCookieValues(request, sessionCookieName)) {
    const session = findAuthSessionByTokenHash(sha256(token));
    if (session) return session;
  }
  return null;
}

export function revokeParentSession(request) {
  for (const token of readCookieValues(request, sessionCookieName)) {
    revokeAuthSessionByTokenHash(sha256(token));
  }
}

export function setParentSessionCookie(response, token) {
  response.setHeader("Set-Cookie", sessionCookiesWithLegacyCleanup(sessionCookieName, token, sessionDurationSeconds));
}

export function clearParentSessionCookie(response) {
  response.setHeader("Set-Cookie", clearedSessionCookies(sessionCookieName));
}

export function publicParentSession(session) {
  if (!session) return null;
  return {
    kind: "parent",
    user: {
      id: session.id,
      username: session.username,
      role: isPlatformAdminSession(session) ? "platform_admin" : session.role
    },
    household: {
      id: session.householdId,
      name: session.householdName
    }
  };
}

export function createChildPairingCode({ householdId, childId, createdByUserId }) {
  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  createChildPairingCodeRecord({ id: `pair-${nanoid(12)}`, householdId, childId, codeHash: sha256(code), expiresAt, createdByUserId });
  return { code, childId, expiresAt };
}

export function pairChildDevice({ code, label = "" }) {
  const normalizedCode = String(code || "").replace(/\D/g, "");
  if (normalizedCode.length !== 6) throw new Error("CHILD_PAIR_CODE_INVALID");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + childSessionDurationSeconds * 1000).toISOString();
  const session = consumeChildPairingCode({ codeHash: sha256(normalizedCode), sessionId: `child-session-${nanoid(12)}`, tokenHash: sha256(token), expiresAt, label });
  return { token, session };
}

export function readChildSession(request) {
  for (const token of readCookieValues(request, childSessionCookieName)) {
    const session = findChildDeviceSessionByTokenHash(sha256(token));
    if (session) return session;
  }
  return null;
}

export function readAccessSession(request) {
  const review = readReviewSession(request);
  if (review) return review;
  const parent = readParentSession(request);
  if (parent) return { ...parent, kind: "parent" };
  const child = readChildSession(request);
  if (child) return { ...child, kind: "child" };
  return null;
}

export function readReviewSession(request) {
  const now = Date.now();
  for (const token of readCookieValues(request, reviewSessionCookieName)) {
    const tokenHash = sha256(token);
    const expiresAt = reviewSessions.get(tokenHash) || 0;
    if (expiresAt > now) {
      return {
        kind: "review",
        householdId: "filing-review-household",
        householdName: "体验家庭",
        childId: "filing-review-child",
        childName: "体验学生",
        sessionId: "filing-review-session",
        label: "体验设备"
      };
    }
    if (expiresAt) reviewSessions.delete(tokenHash);
  }
  return null;
}

export function setReviewSessionCookie(response) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  for (const [tokenHash, expiresAt] of reviewSessions) {
    if (expiresAt <= now) reviewSessions.delete(tokenHash);
  }
  reviewSessions.set(sha256(token), now + reviewSessionDurationSeconds * 1000);
  const cookies = sessionCookiesWithLegacyCleanup(reviewSessionCookieName, token, reviewSessionDurationSeconds);
  for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) response.append("Set-Cookie", cookie);
}

export function clearReviewSessionCookie(response) {
  const cookies = clearedSessionCookies(reviewSessionCookieName);
  for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) response.append("Set-Cookie", cookie);
}

export function revokeChildSession(request) {
  for (const token of readCookieValues(request, childSessionCookieName)) {
    revokeChildDeviceSessionByTokenHash(sha256(token));
  }
}

export function setChildSessionCookie(response, token) {
  const cookies = sessionCookiesWithLegacyCleanup(childSessionCookieName, token, childSessionDurationSeconds);
  for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) response.append("Set-Cookie", cookie);
}

export function clearChildSessionCookie(response) {
  const cookies = clearedSessionCookies(childSessionCookieName);
  for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) response.append("Set-Cookie", cookie);
}

export function publicAccessSession(session) {
  if (!session) return null;
  if (session.kind === "parent" || session.username) return publicParentSession(session);
  return {
    kind: "child",
    child: { id: session.childId, name: session.childName },
    household: { id: session.householdId, name: session.householdName },
    device: { id: session.sessionId, label: session.label || "" },
    ...(session.kind === "review" ? { reviewOnly: true } : {})
  };
}
