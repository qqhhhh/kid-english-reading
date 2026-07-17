import type { HunyuanOcrServiceStatus } from "./types";

export type PaddleOcrServiceStatus = HunyuanOcrServiceStatus & {
  device: string;
};

export async function fetchPaddleOcrStatus(): Promise<PaddleOcrServiceStatus> {
  const response = await fetch("/api/platform-admin/paddle-ocr/status");
  if (!response.ok) throw new Error(response.status === 403 ? "PLATFORM_ADMIN_REQUIRED" : "Unable to load PaddleOCR status");
  return response.json();
}

export async function controlPaddleOcr(action: "start" | "stop"): Promise<PaddleOcrServiceStatus> {
  const response = await fetch(`/api/platform-admin/paddle-ocr/${action}`, {
    method: "POST",
    headers: { "X-Admin-Request": "1" }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || `Unable to ${action} PaddleOCR`));
  return body;
}
