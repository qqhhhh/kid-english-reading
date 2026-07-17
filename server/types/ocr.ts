export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<FetchResponseLike>;

export type OcrLayoutPageLike = PdfLayoutPage;
export type OcrLayoutLike = PdfLayout;

export interface OcrAuditOptions {
  layout?: OcrLayoutLike | null;
  totalPages?: number;
  pageNumbers?: number[] | null;
  maxPages?: number;
}

export interface OcrProviderStatus {
  installed: boolean;
  online: boolean;
  controllable: boolean;
  state: "online" | "offline" | "unavailable";
  endpoint: string;
  port: number;
  model: string;
  device?: string;
  message: string;
}

export interface OcrLineDetail {
  text: string;
  confidence: number;
  polygon?: unknown[];
  words?: OcrLineDetail[];
  box?: unknown;
  wordBoxes?: unknown;
}

export interface RecognizedOcrText {
  text: string;
  lines: string[];
  details?: OcrLineDetail[];
  durationMs?: number;
  confidence?: number;
  engineVersion?: string;
}
import type { PdfLayout, PdfLayoutPage } from "./pdf.js";
