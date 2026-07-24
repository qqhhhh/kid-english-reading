import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

interface FailureBucket {
  timestamps: number[];
  lastSeenAt: number;
}

interface AuthRateLimitOptions {
  windowMs?: number;
  ipFailureLimit?: number;
  identityFailureLimit?: number;
  maxBuckets?: number;
  now?: () => number;
}

interface RateLimitKey {
  key: string;
  limit: number;
}

const defaultWindowMs = 15 * 60 * 1000;
const defaultIpFailureLimit = 60;
const defaultIdentityFailureLimit = 12;
const defaultMaxBuckets = 20_000;

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function requestBody(request: Request): Record<string, unknown> {
  return request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

function normalizedIdentity(request: Request): string {
  const body = requestBody(request);
  if (request.path.endsWith("/login") || request.path.endsWith("/register")) {
    return String(body.username || "").trim().toLocaleLowerCase();
  }
  if (request.path.endsWith("/child-pair")) {
    return String(body.code || "").trim().toLocaleUpperCase();
  }
  return "";
}

function hashIdentity(route: string, identity: string): string {
  return createHash("sha256").update(`${route}\0${identity}`).digest("hex");
}

function clientAddress(request: Request): string {
  return String(request.ip || request.socket.remoteAddress || "unknown").trim().toLocaleLowerCase();
}

function shouldRecordFailure(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500 && statusCode !== 429;
}

/**
 * Authentication failures are limited independently by real client address and
 * by a one-way hash of the submitted identity. Successful requests never spend
 * the failure budget, and the bounded store cannot grow indefinitely.
 */
export function createAuthRateLimit(options: AuthRateLimitOptions = {}): RequestHandler {
  const windowMs = positiveInteger(options.windowMs, defaultWindowMs);
  const ipFailureLimit = positiveInteger(options.ipFailureLimit, defaultIpFailureLimit);
  const identityFailureLimit = positiveInteger(options.identityFailureLimit, defaultIdentityFailureLimit);
  const maxBuckets = positiveInteger(options.maxBuckets, defaultMaxBuckets);
  const now = options.now || Date.now;
  const failures = new Map<string, FailureBucket>();
  let lastSweepAt = 0;

  function recentTimestamps(key: string, currentTime: number): number[] {
    const bucket = failures.get(key);
    if (!bucket) return [];
    const timestamps = bucket.timestamps.filter((timestamp) => currentTime - timestamp < windowMs);
    if (timestamps.length === 0) {
      failures.delete(key);
      return [];
    }
    bucket.timestamps = timestamps;
    bucket.lastSeenAt = currentTime;
    return timestamps;
  }

  function sweep(currentTime: number): void {
    if (failures.size <= maxBuckets && currentTime - lastSweepAt < windowMs) return;
    lastSweepAt = currentTime;
    for (const key of failures.keys()) recentTimestamps(key, currentTime);
    while (failures.size > maxBuckets) {
      const oldestKey = failures.keys().next().value as string | undefined;
      if (!oldestKey) break;
      failures.delete(oldestKey);
    }
  }

  function keysFor(request: Request): RateLimitKey[] {
    const keys: RateLimitKey[] = [{
      key: `ip:${clientAddress(request)}`,
      limit: ipFailureLimit
    }];
    const identity = normalizedIdentity(request);
    if (identity) {
      keys.push({
        key: `identity:${hashIdentity(request.path, identity)}`,
        limit: identityFailureLimit
      });
    }
    return keys;
  }

  return function authRateLimit(request: Request, response: Response, next: NextFunction): void {
    const currentTime = now();
    sweep(currentTime);
    const rateLimitKeys = keysFor(request);
    for (const item of rateLimitKeys) {
      const timestamps = recentTimestamps(item.key, currentTime);
      if (timestamps.length < item.limit) continue;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (currentTime - timestamps[0])) / 1000));
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({ error: "AUTH_RATE_LIMITED" });
      return;
    }

    response.once("finish", () => {
      if (!shouldRecordFailure(response.statusCode)) return;
      const failureTime = now();
      for (const item of rateLimitKeys) {
        const timestamps = recentTimestamps(item.key, failureTime);
        timestamps.push(failureTime);
        failures.delete(item.key);
        failures.set(item.key, { timestamps, lastSeenAt: failureTime });
      }
      sweep(failureTime);
    });
    next();
  };
}
