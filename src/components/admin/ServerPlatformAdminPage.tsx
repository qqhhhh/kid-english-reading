import { ArrowLeft, Ban, BookOpen, CheckCircle2, CloudUpload, Copy, Cpu, Inbox, KeyRound, RefreshCw, Save, ScrollText, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  fetchCourseSyncDrafts,
  fetchCourseSyncStatus,
  fetchOfficialCourses,
  fetchParentSession,
  fetchPlatformAdminLogs,
  fetchRegistrationKeys,
  createRegistrationKeyBatch,
  disableRegistrationKey,
  publishCourseSyncDraft,
  updateRegistrationKeyNote,
  updateOfficialCourseStatus
} from "../../lib/api";
import type { CourseSyncDraft, CourseSyncStatus, GeneratedRegistrationKey, OfficialCourseResource, PlatformAdminAuditLog, RegistrationKeySnapshot } from "../../lib/types";

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
  if (typeof log.metadata.images === "number") parts.push(`${log.metadata.images} 张图片`);
  if (log.metadata.keyId) parts.push(`Key ${log.metadata.keyId}`);
  if (log.metadata.clientAddress) parts.push(String(log.metadata.clientAddress));
  if (log.metadata.packageHashPrefix) parts.push(`包 ${log.metadata.packageHashPrefix}`);
  if (log.metadata.statusCode) parts.push(`HTTP ${log.metadata.statusCode}`);
  return parts.join(" · ");
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

const keyStatusLabels = { active: "可注册", used: "已领取", expired: "已过期", disabled: "已停用" } as const;

export function ServerPlatformAdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [resources, setResources] = useState<OfficialCourseResource[]>([]);
  const [drafts, setDrafts] = useState<CourseSyncDraft[]>([]);
  const [syncStatus, setSyncStatus] = useState<CourseSyncStatus | null>(null);
  const [logs, setLogs] = useState<PlatformAdminAuditLog[]>([]);
  const [registrationKeys, setRegistrationKeys] = useState<RegistrationKeySnapshot>({ keys: [], stats: { total: 0, active: 0, used: 0, expired: 0, disabled: 0 } });
  const [generatedKeys, setGeneratedKeys] = useState<GeneratedRegistrationKey[]>([]);
  const [keyQuantity, setKeyQuantity] = useState(5);
  const [keyValidityHours, setKeyValidityHours] = useState(72);
  const [keyBatchNote, setKeyBatchNote] = useState("");
  const [keyNoteDrafts, setKeyNoteDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isLocalHost = import.meta.env.DEV && ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);

  async function loadData() {
    const [nextResources, nextDrafts, nextStatus, nextLogs, nextRegistrationKeys] = await Promise.all([
      fetchOfficialCourses(),
      fetchCourseSyncDrafts(),
      fetchCourseSyncStatus(),
      fetchPlatformAdminLogs(100),
      fetchRegistrationKeys()
    ]);
    setResources(nextResources);
    setDrafts(nextDrafts);
    setSyncStatus(nextStatus);
    setLogs(nextLogs);
    setRegistrationKeys(nextRegistrationKeys);
  }

  useEffect(() => {
    let active = true;
    void fetchParentSession().then((session) => {
      if (!active) return;
      const allowed = session?.kind === "parent" && session.user.role === "platform_admin";
      setAuthorized(allowed);
      if (allowed) void loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "平台数据加载失败"));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authorized) return undefined;
    const timer = window.setInterval(() => void loadData().catch(() => undefined), 10000);
    return () => window.clearInterval(timer);
  }, [authorized]);

  async function confirmDraft(draft: CourseSyncDraft) {
    setBusy(true);
    setError("");
    try {
      const resource = await publishCourseSyncDraft(draft.id);
      setMessage(`《${resource.title}》已发布为 v${resource.version}。`);
      await loadData();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "课程草稿发布失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(resource: OfficialCourseResource) {
    setBusy(true);
    setError("");
    try {
      await updateOfficialCourseStatus(resource.id, resource.status === "published" ? "unpublished" : "published");
      await loadData();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "课程状态更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function generateKeys() {
    setBusy(true);
    setError("");
    try {
      const result = await createRegistrationKeyBatch({ quantity: keyQuantity, expiresInHours: keyValidityHours, note: keyBatchNote });
      setGeneratedKeys(result.generated);
      setRegistrationKeys(result.snapshot);
      setMessage(`已生成 ${result.generated.length} 个一次性注册 Key。明文只在当前结果中显示，请立即复制保存。`);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "注册 Key 生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyGeneratedKeys() {
    const value = generatedKeys.map((item) => item.key).join("\n");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`已复制 ${generatedKeys.length} 个注册 Key。`);
    } catch {
      setError("浏览器未允许自动复制，请逐条选择 Key 复制。 ");
    }
  }

  async function saveKeyNote(keyId: string, currentNote: string) {
    setBusy(true);
    setError("");
    try {
      const snapshot = await updateRegistrationKeyNote(keyId, keyNoteDrafts[keyId] ?? currentNote);
      setRegistrationKeys(snapshot);
      setMessage("注册 Key 备注已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "备注保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function stopKey(keyId: string) {
    if (!window.confirm("停用后该 Key 将不能再注册，确定继续吗？")) return;
    setBusy(true);
    setError("");
    try {
      setRegistrationKeys(await disableRegistrationKey(keyId));
      setMessage("注册 Key 已停用。");
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : "注册 Key 停用失败");
    } finally {
      setBusy(false);
    }
  }

  if (authorized === null) return <main className="platform-admin-page" aria-label="正在验证管理员权限" />;
  if (!authorized) return <main className="platform-admin-page platform-admin-denied"><section><XCircle size={42} /><h1>需要平台管理员权限</h1><p>当前账号不能管理服务器课程。</p><a href="/parent"><ArrowLeft size={17} />返回家长端</a></section></main>;

  return (
    <main className="platform-admin-page">
      <header className="platform-admin-header">
        <div><ShieldCheck size={28} /><span><small>平台服务器</small><strong>平台课程管理</strong></span></div>
        <nav>
          <a href="/parent"><ArrowLeft size={16} />家长端</a>
          {isLocalHost ? <a href="/local-course-studio"><Cpu size={16} />本机课程制作</a> : null}
          <button disabled={busy} onClick={() => void loadData()} type="button"><RefreshCw size={16} />刷新</button>
        </nav>
      </header>

      {(message || error) && <div className={`platform-admin-message ${error ? "is-error" : ""}`}>{error || message}</div>}

      <section className="platform-course-sync-panel">
        <header>
          <span><CloudUpload size={20} /></span>
          <div><small>服务器接收 · 管理员确认</small><h2>课程服务器草稿箱</h2><p>{syncStatus?.message || "正在检查课程接收状态…"}</p></div>
          {syncStatus?.inboundEnabled ? <b>HMAC · Key {syncStatus.acceptedKeyIds.join(" / ")} · {Math.round(syncStatus.replayWindowSeconds / 60)} 分钟防重放</b> : null}
        </header>
        {drafts.length === 0 ? <p className="platform-empty">暂时没有等待确认的本机课程包。</p> : <div className="platform-course-sync-drafts">{drafts.map((draft) => (
          <article className={draft.status === "published" ? "is-published" : ""} key={draft.id}>
            <Inbox size={18} />
            <div><strong>{draft.title}</strong><small>{draft.stats.chapters} 章 · {draft.stats.sentences} 项 · {draft.stats.images} 张图片 · {draft.status === "published" ? `已发布 v${draft.publishedVersion || 1}` : "等待服务器确认"}</small></div>
            {draft.status === "pending" ? <button disabled={busy} onClick={() => void confirmDraft(draft)} type="button">确认发布</button> : null}
          </article>
        ))}</div>}
      </section>

      <section className="platform-registration-key-panel">
        <header>
          <div><span><KeyRound size={20} /></span><div><small>小范围邀请注册</small><h2>一次性限时注册 Key</h2><p>每个 Key 只能注册一个账号；明文生成后仅显示一次，服务器不保存可还原明文。</p></div></div>
          <div className="platform-key-stats"><b>{registrationKeys.stats.active}<small>可注册</small></b><b>{registrationKeys.stats.used}<small>已领取</small></b><b>{registrationKeys.stats.expired}<small>已过期</small></b><b>{registrationKeys.stats.disabled}<small>已停用</small></b></div>
        </header>
        <div className="platform-key-create-form">
          <label>生成数量<input max={100} min={1} onChange={(event) => setKeyQuantity(Number(event.target.value))} type="number" value={keyQuantity} /></label>
          <label>有效时间<select onChange={(event) => setKeyValidityHours(Number(event.target.value))} value={keyValidityHours}><option value={24}>24 小时</option><option value={72}>3 天</option><option value={168}>7 天</option><option value={720}>30 天</option><option value={2160}>90 天</option></select></label>
          <label className="is-note">批次备注<input maxLength={300} onChange={(event) => setKeyBatchNote(event.target.value)} placeholder="例如：三年级一班家长群" value={keyBatchNote} /></label>
          <button disabled={busy || keyQuantity < 1 || keyQuantity > 100} onClick={() => void generateKeys()} type="button"><KeyRound size={16} />批量生成</button>
        </div>
        {generatedKeys.length > 0 ? <div className="platform-generated-keys">
          <header><div><strong>本次生成结果</strong><small>请现在复制；离开或刷新后只能看到前缀和使用记录。</small></div><button onClick={() => void copyGeneratedKeys()} type="button"><Copy size={15} />复制全部</button></header>
          <div>{generatedKeys.map((item) => <code key={item.id}>{item.key}</code>)}</div>
        </div> : null}
        <div className="platform-registration-key-list">
          <div className="platform-key-list-heading"><strong>Key 与账号使用情况</strong><small>共 {registrationKeys.stats.total} 个，最近生成的排在前面</small></div>
          {registrationKeys.keys.length === 0 ? <p className="platform-empty">还没有生成注册 Key。</p> : registrationKeys.keys.map((item) => <article className={`status-${item.status}`} key={item.id}>
            <div className="platform-key-identity"><strong>{item.keyPrefix || "历史 Key"}••••</strong><span>{keyStatusLabels[item.status]}</span><small>生成 {formatDateTime(item.createdAt)} · 到期 {formatDateTime(item.expiresAt)}</small></div>
            <div className="platform-key-account"><strong>{item.consumedByUsername || "尚未领取"}</strong><small>{item.consumedByHouseholdName || (item.status === "active" ? "等待注册" : "无关联账号")} {item.consumedAt ? `· ${formatDateTime(item.consumedAt)}` : ""}</small></div>
            <div className="platform-key-note"><input maxLength={300} onChange={(event) => setKeyNoteDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="添加备注" value={keyNoteDrafts[item.id] ?? item.note} /><button disabled={busy || (keyNoteDrafts[item.id] ?? item.note) === item.note} onClick={() => void saveKeyNote(item.id, item.note)} type="button" title="保存备注"><Save size={15} /></button></div>
            <button className="platform-key-disable" disabled={busy || item.status !== "active"} onClick={() => void stopKey(item.id)} type="button"><Ban size={14} />停用</button>
          </article>)}
        </div>
      </section>

      <section className="platform-admin-grid is-platform-console">
        <section className="platform-resource-panel">
          <div className="platform-panel-heading"><span><BookOpen size={20} /></span><div><small>当前服务器资源</small><h1>已发布课程</h1></div></div>
          {resources.length === 0 ? <p className="platform-empty">服务器还没有正式课程。</p> : <div className="platform-resource-list">{resources.map((resource) => (
            <article className={resource.status === "unpublished" ? "is-unpublished" : ""} key={resource.id}>
              <div><small>{resource.sourceLabel}</small><h2>{resource.title}</h2><p>{resource.description}</p></div>
              <div className="platform-resource-meta"><span>v{resource.version}</span><span>{resource.stats.chapters} 章</span><span>{resource.stats.sentences} 项</span><span>{resource.level}</span></div>
              <div className="platform-resource-actions"><button disabled={busy} onClick={() => void toggleStatus(resource)} type="button">{resource.status === "published" ? <><XCircle size={15} />下架</> : <><CheckCircle2 size={15} />恢复</>}</button></div>
            </article>
          ))}</div>}
        </section>
      </section>

      <section className="platform-admin-audit-panel">
        <header><div className="platform-admin-audit-heading"><ScrollText size={20} /><span><strong>平台操作日志</strong><small>记录课程管理、注册 Key 生成、备注修改和停用</small></span></div><button disabled={busy} onClick={() => void loadData()} type="button"><RefreshCw size={15} />刷新日志</button></header>
        <div aria-live="polite" className="platform-admin-audit-lines" role="log">
          {logs.length === 0 ? <p className="platform-admin-audit-empty">还没有平台操作记录。</p> : logs.map((log) => {
            const metadata = formatAuditMetadata(log);
            return <p className={`status-${log.status}`} key={log.id}><time>{formatAuditTime(log.createdAt)}</time><b>{log.status === "started" ? "开始" : log.status === "success" ? "成功" : "失败"}</b><code>{log.actorUsername} · {log.summary}</code>{metadata ? <small>{metadata}</small> : null}</p>;
          })}
        </div>
      </section>
    </main>
  );
}
