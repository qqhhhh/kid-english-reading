import type { NextFunction, Request, RequestHandler, Response } from "express";

export function configuredCorsOrigins(value = process.env.CORS_ALLOWED_ORIGINS || ""): Set<string> {
  const origins = new Set<string>();
  for (const entry of value.split(",")) {
    const candidate = entry.trim();
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${candidate}`);
    }
  }
  return origins;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(
  origin: string | undefined,
  nodeEnv = process.env.NODE_ENV,
  configuredOrigins = configuredCorsOrigins()
): boolean {
  if (!origin) return true;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }
  if (configuredOrigins.has(normalized)) return true;
  return nodeEnv !== "production" && isLoopbackOrigin(normalized);
}

function requestOwnOrigin(request: Request): string {
  return `${request.protocol}://${request.get("host") || ""}`.toLocaleLowerCase();
}

export function createTrustedMutationOriginGuard({
  nodeEnv = process.env.NODE_ENV,
  allowedOrigins = configuredCorsOrigins()
}: {
  nodeEnv?: string;
  allowedOrigins?: Set<string>;
} = {}): RequestHandler {
  return function enforceTrustedMutationOrigin(request: Request, response: Response, next: NextFunction): void {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      next();
      return;
    }

    const origin = request.get("Origin");
    const fetchSite = request.get("Sec-Fetch-Site");
    if (!origin) {
      if (fetchSite === "cross-site") {
        response.status(403).json({ error: "REQUEST_ORIGIN_NOT_ALLOWED" });
        return;
      }
      next();
      return;
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(origin).origin.toLocaleLowerCase();
    } catch {
      response.status(403).json({ error: "REQUEST_ORIGIN_NOT_ALLOWED" });
      return;
    }
    const allowed = normalizedOrigin === requestOwnOrigin(request)
      || allowedOrigins.has(normalizedOrigin)
      || (nodeEnv !== "production" && isLoopbackOrigin(normalizedOrigin));
    if (!allowed) {
      response.status(403).json({ error: "REQUEST_ORIGIN_NOT_ALLOWED" });
      return;
    }
    next();
  };
}
