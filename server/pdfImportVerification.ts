import { auditPdfWithOcr, buildUnavailableOcrAudit } from "./pdfOcrAudit.js";
import { auditPdfWithXfyunOcr } from "./providers/xfyunOcr.js";
import { auditPdfWithHunyuanOcr, probeHunyuanOcr } from "./providers/hunyuanOcr.js";
import { auditPdfWithPaddleOcr, probePaddleOcr } from "./providers/paddleOcr.js";
import type { OcrAudit, OcrVisualReview, PdfLayout } from "./types/pdf.js";

interface VerifyPdfImportOptions {
  layout?: PdfLayout | null;
  totalPages?: number;
}

function configuredProviders(): Set<string> {
  return new Set(
    String(process.env.PDF_IMPORT_VERIFIERS || "tesseract")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function buildCloudPageSelection(localAudit: OcrAudit, totalPages: number): number[] {
  if (String(process.env.PDF_IMPORT_CLOUD_MODE || "review").toLowerCase() === "all") {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const selected = new Set([1, totalPages, ...(localAudit.reviewPages || []), ...(localAudit.criticalPages || [])]);
  for (let page = 10; page < totalPages; page += 10) selected.add(page);
  return [...selected].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}

export function describeOptionalProviderFailure(providerName: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "service unavailable");
  const normalized = raw.toLowerCase();
  let reason = "服务暂时不可用";
  if (/10003|quota|balance|insufficient|计量|余额|额度|欠费/.test(normalized)) reason = "额度不足、欠费或计量失败";
  else if (/401|403|10001|auth|signature|unauthorized|forbidden|鉴权|签名/.test(normalized)) reason = "鉴权或服务授权失败";
  else if (/429|rate.?limit|too many|限流|频率/.test(normalized)) reason = "调用过于频繁或套餐限流";
  else if (/abort|timeout|timed out|超时/.test(normalized)) reason = "调用超时";
  return `${providerName}${reason}，已自动跳过；本地解析和导入可以继续。`;
}

export function optionalProviderErrorDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "service unavailable"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function shouldRetryOptionalProvider(error: unknown): boolean {
  const detail = optionalProviderErrorDetail(error).toLowerCase();
  return !/10001|10003|401|403|quota|balance|insufficient|计量|余额|额度|欠费|鉴权|签名/.test(detail);
}

async function runOptionalProvider<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (!shouldRetryOptionalProvider(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 750));
    return operation();
  }
}

function unavailableProvider(engine: string, error: unknown, totalPages: number): OcrAudit {
  const providerName = engine.startsWith("xfyun")
    ? "讯飞云校验"
    : engine === "hunyuan-ocr-local"
      ? "HunyuanOCR 本地复核"
      : engine === "paddle-ocr-local"
        ? "PaddleOCR 本地复核"
      : engine;
  return {
    ...buildUnavailableOcrAudit(describeOptionalProviderFailure(providerName, error)),
    engine,
    ...(["hunyuan-ocr-local", "paddle-ocr-local"].includes(engine) ? { advisory: true } : {}),
    detail: optionalProviderErrorDetail(error),
    totalPages
  };
}

export function mergeVerificationAudits(
  localAudit: OcrAudit,
  providerAudits: readonly OcrAudit[] = [],
  visualReview: OcrVisualReview | null = null
): OcrAudit {
  const successful = [localAudit, ...providerAudits].filter((audit) => audit && audit.status !== "unavailable");
  const reviewPages = [...new Set(successful.flatMap((audit) => audit.reviewPages || []))].sort((a, b) => a - b);
  const deterministicAudits = successful.filter((audit) => !audit.advisory);
  const criticalPages = [...new Set(deterministicAudits.flatMap((audit) => audit.criticalPages || []))].sort((a, b) => a - b);
  const hasProviderWarning = providerAudits.some((audit) => !audit.advisory && audit.status === "warning");
  const hasProviderReview = providerAudits.some((audit) => audit.status === "review" || (audit.advisory && audit.status === "warning"));
  const visualWarning = visualReview?.status === "warning";
  const visualNeedsReview = visualReview?.status === "review";
  return {
    ...localAudit,
    status: criticalPages.length > 0 || hasProviderWarning
      ? "warning"
      : reviewPages.length > 0 || hasProviderReview || visualWarning || visualNeedsReview
        ? "review"
        : localAudit.status,
    engine: successful.length > 1 ? "multi-provider" : localAudit.engine,
    reviewPages,
    criticalPages,
    providers: [localAudit, ...providerAudits].map((audit) => ({
      engine: audit.engine,
      model: audit.model || "",
      advisory: audit.advisory === true,
      status: audit.status,
      message: audit.message || "",
      detail: audit.detail || "",
      pagesProcessed: audit.pagesProcessed,
      totalPages: audit.totalPages,
      tokenAgreement: audit.tokenAgreement,
      reviewPages: audit.reviewPages || [],
      criticalPages: audit.criticalPages || [],
      pages: audit.pages || []
    })),
    visualReview
  };
}

export async function verifyPdfImport(
  buffer: Buffer,
  { layout = null, totalPages = 0 }: VerifyPdfImportOptions = {}
): Promise<OcrAudit> {
  const providers = configuredProviders();
  let localAudit: OcrAudit;
  try {
    localAudit = await auditPdfWithOcr(buffer, { layout, totalPages });
  } catch (error: unknown) {
    localAudit = buildUnavailableOcrAudit(error instanceof Error ? error.message : String(error || "OCR failed"));
  }
  const pageCount = Math.max(Number(totalPages || 0), Number(localAudit.totalPages || 0));
  const cloudPages = buildCloudPageSelection(localAudit, pageCount);
  const providerTasks: Array<Promise<OcrAudit>> = [];
  const hunyuanAvailable = providers.has("hunyuan") || await probeHunyuanOcr();
  if (hunyuanAvailable) {
    providerTasks.push(runOptionalProvider(() => auditPdfWithHunyuanOcr(buffer, { layout, totalPages: pageCount, pageNumbers: cloudPages }))
      .catch((error) => unavailableProvider("hunyuan-ocr-local", error, pageCount)));
  }
  const paddleAvailable = providers.has("paddle") || await probePaddleOcr({ timeoutMs: 5000 });
  if (paddleAvailable) {
    providerTasks.push(runOptionalProvider(() => auditPdfWithPaddleOcr(buffer, { layout, totalPages: pageCount, pageNumbers: cloudPages }))
      .catch((error) => unavailableProvider("paddle-ocr-local", error, pageCount)));
  } else if (String(process.env.LOCAL_COURSE_STUDIO_ENABLED || "0") === "1") {
    providerTasks.push(Promise.resolve(unavailableProvider("paddle-ocr-local", new Error("PaddleOCR local service is offline"), pageCount)));
  }
  if (providers.has("xfyun")) {
    providerTasks.push(runOptionalProvider(() => auditPdfWithXfyunOcr(buffer, { layout, totalPages: pageCount, pageNumbers: cloudPages }))
      .catch((error) => unavailableProvider("xfyun-multilingual-printed-ocr", error, pageCount)));
  }
  const providerAudits = await Promise.all(providerTasks);
  return mergeVerificationAudits(localAudit, providerAudits, null);
}
