import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function assignRequestId(_request: Request, response: Response, next: NextFunction): void {
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-ID", requestId);
  next();
}

export function handleHttpError(error: unknown, request: Request, response: Response, next: NextFunction): void {
  if (response.headersSent) {
    next(error);
    return;
  }
  const requestId = String(response.locals.requestId || randomUUID());
  const normalized = error instanceof Error ? error : new Error(String(error || "Unknown error"));
  console.error(JSON.stringify({
    level: "error",
    event: "http.request.failed",
    requestId,
    method: request.method,
    path: String(request.originalUrl || request.path || "").split("?")[0],
    errorName: normalized.name,
    message: normalized.message,
    stack: normalized.stack
  }));
  response.status(500).json({ error: "INTERNAL_ERROR", requestId });
}
