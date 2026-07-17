import type { Request } from "express";
import type { AccessSession, CourseSyncAuth } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      parentSession: AccessSession;
      courseSyncAuth?: CourseSyncAuth;
    }
  }
}

export type AuthenticatedRequest = Request & { parentSession: AccessSession };

export {};
