import { ArrowLeft, BookOpen, CheckCircle2, CloudUpload, Cpu, Inbox, Play, RefreshCw, ScrollText, Send, ShieldCheck, Square, Upload, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  fetchOfficialCourses,
  fetchCourseSyncDrafts,
  fetchCourseSyncStatus,
  fetchLatestPdfImportPreview,
  fetchHunyuanOcrStatus,
  fetchPlatformAdminLogs,
  fetchParentSession,
  controlHunyuanOcr,
  previewLessonPdfImport,
  publishOfficialCourse,
  publishCourseSyncDraft,
  syncOfficialCourseToServer,
  updateOfficialCourseStatus
} from "../../lib/api";
import type { CourseSyncDraft, CourseSyncStatus, HunyuanOcrServiceStatus, ImportedLessonChapterPreview, PdfImportPreview, OfficialCourseResource, PlatformAdminAuditLog } from "../../lib/types";
import { describePdfImportProgress } from "../../lib/pdfImportProgress";
import { CourseContentEditor } from "../course/CourseContentEditor";
import { PdfImportLayersPanel } from "../pdf/PdfImportLayersPanel";
import { PdfImportReviewSummary } from "../pdf/PdfImportReviewSummary";
import { Button } from "../ui";

const initialMetadata = {
  title: "",
  description: "",
  level: "入门",
  language: "英语",
  tags: "",
  sourceLabel: "官方自有内容"
};

function normalizePreview(preview: PdfImportPreview): PdfImportPreview {
  return {
    ...preview,
    chapters: preview.chapters.map((chapter, chapterIndex) => {
      const nestedSections = [
        ...(chapter.leadIn?.activities || []).map((activity) => ({
          ...activity,
          partKind: "lead-in",
          partLabel: chapter.leadIn?.label || "Lead-in",
          focusQuestion: ""
        })),
        ...(chapter.parts || []).flatMap((part) => part.activities.map((activity) => ({
          ...activity,
          partKind: "part",
          partLabel: part.label,
          focusQuestion: part.focusQuestion || ""
        })))
      ];
      const sections = chapter.sections?.length
        ? chapter.sections
        : nestedSections.length > 0
          ? nestedSections
          : [{ id: `${chapter.id}-section-${chapterIndex + 1}`, title: "正文", type: "custom", sentences: chapter.sentences }];
      return {
        ...chapter,
        leadIn: undefined,
        parts: undefined,
        sections,
        sentences: sections.flatMap((section) => section.sentences)
      };
    })
  };
}

function withSections(chapter: ImportedLessonChapterPreview, sections: NonNullable<ImportedLessonChapterPreview["sections"]>) {
  return { ...chapter, sections, sentences: sections.flatMap((section) => section.sentences) };
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatAuditMetadata(log: PlatformAdminAuditLog) {
  const parts = [];
  if (typeof log.metadata.durationMs === "number") parts.push(`${(log.metadata.durationMs / 1000).toFixed(1)}s`);
  if (log.metadata.importId) parts.push(`诊断 ${log.metadata.importId}`);
  if (typeof log.metadata.pages === "number") parts.push(`${log.metadata.pages} 页`);
  if (typeof log.metadata.sentences === "number") parts.push(`${log.metadata.sentences} 项`);
  if (log.metadata.keyId) parts.push(`Key ${log.metadata.keyId}`);
  if (log.metadata.clientAddress) parts.push(String(log.metadata.clientAddress));
  if (log.metadata.packageHashPrefix) parts.push(`包 ${log.metadata.packageHashPrefix}`);
  if (log.metadata.statusCode) parts.push(`HTTP ${log.metadata.statusCode}`);
  return parts.join(" · ");
}

export function PlatformAdminPage({ mode = "platform" }: { mode?: "platform" | "local-studio" }) {
  const isLocalStudio = mode === "local-studio";
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [resources, setResources] = useState<OfficialCourseResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [metadata, setMetadata] = useState(initialMetadata);
  const [preview, setPreview] = useState<PdfImportPreview | null>(null);
  const [pdfRule, setPdfRule] = useState("pep-textbook");
  const [uploading, setUploading] = useState(false);
  const [uploadElapsed, setUploadElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hunyuanStatus, setHunyuanStatus] = useState<HunyuanOcrServiceStatus | null>(null);
  const [hunyuanBusy, setHunyuanBusy] = useState(false);
  const [auditLogs, setAuditLogs] = useState<PlatformAdminAuditLog[]>([]);
  const [auditLogsBusy, setAuditLogsBusy] = useState(false);
  const [courseSyncStatus, setCourseSyncStatus] = useState<CourseSyncStatus | null>(null);
  const [courseSyncDrafts, setCourseSyncDrafts] = useState<CourseSyncDraft[]>([]);
  const [courseSyncBusy, setCourseSyncBusy] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    if (isLocalStudio) {
      setCourseSyncStatus(await fetchCourseSyncStatus());
      return;
    }
    const [nextResources, nextSyncStatus, nextSyncDrafts] = await Promise.all([
      fetchOfficialCourses(),
      fetchCourseSyncStatus(),
      fetchCourseSyncDrafts()
    ]);
    setResources(nextResources);
    setCourseSyncStatus(nextSyncStatus);
    setCourseSyncDrafts(nextSyncDrafts);
  }

  async function loadHunyuanStatus() {
    setHunyuanStatus(await fetchHunyuanOcrStatus());
  }

  async function loadAuditLogs() {
    setAuditLogsBusy(true);
    try {
      setAuditLogs(await fetchPlatformAdminLogs(100));
    } finally {
      setAuditLogsBusy(false);
    }
  }

  useEffect(() => {
    void fetchParentSession().then((session) => {
      const allowed = session?.kind === "parent" && session.user.role === "platform_admin";
      setAuthorized(allowed);
      if (allowed) {
        void loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "加载失败"));
        if (isLocalStudio) void loadHunyuanStatus().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "HunyuanOCR 状态加载失败"));
        void loadAuditLogs().catch(() => undefined);
      }
    });
  }, []);

  useEffect(() => {
    if (!authorized) return undefined;
    const timer = window.setInterval(() => {
      if (isLocalStudio) void loadHunyuanStatus().catch(() => undefined);
      void loadAuditLogs().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authorized, isLocalStudio]);

  useEffect(() => {
    if (!uploading) {
      setUploadElapsed(0);
      return undefined;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setUploadElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [uploading]);

  function resetUpload() {
    setPreview(null);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  }

  function startNewPublication() {
    setResourceId("");
    setMetadata(initialMetadata);
    resetUpload();
    setMessage("");
    setError("");
  }

  function startVersion(resource: OfficialCourseResource) {
    setResourceId(resource.id);
    setMetadata({
      title: resource.title,
      description: resource.description,
      level: resource.level,
      language: resource.language,
      tags: resource.tags.join("、"),
      sourceLabel: resource.sourceLabel
    });
    resetUpload();
    setMessage("请上传新版 PDF，校对完成后发布为下一版本。");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function importPdf(file: File) {
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const nextPreview = normalizePreview(await previewLessonPdfImport(file, pdfRule));
      setPreview(nextPreview);
      setMetadata((current) => ({
        ...current,
        title: current.title || nextPreview.title,
        description: current.description || `由《${nextPreview.title}》PDF 解析生成。`,
        tags: current.tags || nextPreview.tags.join("、")
      }));
      setMessage(`PDF 解析完成：${nextPreview.stats.pages} 页、${nextPreview.stats.chapters} 章、${nextPreview.stats.sentences} 项。`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "PDF 解析失败");
      resetUpload();
    } finally {
      setUploading(false);
      void loadAuditLogs().catch(() => undefined);
    }
  }

  async function restoreLatestImport() {
    setUploading(true);
    setError("");
    try {
      const restored = await fetchLatestPdfImportPreview();
      if (!restored) {
        setError("没有可恢复的 PDF 导入结果。");
        return;
      }
      const nextPreview = normalizePreview(restored);
      setPreview(nextPreview);
      setMetadata((current) => ({
        ...current,
        title: current.title || nextPreview.title,
        description: current.description || `由《${nextPreview.title}》PDF 解析生成。`,
        tags: current.tags || nextPreview.tags.join("、")
      }));
      setMessage(`已恢复 ${nextPreview.importId}，不会重新调用 OCR 或云端服务。`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复失败");
    } finally {
      setUploading(false);
    }
  }

  function handlePdfInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void importPdf(file);
  }

  function updateChapter(chapterIndex: number, update: (chapter: ImportedLessonChapterPreview) => ImportedLessonChapterPreview) {
    setPreview((current) => current ? {
      ...current,
      chapters: current.chapters.map((chapter, index) => index === chapterIndex ? update(chapter) : chapter)
    } : current);
  }

  function updateSentence(chapterIndex: number, sectionIndex: number, sentenceIndex: number, text: string) {
    updateChapter(chapterIndex, (chapter) => withSections(chapter, (chapter.sections || []).map((section, currentSectionIndex) => ({
      ...section,
      sentences: currentSectionIndex === sectionIndex
        ? section.sentences.map((sentence, currentSentenceIndex) => currentSentenceIndex === sentenceIndex ? { ...sentence, text } : sentence)
        : section.sentences
    }))));
  }

  function removeSentence(chapterIndex: number, sectionIndex: number, sentenceIndex: number) {
    updateChapter(chapterIndex, (chapter) => withSections(chapter, (chapter.sections || []).map((section, currentSectionIndex) => ({
      ...section,
      sentences: currentSectionIndex === sectionIndex
        ? section.sentences.filter((_sentence, currentSentenceIndex) => currentSentenceIndex !== sentenceIndex)
        : section.sentences
    })).filter((section) => section.sentences.length > 0)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!preview?.importId) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const published = await publishOfficialCourse({
        importId: preview.importId,
        chapters: preview.chapters,
        resourceId: resourceId || undefined,
        title: metadata.title,
        description: metadata.description,
        level: metadata.level,
        language: metadata.language,
        tags: metadata.tags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean),
        sourceLabel: metadata.sourceLabel
      });
      await loadData();
      setResourceId(published.id);
      setMessage(`《${published.title}》v${published.version} 已发布。`);
    } catch (submitError) {
      const code = submitError instanceof Error ? submitError.message : "PUBLISH_FAILED";
      setError(
        code === "SOURCE_LESSON_QUALITY_BLOCKED"
          ? "PDF 仍存在高风险质量问题，请根据预览逐句修正后再发布。"
          : code === "OFFICIAL_COURSE_SLUG_TAKEN"
            ? "已有同名课程，请从右侧选择现有课程发布新版本。"
            : code
      );
    } finally {
      setBusy(false);
      void loadAuditLogs().catch(() => undefined);
    }
  }

  function currentPublicationInput() {
    if (!preview?.importId) return null;
    return {
      importId: preview.importId,
      chapters: preview.chapters,
      resourceId: resourceId || undefined,
      title: metadata.title,
      description: metadata.description,
      level: metadata.level,
      language: metadata.language,
      tags: metadata.tags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean),
      sourceLabel: metadata.sourceLabel
    };
  }

  async function syncToServer() {
    const input = currentPublicationInput();
    if (!input) return;
    setCourseSyncBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await syncOfficialCourseToServer(input);
      setResourceId(result.targetResourceId || resourceId);
      setMessage(`《${result.title}》已通过 HTTPS 上传到 ${result.targetUrl}，进入服务器草稿箱；包含 ${result.uploadedImages} 张课程图片。`);
      await loadData();
    } catch (syncError) {
      const code = syncError instanceof Error ? syncError.message : "COURSE_SYNC_FAILED";
      setError(
        code === "COURSE_SYNC_TARGET_NOT_CONFIGURED"
          ? "尚未配置 HTTPS 同步目标和同步密钥。"
          : code === "SOURCE_LESSON_QUALITY_BLOCKED"
            ? "课程仍有阻断发布的质量问题，请完成校对后再同步。"
            : code
      );
    } finally {
      setCourseSyncBusy(false);
      void loadAuditLogs().catch(() => undefined);
    }
  }

  async function publishSyncedDraft(draft: CourseSyncDraft) {
    setCourseSyncBusy(true);
    setMessage("");
    setError("");
    try {
      const resource = await publishCourseSyncDraft(draft.id);
      setMessage(`服务器草稿《${resource.title}》已发布为 v${resource.version}。`);
      await loadData();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "COURSE_SYNC_DRAFT_PUBLISH_FAILED");
    } finally {
      setCourseSyncBusy(false);
      void loadAuditLogs().catch(() => undefined);
    }
  }

  async function toggleStatus(resource: OfficialCourseResource) {
    setBusy(true);
    setError("");
    try {
      await updateOfficialCourseStatus(resource.id, resource.status === "published" ? "unpublished" : "published");
      await loadData();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "状态更新失败");
    } finally {
      setBusy(false);
      void loadAuditLogs().catch(() => undefined);
    }
  }

  async function changeHunyuanState(action: "start" | "stop") {
    setHunyuanBusy(true);
    setError("");
    setMessage("");
    try {
      const status = await controlHunyuanOcr(action);
      setHunyuanStatus(status);
      setMessage(action === "start" ? "HunyuanOCR 已启动，后续 PDF 导入会自动加入本地复核。" : "HunyuanOCR 已停止，PDF 导入会自动跳过该通道。" );
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : "HunyuanOCR 操作失败");
      await loadHunyuanStatus().catch(() => undefined);
    } finally {
      setHunyuanBusy(false);
      void loadAuditLogs().catch(() => undefined);
    }
  }

  if (authorized === null) return <main className="platform-admin-page" aria-label="正在验证管理员权限" />;
  if (!authorized) {
    return (
      <main className="platform-admin-page platform-admin-denied">
        <section><XCircle size={42} /><h1>需要平台管理员权限</h1><p>当前账号仍可正常使用家长端，但不能发布或下架官方资源。</p><a href="/parent"><ArrowLeft size={17} />返回家长端</a></section>
      </main>
    );
  }

  return (
    <main className="platform-admin-page">
      <header className="platform-admin-header">
        <div>{isLocalStudio ? <Cpu size={28} /> : <ShieldCheck size={28} />}<span><small>{isLocalStudio ? "仅限本机管理员" : "自托管服务器"}</small><strong>{isLocalStudio ? "课程制作工作台" : "平台课程管理"}</strong></span></div>
        <nav>
          <a href={isLocalStudio ? "/admin" : "/parent"}><ArrowLeft size={16} />{isLocalStudio ? "平台管理" : "家长端"}</a>
          {!isLocalStudio && ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname) ? <a href="/local-course-studio"><Cpu size={16} />本机课程制作</a> : null}
          <button onClick={() => void loadData()} disabled={busy} type="button"><RefreshCw size={16} />刷新</button>
        </nav>
      </header>

      {(message || error) && <div className={`platform-admin-message ${error ? "is-error" : ""}`}>{error || message}</div>}

      <section className="platform-course-sync-panel">
        <header>
          <span><CloudUpload size={20} /></span>
          <div>
            <small>{isLocalStudio ? "本机审核 · HTTPS 交付" : "服务器接收 · 管理员确认"}</small>
            <h2>{isLocalStudio ? "自托管服务器发布通道" : "课程服务器草稿箱"}</h2>
            <p>{courseSyncStatus?.message || "正在检查课程同步配置…"}</p>
          </div>
          {courseSyncStatus?.targetEnabled && <b>{courseSyncStatus.secure ? "HTTPS + HMAC" : "本地调试 + HMAC"} · Key {courseSyncStatus.activeKeyId} · {courseSyncStatus.targetUrl}</b>}
        </header>
        {!isLocalStudio && courseSyncDrafts.length > 0 && (
          <div className="platform-course-sync-drafts">
            {courseSyncDrafts.map((draft) => (
              <article className={draft.status === "published" ? "is-published" : ""} key={draft.id}>
                <Inbox size={18} />
                <div><strong>{draft.title}</strong><small>{draft.stats.chapters} 章 · {draft.stats.sentences} 项 · {draft.stats.images} 张图片 · {draft.status === "published" ? `已发布 v${draft.publishedVersion || 1}` : "等待服务器确认"}</small></div>
                {draft.status === "pending" && <button disabled={courseSyncBusy} onClick={() => void publishSyncedDraft(draft)} type="button">确认发布</button>}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={`platform-admin-grid ${preview ? "has-pdf-preview" : ""} ${isLocalStudio ? "is-local-studio" : "is-platform-console"}`}>
        {isLocalStudio ? <form className="platform-publish-panel" onSubmit={(event) => { event.preventDefault(); void syncToServer(); }}>
          <div className="platform-panel-heading">
            <span><Send size={20} /></span>
            <div><small>本机解析与人工审核</small><h1>从 PDF 制作服务器课程</h1></div>
          </div>

          <input ref={pdfInputRef} accept="application/pdf,.pdf" hidden onChange={handlePdfInput} type="file" />
          <section className="platform-pdf-upload">
            <div><Upload size={24} /><span><strong>{preview ? preview.title : "上传教材 PDF"}</strong><small>{preview ? `诊断编号 ${preview.importId}` : "解析后会逐页执行离线 OCR 双通道复核，整本教材约需 1 分钟"}</small></span></div>
            <label>解析规则<select value={pdfRule} onChange={(event) => setPdfRule(event.target.value)} disabled={uploading}><option value="pep-textbook">PEP 课本</option><option value="default">通用 PDF</option></select></label>
            <button onClick={() => pdfInputRef.current?.click()} disabled={uploading || busy} type="button">{uploading ? describePdfImportProgress(uploadElapsed).label : preview ? "重新上传" : "选择 PDF"}</button>
            {!preview && !uploading && <button className="platform-restore-import" onClick={() => void restoreLatestImport()} disabled={busy} type="button">恢复最近导入</button>}
            {uploading && <small className="pdf-import-running-hint">{describePdfImportProgress(uploadElapsed).hint}</small>}
          </section>

          {preview && (
            <>
              <PdfImportReviewSummary actionLabel="发布" quality={preview.quality} stats={preview.stats} warnings={preview.warnings} />
              {preview.importSnapshot && <PdfImportLayersPanel admin finalChapters={preview.chapters} snapshot={preview.importSnapshot} />}
              <CourseContentEditor
                chapters={preview.chapters}
                structure={preview.structure}
                snapshot={preview.importSnapshot}
                onChapterTitleChange={(chapterIndex, value) => updateChapter(chapterIndex, (current) => ({ ...current, title: value }))}
                onSectionTitleChange={(chapterIndex, sectionIndex, value) => updateChapter(chapterIndex, (current) => withSections(current, (current.sections || []).map((item, index) => index === sectionIndex ? { ...item, title: value } : item)))}
                onSentenceChange={(chapterIndex, sectionIndex, sentenceIndex, value) => {
                  if (sectionIndex !== null) updateSentence(chapterIndex, sectionIndex, sentenceIndex, value);
                }}
                onRemoveSentence={(chapterIndex, sectionIndex, sentenceIndex) => {
                  if (sectionIndex !== null) removeSentence(chapterIndex, sectionIndex, sentenceIndex);
                }}
              />
            </>
          )}

          <label>官方标题<input value={metadata.title} onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} maxLength={100} required /></label>
          <label>课程简介<textarea value={metadata.description} onChange={(event) => setMetadata({ ...metadata, description: event.target.value })} maxLength={500} rows={4} required /></label>
          <div className="platform-field-row"><label>难度<input value={metadata.level} onChange={(event) => setMetadata({ ...metadata, level: event.target.value })} maxLength={30} required /></label><label>语言<input value={metadata.language} onChange={(event) => setMetadata({ ...metadata, language: event.target.value })} maxLength={30} required /></label></div>
          <label>标签<input value={metadata.tags} onChange={(event) => setMetadata({ ...metadata, tags: event.target.value })} placeholder="家庭、四年级、PEP" /></label>
          <label>版权或来源<input value={metadata.sourceLabel} onChange={(event) => setMetadata({ ...metadata, sourceLabel: event.target.value })} maxLength={100} required /></label>
          {error && <p className="platform-publish-inline-error" role="alert">{error}</p>}
          <div className="platform-publish-actions">
            <Button type="submit" variant="primary" disabled={busy || uploading || courseSyncBusy || !preview?.importId || !courseSyncStatus?.targetEnabled}><CloudUpload size={18} />{courseSyncBusy ? "上传中…" : "上传到服务器草稿箱"}</Button>
          </div>
        </form> : null}

        {!isLocalStudio ? <section className="platform-resource-panel">
          <div className="platform-panel-heading"><span><BookOpen size={20} /></span><div><small>全平台只读快照</small><h1>已发布资源</h1></div></div>
          {resources.length === 0 ? <p className="platform-empty">还没有通过后台发布的官方课程。</p> : <div className="platform-resource-list">{resources.map((resource) => <article className={resource.status === "unpublished" ? "is-unpublished" : ""} key={resource.id}><div><small>{resource.sourceLabel}</small><h2>{resource.title}</h2><p>{resource.description}</p></div><div className="platform-resource-meta"><span>v{resource.version}</span><span>{resource.stats.chapters} 章</span><span>{resource.stats.sentences} 项</span><span>{resource.level}</span></div><div className="platform-resource-actions"><button onClick={() => void toggleStatus(resource)} disabled={busy} type="button">{resource.status === "published" ? <><XCircle size={15} />下架</> : <><CheckCircle2 size={15} />恢复</>}</button></div></article>)}</div>}
        </section> : null}
      </section>

      <section className="platform-admin-audit-panel">
        <header>
          <div className="platform-admin-audit-heading"><ScrollText size={20} /><span><strong>控制台操作日志</strong><small>记录开始、完成、失败和耗时；不保存密码、密钥或 PDF 正文</small></span></div>
          {isLocalStudio ? <div className={`platform-hunyuan-compact status-${hunyuanStatus?.state || "loading"}`}>
            <Cpu size={17} />
            <span>
              <strong>HunyuanOCR <b>{hunyuanStatus?.online ? "运行中" : hunyuanStatus?.installed ? "已停止" : hunyuanStatus ? "未安装" : "检测中"}</b></strong>
              <small>{hunyuanStatus ? `${hunyuanStatus.model} · ${hunyuanStatus.endpoint}` : "正在读取本机服务状态…"}</small>
            </span>
            <button aria-label="刷新 HunyuanOCR 状态" disabled={hunyuanBusy} onClick={() => void loadHunyuanStatus()} type="button"><RefreshCw size={14} /></button>
            {hunyuanStatus?.online ? (
              <button className="is-stop" disabled={hunyuanBusy || !hunyuanStatus.controllable} onClick={() => void changeHunyuanState("stop")} type="button"><Square size={12} />{hunyuanBusy ? "停止中…" : "停止"}</button>
            ) : (
              <button className="is-start" disabled={hunyuanBusy || !hunyuanStatus?.controllable} onClick={() => void changeHunyuanState("start")} type="button"><Play size={13} />{hunyuanBusy ? "启动中…" : "启动"}</button>
            )}
          </div> : null}
          <button aria-label="刷新控制台操作日志" disabled={auditLogsBusy} onClick={() => void loadAuditLogs()} type="button"><RefreshCw className={auditLogsBusy ? "is-spinning" : ""} size={15} />刷新日志</button>
        </header>
        <div aria-live="polite" className="platform-admin-audit-lines" role="log">
          {auditLogs.length === 0 ? <p className="platform-admin-audit-empty">还没有控制台操作记录。</p> : auditLogs.map((log) => {
            const metadata = formatAuditMetadata(log);
            return (
              <p className={`status-${log.status}`} key={log.id}>
                <time>{formatAuditTime(log.createdAt)}</time>
                <b>{log.status === "started" ? "开始" : log.status === "success" ? "成功" : "失败"}</b>
                <code>{log.actorUsername} · {log.summary}</code>
                {metadata && <small>{metadata}</small>}
              </p>
            );
          })}
        </div>
      </section>
    </main>
  );
}
