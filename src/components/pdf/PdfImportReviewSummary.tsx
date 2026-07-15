import type { PdfImportQualityReport } from "../../lib/types";

type PdfImportReviewSummaryProps = {
  quality: PdfImportQualityReport;
  stats?: {
    chapters: number;
    sentences: number;
  };
  warnings?: string[];
  actionLabel?: "保存" | "发布";
};

export function PdfImportReviewSummary({ quality, stats, warnings = [], actionLabel = "保存" }: PdfImportReviewSummaryProps) {
  return (
    <>
      <div className={`platform-quality-summary status-${quality.status}`}>
        <strong>
          {quality.status === "warning"
            ? "存在需要修正的问题"
            : quality.status === "review"
              ? `建议抽查后${actionLabel}`
              : "基础检查通过"}
        </strong>
        <span>
          {stats ? `${stats.chapters} 章 · ${stats.sentences} 项 · ` : ""}
          {quality.coverage?.percent ?? "--"}% 来源覆盖
        </span>
        <small>
          高 {quality.counts.high} / 中 {quality.counts.medium} / 低 {quality.counts.low} · {actionLabel}时会根据修改后的内容重新校验
        </small>
      </div>

      {quality.ocr && (
        <details className="platform-ocr-report" open={quality.ocr.status === "warning" || undefined}>
          <summary>
            <span>
              <strong>页面图像 OCR 复核</strong>
              <small>独立于 PDF 文字层 · {quality.ocr.pagesProcessed}/{quality.ocr.totalPages} 页</small>
            </span>
            <b>{quality.ocr.status === "unavailable" ? "未完成" : `${quality.ocr.tokenAgreement}% 一致`}</b>
          </summary>
          {quality.ocr.status === "unavailable" ? (
            <p>{quality.ocr.message}</p>
          ) : (
            <>
              <div className="platform-ocr-stats">
                <span>建议检查 <b>{quality.ocr.reviewPages.length}</b> 页</span>
                <span>文字层疑似漏内容 <b>{quality.ocr.criticalPages.length}</b> 页</span>
              </div>
              {quality.ocr.pages.filter((page) => page.needsReview).slice(0, 16).map((page) => (
                <article key={page.page}>
                  <strong>第 {page.page} 页</strong>
                  <small>一致率 {page.tokenAgreement}% · OCR 置信度 {page.confidence}%</small>
                  {page.ocrOnly.slice(0, 2).map((line, index) => (
                    <p key={`${page.page}-ocr-${index}`}>OCR 独有：{line.text}</p>
                  ))}
                  {page.pdfOnly.slice(0, 2).map((line, index) => (
                    <p key={`${page.page}-pdf-${index}`}>文字层独有：{line.text}</p>
                  ))}
                </article>
              ))}
            </>
          )}
        </details>
      )}

      {warnings.length > 0 && (
        <details className="platform-pdf-warnings">
          <summary>查看 {warnings.length} 条解析提示</summary>
          {warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}
        </details>
      )}
    </>
  );
}
