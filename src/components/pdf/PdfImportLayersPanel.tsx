import { useEffect, useMemo, useState } from "react";

import type { ImportedLessonChapterPreview, PdfImportSnapshot } from "../../lib/types";

type LayerKey = "local" | "upstream" | "differences" | "final";
const pageAssetPageSize = 6;

function chapterItemCount(chapters: ImportedLessonChapterPreview[]) {
  return chapters.reduce((sum, chapter) => sum + (chapter.sentences?.length || 0), 0);
}

function normalizeReviewText(value = "") {
  return value.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
}

export function PdfImportLayersPanel({ snapshot, admin = false, finalChapters }: {
  snapshot: PdfImportSnapshot;
  admin?: boolean;
  finalChapters?: ImportedLessonChapterPreview[];
}) {
  const tabs = useMemo(() => admin
    ? [
        ["local", "原 PDF 本地数据"],
        ["upstream", "上游审核数据"],
        ["differences", "差异数据"],
        ["final", "页面使用数据"]
      ] as const
    : [["local", "原 PDF 本地数据"], ["final", "页面使用数据"]] as const, [admin]);
  const [active, setActive] = useState<LayerKey>("local");
  const [assetPage, setAssetPage] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const resolvedFinalChapters = finalChapters || snapshot.layers.final.chapters;
  const assetPageCount = Math.max(1, Math.ceil(snapshot.pageAssets.length / pageAssetPageSize));
  const visibleAssets = snapshot.pageAssets.slice(assetPage * pageAssetPageSize, (assetPage + 1) * pageAssetPageSize);
  const previewAsset = previewIndex === null ? null : snapshot.pageAssets[previewIndex] || null;
  const previewPage = previewAsset
    ? snapshot.layers.local.pages.find((page) => page.pageNumber === previewAsset.pageNumber) || null
    : null;
  const finalItemTexts = useMemo(() => resolvedFinalChapters.flatMap((chapter) => chapter.sentences || []).map((sentence) => normalizeReviewText(sentence.text)).filter(Boolean), [resolvedFinalChapters]);
  const differencePages = snapshot.layers.differences.items;

  function getBlockUsage(text: string) {
    const normalized = normalizeReviewText(text);
    if (!normalized) return "unused";
    if (finalItemTexts.includes(normalized)) return "used";
    if (normalized.length >= 8 && finalItemTexts.some((item) => item.includes(normalized) || normalized.includes(item))) return "partial";
    return "unused";
  }

  useEffect(() => {
    if (assetPage >= assetPageCount) setAssetPage(assetPageCount - 1);
  }, [assetPage, assetPageCount]);

  useEffect(() => {
    if (previewIndex === null) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewIndex(null);
      if (event.key === "ArrowLeft") setPreviewIndex((current) => current === null ? null : Math.max(0, current - 1));
      if (event.key === "ArrowRight") setPreviewIndex((current) => current === null ? null : Math.min(snapshot.pageAssets.length - 1, current + 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewIndex, snapshot.pageAssets.length]);

  return (
    <section className="pdf-import-layers">
      <header>
        <div><strong>导入数据分层</strong><small>页面图片与每次解析结果已按诊断编号保存，可追溯且不会重复消耗已完成的云校验。</small></div>
        <span>结构 v{snapshot.schemaVersion}</span>
      </header>
      <nav aria-label="PDF 导入数据层">
        {tabs.map(([key, label]) => <button className={active === key ? "is-active" : ""} key={key} onClick={() => setActive(key)} type="button">{label}</button>)}
      </nav>

      {active === "local" && (
        <div className="pdf-layer-body">
          <div className="pdf-layer-stats"><span><b>{snapshot.pageAssets.length}</b> 页图片</span><span><b>{snapshot.layers.local.chapters.length}</b> 章</span><span><b>{chapterItemCount(snapshot.layers.local.chapters)}</b> 项</span></div>
          <p>来源：PDF 文字层、坐标布局和本地 OCR。页面图片是后续设置课程封面或插图的基础资源。</p>
          <div className="pdf-page-assets">
            {visibleAssets.map((asset, index) => (
              <figure key={asset.id}>
                <button aria-label={`预览 PDF 第 ${asset.pageNumber} 页`} onClick={() => setPreviewIndex(assetPage * pageAssetPageSize + index)} type="button">
                  <img alt={`PDF 第 ${asset.pageNumber} 页`} loading="lazy" src={asset.url} />
                </button>
                <figcaption>第 {asset.pageNumber} 页 <small>点击预览 · 可作封面/插图</small></figcaption>
              </figure>
            ))}
          </div>
          {snapshot.pageAssets.length > pageAssetPageSize && (
            <div className="pdf-page-pagination" aria-label="PDF 页面图片分页">
              <button disabled={assetPage === 0} onClick={() => setAssetPage((page) => Math.max(0, page - 1))} type="button">← 上一组</button>
              <span>第 {assetPage + 1} / {assetPageCount} 组 · 每组 6 页</span>
              <button disabled={assetPage >= assetPageCount - 1} onClick={() => setAssetPage((page) => Math.min(assetPageCount - 1, page + 1))} type="button">下一组 →</button>
            </div>
          )}
        </div>
      )}

      {active === "upstream" && admin && (
        <div className="pdf-layer-body">
          {snapshot.layers.upstream.providers.length === 0 && !snapshot.layers.upstream.visualReview && <p>本次没有配置上游审核服务，本地结果仍可继续使用。</p>}
          {snapshot.layers.upstream.providers.map((provider) => (
            <article className={`pdf-provider-card status-${provider.status}`} key={provider.provider}>
              <strong>{provider.provider}{provider.advisory ? " · 仅建议" : ""}</strong><span>{provider.status === "unavailable" ? "未完成" : `${provider.pagesProcessed}/${provider.totalPages} 页`}</span>
              <small>{provider.message || `已保留 ${provider.pages.length} 页的标准化审核数据`}</small>
              {provider.detail && <details><summary>技术详情</summary><p>{provider.detail}</p></details>}
            </article>
          ))}
          {snapshot.layers.upstream.visualReview && <article className={`pdf-provider-card status-${snapshot.layers.upstream.visualReview.status}`}><strong>{snapshot.layers.upstream.visualReview.provider}</strong><span>{snapshot.layers.upstream.visualReview.status === "unavailable" ? "未完成" : `${snapshot.layers.upstream.visualReview.pagesProcessed}/${snapshot.layers.upstream.visualReview.totalPages} 页`}</span><small>{snapshot.layers.upstream.visualReview.message || "视觉复核结论已保存"}</small></article>}
        </div>
      )}

      {active === "differences" && admin && (
        <div className="pdf-layer-body">
          <div className="pdf-layer-stats"><span><b>{snapshot.layers.differences.total}</b> 条差异</span><span><b>{snapshot.layers.differences.pages.length}</b> 个页面</span><span><b>{snapshot.layers.differences.pending}</b> 待确认</span></div>
          {snapshot.layers.differences.items.length === 0 ? <p>当前上游结果与本地结果没有生成待处理差异。</p> : (
            <div className="pdf-difference-list">{snapshot.layers.differences.items.slice(0, 40).map((item) => <article key={item.id}><span>第 {item.pageNumber} 页 · {item.provider}</span><strong>{item.kind}</strong>{item.localText && <p>本地：{item.localText}</p>}{item.upstreamText && <p>上游：{item.upstreamText}</p>}</article>)}</div>
          )}
        </div>
      )}

      {active === "final" && (
        <div className="pdf-layer-body">
          <div className="pdf-layer-stats"><span><b>{resolvedFinalChapters.length}</b> 章</span><span><b>{chapterItemCount(resolvedFinalChapters)}</b> 项</span><span><b>{snapshot.layers.final.verifiedBy.length}</b> 个可用上游</span></div>
          <p>{snapshot.layers.final.reviewStatus === "pending-review" ? "页面当前使用本地结果作为底稿；上游差异只提示，需确认或人工修改后才进入最终课程。" : "本地结果与可用上游审核结果一致，可作为页面展示数据。"}</p>
          <div className="pdf-final-outline">{resolvedFinalChapters.map((chapter) => <span key={chapter.id}><strong>{chapter.title}</strong><small>{chapter.sentences.length} 项</small></span>)}</div>
        </div>
      )}

      {previewAsset && previewIndex !== null && (
        <div
          aria-label={`PDF 第 ${previewAsset.pageNumber} 页大图预览`}
          aria-modal="true"
          className="pdf-page-lightbox"
          onClick={(event) => {
            const midpoint = window.innerWidth / 2;
            setPreviewIndex((current) => current === null
              ? null
              : event.clientX < midpoint
                ? Math.max(0, current - 1)
                : Math.min(snapshot.pageAssets.length - 1, current + 1));
          }}
          role="dialog"
        >
          <header onClick={(event) => event.stopPropagation()}>
            <strong>第 {previewAsset.pageNumber} 页</strong>
            <span>{previewIndex + 1} / {snapshot.pageAssets.length} · 左侧原页 / 右侧提取内容 · ← → 翻页 · Esc 关闭</span>
            <button aria-label="关闭图片预览" onClick={() => setPreviewIndex(null)} type="button">×</button>
          </header>
          <button className="pdf-lightbox-arrow is-left" disabled={previewIndex === 0} onClick={(event) => { event.stopPropagation(); setPreviewIndex((current) => current === null ? null : Math.max(0, current - 1)); }} type="button">‹</button>
          <div className="pdf-page-review-pair" onClick={(event) => event.stopPropagation()}>
            <div className="pdf-page-review-image" style={{ aspectRatio: `${previewPage?.width || 3} / ${previewPage?.height || 4}` }}><img alt={`PDF 第 ${previewAsset.pageNumber} 页大图`} src={previewAsset.url} /></div>
            <section className="pdf-page-text-review" style={{ aspectRatio: `${previewPage?.width || 3} / ${previewPage?.height || 4}` }}>
              <div className="pdf-page-text-review__legend"><span className="is-used">已使用</span><span className="is-partial">部分匹配</span><span className="is-unused">未进入课程</span></div>
              {(previewPage?.blocks || []).map((block) => {
                const usage = getBlockUsage(block.text);
                const pageHeight = block.pageHeight || previewPage?.height || 1;
                return (
                  <span
                    className={`pdf-page-text-block is-${usage}`}
                    key={block.id}
                    style={{
                      left: "12px",
                      top: `${Math.max(0, Math.min(97, ((block.top || 0) / pageHeight) * 100))}%`,
                      width: "calc(100% - 24px)"
                    }}
                    title={usage === "used" ? "已进入页面使用数据" : usage === "partial" ? "与页面使用数据部分匹配" : "未进入页面使用数据"}
                  >
                    {block.text}<i>{usage === "used" ? "使用" : usage === "partial" ? "部分" : "未用"}</i>
                  </span>
                );
              })}
              {differencePages.filter((item) => item.pageNumber === previewAsset.pageNumber).length > 0 && (
                <aside>本页有 {differencePages.filter((item) => item.pageNumber === previewAsset.pageNumber).length} 条上游差异提示</aside>
              )}
            </section>
          </div>
          <button className="pdf-lightbox-arrow is-right" disabled={previewIndex === snapshot.pageAssets.length - 1} onClick={(event) => { event.stopPropagation(); setPreviewIndex((current) => current === null ? null : Math.min(snapshot.pageAssets.length - 1, current + 1)); }} type="button">›</button>
        </div>
      )}
    </section>
  );
}
