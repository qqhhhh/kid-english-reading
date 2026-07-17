import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Copy,
  Headphones,
  RefreshCw,
  Search,
  Smartphone,
  Timer,
  Waves
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchAttemptDiagnostics, getAttemptDiagnosticAudioUrl, updateAttemptCalibration } from "../../lib/api";
import { getAssessmentWordText, getRequiredWordScore } from "../../lib/scoring";
import type {
  AttemptCalibrationSummary,
  AttemptDiagnostic,
  CalibrationLabel,
  ChildProfile,
  RecordingQuality,
  SpeechProviderComparisonResult,
  WordAssessment
} from "../../lib/types";
import type { Locale } from "../../lib/i18n";

type ScoringDiagnosticsPageProps = {
  children: ChildProfile[];
  activeChildId: string;
  locale: Locale;
  onSelectChild: (childId: string) => void;
};

const copyByLocale = {
  zh: {
    kicker: "评分诊断",
    title: "定位每一次评分差异",
    subtitle: "查看录音质量、设备信息、逐词结果及腾讯/讯飞影子评分；复制完整信息后可直接交给测试人员。",
    child: "学生",
    searchPlaceholder: "搜索 attempt ID、句子或课程",
    search: "搜索",
    refresh: "刷新",
    attempts: "已加载样本",
    compared: "双服务商对照",
    disagreements: "分差 ≥ 15",
    passed: "已通过",
    calibrationTitle: "真实样本校准",
    calibrationHelp: "以人工复听标签为准：正确朗读应通过，其余明确问题应不通过；“其他”不计入误判率。服务不可用不算误判。",
    reviewed: "已人工复听",
    unreviewed: "待复听",
    misjudgmentRate: "误判率",
    evaluatedSamples: "有效对照",
    falseAccepts: "错误放行",
    falseRejects: "错误拒绝",
    humanReview: "人工复听标签",
    humanReviewHelp: "先听录音，再选择真实情况。标签会用于统计腾讯与讯飞的误判率。",
    reviewNote: "备注（可选）",
    reviewNotePlaceholder: "例如：漏读第二个单词；背景有电视声",
    saveReview: "保存标签",
    savingReview: "保存中…",
    savedReview: "标签已保存",
    clearReview: "清除标签",
    rejectedBeforeScoring: "评分前已拒绝",
    rejectionReason: "拒绝原因",
    providerNotAssessed: "该录音在浏览器质量检查阶段被拒绝，没有发送给评分服务。请先复听录音并标注真实情况。",
    reviewRequired: "待标注",
    labels: { correct: "正确朗读", missed: "漏读", misread: "错读", silent: "无声", noise: "噪音", other: "其他" },
    noChildren: "还没有学生档案，暂时无法读取评分样本。",
    empty: "没有找到评分样本。孩子完成一次有效朗读后会显示在这里。",
    emptySearch: "没有匹配的 attempt。请检查 ID，或清空搜索条件。",
    more: "这里只显示最近 {limit} 条；可输入 attempt ID 精确查找更早的记录。",
    lesson: "课程",
    storybook: "绘本",
    passedLabel: "通过",
    failedLabel: "未通过",
    noComparison: "无影子评分",
    selectAttempt: "选择左侧记录查看详情",
    copyId: "复制 ID",
    copyAll: "复制诊断信息",
    copiedId: "ID 已复制",
    copiedAll: "诊断信息已复制",
    copyFailed: "复制失败，请展开技术数据手动复制。",
    attemptId: "Attempt ID",
    createdAt: "评分时间",
    content: "内容来源",
    sentence: "朗读文本",
    recordings: "录音回放",
    enhancedAudio: "评分录音",
    rawAudio: "降噪前原始录音",
    noAudio: "此样本没有可回放录音。",
    providerComparison: "腾讯 / 讯飞对照",
    providerScore: "显示分",
    rawScore: "服务商原始分",
    accuracy: "准确度",
    completion: "完整度",
    latency: "耗时",
    providerRejected: "服务商拒评",
    providerError: "服务调用失败",
    scoreDelta: "影子 - 主评分",
    noShadow: "该样本未启用影子评分。",
    wordComparison: "逐词结果",
    word: "单词",
    primary: "主评分",
    shadow: "影子评分",
    score: "分",
    noWords: "服务商没有返回逐词结果。",
    processingTimeline: "评分耗时分解",
    enhancementStage: "降噪处理",
    primaryStage: "腾讯主评",
    rawStage: "原音对照",
    decisionStage: "服务端可决策",
    shadowStage: "讯飞影子",
    shadowQueued: "后台排队中",
    shadowDropped: "队列已满，未执行",
    shadowDisabled: "未启用",
    recordingQuality: "录音质量",
    qualityGood: "录音指标正常",
    qualityWeak: "声音偏弱，校准时建议重点复听",
    qualityInterrupted: "采集时长存在明显缺口",
    qualityMissing: "旧样本未记录录音质量",
    processedDuration: "有效时长",
    voiceDuration: "语音时长",
    rms: "平均响度",
    peak: "峰值",
    captureGap: "采集缺口",
    outputSnr: "降噪后 SNR",
    device: "设备与浏览器",
    deviceMissing: "旧样本未记录设备摘要；新产生的 attempt 会自动保存。",
    viewport: "视口",
    screen: "屏幕",
    touchPoints: "触点",
    network: "网络",
    microphone: "麦克风处理",
    enabled: "开启",
    disabled: "关闭",
    unknown: "未知",
    echoCancellation: "回声消除",
    noiseSuppression: "系统降噪",
    autoGain: "自动增益",
    sampleRate: "采样率",
    channels: "声道",
    candidateDetails: "候选片段与降噪详情",
    technicalData: "完整技术数据"
  },
  en: {
    kicker: "Scoring diagnostics",
    title: "Trace every scoring difference",
    subtitle: "Inspect recording quality, device details, word results, and Tencent/XFYUN shadow comparisons, then copy a complete test report.",
    child: "Child",
    searchPlaceholder: "Search attempt ID, sentence, or course",
    search: "Search",
    refresh: "Refresh",
    attempts: "Loaded samples",
    compared: "Provider comparisons",
    disagreements: "Score gap ≥ 15",
    passed: "Passed",
    calibrationTitle: "Real-sample calibration",
    calibrationHelp: "Human listening is the reference: correct readings should pass and explicit reading problems should fail. Other is excluded; unavailable providers are not counted as errors.",
    reviewed: "Reviewed",
    unreviewed: "To review",
    misjudgmentRate: "Error rate",
    evaluatedSamples: "Evaluated",
    falseAccepts: "False accepts",
    falseRejects: "False rejects",
    humanReview: "Human listening label",
    humanReviewHelp: "Listen first, then select what actually happened. The label feeds Tencent and XFYUN error-rate statistics.",
    reviewNote: "Note (optional)",
    reviewNotePlaceholder: "For example: missed the second word; TV noise in background",
    saveReview: "Save label",
    savingReview: "Saving…",
    savedReview: "Label saved",
    clearReview: "Clear label",
    rejectedBeforeScoring: "Rejected before scoring",
    rejectionReason: "Rejection reason",
    providerNotAssessed: "This recording failed browser quality checks and was not sent to a scoring provider. Listen to it and label what actually happened.",
    reviewRequired: "Needs label",
    labels: { correct: "Correct", missed: "Missed words", misread: "Misread", silent: "Silent", noise: "Noise", other: "Other" },
    noChildren: "No child profile is available, so there are no scoring samples yet.",
    empty: "No scoring samples yet. A valid reading attempt will appear here.",
    emptySearch: "No matching attempt. Check the ID or clear the search.",
    more: "Only the latest {limit} items are shown. Search by attempt ID to find an older record.",
    lesson: "Lesson",
    storybook: "Picture book",
    passedLabel: "Passed",
    failedLabel: "Not passed",
    noComparison: "No shadow score",
    selectAttempt: "Select an attempt on the left to inspect it",
    copyId: "Copy ID",
    copyAll: "Copy diagnostics",
    copiedId: "ID copied",
    copiedAll: "Diagnostics copied",
    copyFailed: "Copy failed. Expand the technical data and copy it manually.",
    attemptId: "Attempt ID",
    createdAt: "Scored at",
    content: "Content",
    sentence: "Reference text",
    recordings: "Recordings",
    enhancedAudio: "Assessed recording",
    rawAudio: "Original before enhancement",
    noAudio: "No recording is available for this sample.",
    providerComparison: "Tencent / XFYUN comparison",
    providerScore: "Displayed score",
    rawScore: "Provider score",
    accuracy: "Accuracy",
    completion: "Completion",
    latency: "Latency",
    providerRejected: "Rejected by provider",
    providerError: "Provider call failed",
    scoreDelta: "Shadow - primary",
    noShadow: "Shadow scoring was not enabled for this sample.",
    wordComparison: "Word results",
    word: "Word",
    primary: "Primary",
    shadow: "Shadow",
    score: "score",
    noWords: "The provider did not return word-level results.",
    processingTimeline: "Scoring latency breakdown",
    enhancementStage: "Enhancement",
    primaryStage: "Tencent primary",
    rawStage: "Raw comparison",
    decisionStage: "Server decision ready",
    shadowStage: "XFYUN shadow",
    shadowQueued: "Queued in background",
    shadowDropped: "Skipped: queue full",
    shadowDisabled: "Disabled",
    recordingQuality: "Recording quality",
    qualityGood: "Recording metrics look normal",
    qualityWeak: "Audio level is low; listen closely during calibration",
    qualityInterrupted: "The capture duration has a significant gap",
    qualityMissing: "Recording quality was not stored for this older sample",
    processedDuration: "Usable duration",
    voiceDuration: "Voice duration",
    rms: "Average level",
    peak: "Peak",
    captureGap: "Capture gap",
    outputSnr: "Enhanced SNR",
    device: "Device and browser",
    deviceMissing: "This older sample has no device summary. New attempts will store one automatically.",
    viewport: "Viewport",
    screen: "Screen",
    touchPoints: "Touch points",
    network: "Network",
    microphone: "Microphone processing",
    enabled: "On",
    disabled: "Off",
    unknown: "Unknown",
    echoCancellation: "Echo cancellation",
    noiseSuppression: "System noise suppression",
    autoGain: "Auto gain",
    sampleRate: "Sample rate",
    channels: "Channels",
    candidateDetails: "Candidate and enhancement details",
    technicalData: "Full technical data"
  }
} as const;

function providerLabel(provider: string, locale: Locale) {
  if (provider === "tencent") return locale === "zh" ? "腾讯" : "Tencent";
  if (provider === "xfyun") return locale === "zh" ? "讯飞" : "XFYUN";
  if (provider === "azure") return "Azure";
  if (provider === "mock") return "Mock";
  return provider || (locale === "zh" ? "未知" : "Unknown");
}

function matchLabel(tag: number, locale: Locale) {
  const labels = locale === "zh"
    ? ["通过", "多读", "漏读", "错读", "未收录"]
    : ["Pass", "Extra", "Missed", "Misread", "Unscored"];
  return labels[tag] || labels[0];
}

function wordTone(word: WordAssessment | undefined) {
  if (!word) return "missing";
  if (word.MatchTag === 0 && word.PronAccuracy >= 70) return "passed";
  if (word.MatchTag === 1) return "extra";
  if (word.MatchTag === 2) return "missed";
  if (word.MatchTag === 3) return "misread";
  return "unclear";
}

function formatMilliseconds(value: number | undefined) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(Number(value))} ms`;
}

function formatPercent(value: number | undefined, isRatio = false) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(Number(value) * (isRatio ? 100 : 1))}%`;
}

function formatMetric(value: number | undefined, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits).replace(/\.0+$/u, "") : "-";
}

function qualityState(quality: RecordingQuality | undefined) {
  if (!quality) return "missing";
  const allowedGap = Math.max(450, Number(quality.rawDurationMs || 0) * 0.08);
  if (Number(quality.captureGapMs || 0) > allowedGap) return "interrupted";
  if (Number(quality.rms || 0) < 0.008 || Number(quality.peak || 0) < 0.03) return "weak";
  return "good";
}

function describeDevice(attempt: AttemptDiagnostic, locale: Locale) {
  const userAgent = attempt.clientDevice?.userAgent || "";
  if (!userAgent) return "";
  const device = /iPad/u.test(userAgent)
    ? "iPad"
    : /iPhone/u.test(userAgent)
      ? "iPhone"
      : /Android/u.test(userAgent)
        ? locale === "zh" ? "Android 手机/平板" : "Android device"
        : /Windows/u.test(userAgent)
          ? "Windows"
          : /Macintosh/u.test(userAgent)
            ? "Mac"
            : attempt.clientDevice?.platform || (locale === "zh" ? "未知设备" : "Unknown device");
  const browser = /Edg\//u.test(userAgent)
    ? "Edge"
    : /CriOS\//u.test(userAgent)
      ? "Chrome iOS"
      : /Chrome\//u.test(userAgent)
        ? "Chrome"
        : /Safari\//u.test(userAgent)
          ? "Safari"
          : "Browser";
  const version = userAgent.match(/(?:Version|CriOS|Chrome|Edg)\/([\d.]+)/u)?.[1];
  return `${device} · ${browser}${version ? ` ${version}` : ""}`;
}

function booleanLabel(value: boolean | undefined, copy: typeof copyByLocale.zh | typeof copyByLocale.en) {
  if (value === true) return copy.enabled;
  if (value === false) return copy.disabled;
  return copy.unknown;
}

function diagnosticPayload(attempt: AttemptDiagnostic) {
  return {
    schemaVersion: 1,
    app: {
      version: import.meta.env.VITE_APP_VERSION,
      buildId: import.meta.env.VITE_BUILD_ID
    },
    attempt: {
      id: attempt.id,
      childId: attempt.childId,
      childName: attempt.childName,
      sentenceId: attempt.sentenceId,
      referenceText: attempt.referenceText,
      createdAt: attempt.createdAt,
      sourceType: attempt.sourceType,
      contentId: attempt.contentId,
      contentTitle: attempt.contentTitle,
      storybookPageId: attempt.storybookPageId,
      speechProvider: attempt.speechProvider,
      passed: attempt.passed,
      audioBytes: attempt.audioBytes,
      diagnosticStatus: attempt.diagnosticStatus,
      rejectionStage: attempt.rejectionStage,
      rejectionCode: attempt.rejectionCode,
      rejectedReason: attempt.rejectedReason,
      calibration: attempt.calibration
    },
    clientDevice: attempt.clientDevice,
    recordingQuality: attempt.recordingQuality,
    candidateSelection: attempt.candidateSelection,
    speechEnhancement: attempt.speechEnhancement,
    processingTimings: attempt.processingTimings,
    providerComparison: attempt.speechProviderComparison,
    result: attempt.result,
    gate: {
      severeIssues: attempt.severeIssues,
      extraIssues: attempt.extraIssues,
      unscoredIssues: attempt.unscoredIssues,
      lowAccuracyIssues: attempt.lowAccuracyIssues,
      minWordAccuracy: attempt.minWordAccuracy
    }
  };
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

function ProviderCard({
  provider,
  role,
  locale,
  copy
}: {
  provider: SpeechProviderComparisonResult;
  role: string;
  locale: Locale;
  copy: typeof copyByLocale.zh | typeof copyByLocale.en;
}) {
  return (
    <article className={`diagnostic-provider-card ${provider.status === "error" || provider.providerRejected ? "warn" : ""}`}>
      <header>
        <strong>{providerLabel(provider.provider, locale)}</strong>
        <span>{role}</span>
      </header>
      {provider.status === "error" ? (
        <p className="diagnostic-provider-error">{copy.providerError}: {provider.error || "-"}</p>
      ) : (
        <>
          {provider.providerRejected && (
            <p className="diagnostic-provider-error">{copy.providerRejected} · {provider.providerExceptionCode || "-"}</p>
          )}
          <dl>
            <div><dt>{copy.providerScore}</dt><dd>{Math.round(provider.suggestedScore || 0)}</dd></div>
            <div><dt>{copy.rawScore}</dt><dd>{Math.round(provider.providerSuggestedScore ?? provider.suggestedScore ?? 0)}</dd></div>
            <div><dt>{copy.accuracy}</dt><dd>{formatPercent(provider.pronAccuracy)}</dd></div>
            <div><dt>{copy.completion}</dt><dd>{formatPercent(provider.pronCompletion, true)}</dd></div>
            <div><dt>{copy.latency}</dt><dd>{formatMilliseconds(provider.durationMs)}</dd></div>
          </dl>
        </>
      )}
    </article>
  );
}

function WordResultCell({ word, locale, copy }: {
  word: WordAssessment | undefined;
  locale: Locale;
  copy: typeof copyByLocale.zh | typeof copyByLocale.en;
}) {
  if (!word) return <span className="diagnostic-word-empty">-</span>;
  const score = word.MatchTag === 1 ? null : Math.round(getRequiredWordScore(word));
  return (
    <span className={`diagnostic-word-result ${wordTone(word)}`}>
      <b>{getAssessmentWordText(word) || word.ReferenceWord || word.Word || "-"}</b>
      <small>{matchLabel(word.MatchTag, locale)}{score === null ? "" : ` · ${score} ${copy.score}`}</small>
    </span>
  );
}

export function ScoringDiagnosticsPage({ children, activeChildId, locale, onSelectChild }: ScoringDiagnosticsPageProps) {
  const copy = copyByLocale[locale];
  const [attempts, setAttempts] = useState<AttemptDiagnostic[]>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [resultLimit, setResultLimit] = useState(100);
  const [copyStatus, setCopyStatus] = useState<"" | "id" | "all" | "error">("");
  const [calibrationSummary, setCalibrationSummary] = useState<AttemptCalibrationSummary | null>(null);
  const [reviewLabel, setReviewLabel] = useState<CalibrationLabel | "">("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"" | "saving" | "saved" | "error">("");

  useEffect(() => {
    let cancelled = false;
    if (!activeChildId) {
      setAttempts([]);
      return undefined;
    }
    setLoading(true);
    setError("");
    void fetchAttemptDiagnostics({ childId: activeChildId, query, limit: 100 })
      .then((response) => {
        if (cancelled) return;
        setAttempts(response.attempts);
        setHasMore(response.hasMore);
        setResultLimit(response.limit);
        setCalibrationSummary(response.calibrationSummary);
        setSelectedAttemptId((current) => response.attempts.some((attempt) => attempt.id === current)
          ? current
          : response.attempts[0]?.id || "");
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load scoring diagnostics");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChildId, query, refreshToken]);

  const selectedAttempt = attempts.find((attempt) => attempt.id === selectedAttemptId) || attempts[0];

  useEffect(() => {
    setReviewLabel(selectedAttempt?.calibration?.label || "");
    setReviewNote(selectedAttempt?.calibration?.note || "");
    setReviewStatus("");
  }, [selectedAttempt?.id, selectedAttempt?.calibration?.label, selectedAttempt?.calibration?.note]);

  const comparisonCount = attempts.filter((attempt) => attempt.speechProviderComparison).length;
  const disagreementCount = attempts.filter((attempt) => {
    const comparison = attempt.speechProviderComparison;
    return comparison?.shadow.status === "success" &&
      Math.abs(Number(comparison.shadow.suggestedScore || 0) - Number(comparison.primary.suggestedScore || 0)) >= 15;
  }).length;
  const passCount = attempts.filter((attempt) => attempt.passed).length;
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }), [locale]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery(searchDraft.trim());
  }

  async function copyAttempt(kind: "id" | "all") {
    if (!selectedAttempt) return;
    try {
      await writeClipboard(kind === "id" ? selectedAttempt.id : JSON.stringify(diagnosticPayload(selectedAttempt), null, 2));
      setCopyStatus(kind);
      window.setTimeout(() => setCopyStatus(""), 2200);
    } catch {
      setCopyStatus("error");
    }
  }

  async function saveReview(label = reviewLabel) {
    if (!selectedAttempt || !activeChildId) return;
    setReviewStatus("saving");
    setError("");
    try {
      const response = await updateAttemptCalibration({
        attemptId: selectedAttempt.id,
        childId: selectedAttempt.childId || activeChildId,
        label,
        note: label ? reviewNote : ""
      });
      setAttempts((current) => current.map((attempt) => attempt.id === selectedAttempt.id
        ? { ...attempt, calibration: response.calibration }
        : attempt));
      setCalibrationSummary(response.calibrationSummary);
      if (!label) {
        setReviewLabel("");
        setReviewNote("");
      }
      setReviewStatus("saved");
    } catch (saveError) {
      setReviewStatus("error");
      setError(saveError instanceof Error ? saveError.message : "Unable to save calibration review");
    }
  }

  const primaryProvider: SpeechProviderComparisonResult | undefined = selectedAttempt && selectedAttempt.speechProvider !== "not-assessed"
    ? selectedAttempt.speechProviderComparison?.primary || {
        provider: selectedAttempt.speechProvider || "unknown",
        status: "success",
        durationMs: selectedAttempt.candidateSelection?.evaluated.at(-1)?.assessmentDurationMs || 0,
        passed: selectedAttempt.passed,
        suggestedScore: selectedAttempt.result.SuggestedScore,
        providerSuggestedScore: selectedAttempt.result.ProviderSuggestedScore,
        pronAccuracy: selectedAttempt.result.PronAccuracy,
        pronFluency: selectedAttempt.result.PronFluency,
        pronCompletion: selectedAttempt.result.PronCompletion,
        severeIssues: selectedAttempt.severeIssues,
        lowAccuracyIssues: selectedAttempt.lowAccuracyIssues,
        providerRejected: selectedAttempt.result.ProviderRejected,
        providerExceptionCode: selectedAttempt.result.ProviderExceptionCode
      }
    : undefined;
  const shadowProvider = selectedAttempt?.speechProviderComparison?.shadow;
  const primaryWords = selectedAttempt?.result?.Words || [];
  const shadowWords = shadowProvider?.result?.Words || [];
  const wordRowCount = Math.max(primaryWords.length, shadowWords.length);
  const quality = selectedAttempt?.recordingQuality;
  const processingTimings = selectedAttempt?.processingTimings;
  const qualityTone = qualityState(quality);
  const noiseGate = selectedAttempt?.speechEnhancement?.noiseGate as { outputSnrDb?: number } | undefined;
  const deviceDescription = selectedAttempt ? describeDevice(selectedAttempt, locale) : "";

  return (
    <section className="admin-section-page scoring-diagnostics-page">
      <div className="admin-page-heading diagnostic-page-heading">
        <div>
          <span className="admin-kicker">{copy.kicker}</span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
      </div>

      <section className="admin-panel diagnostic-toolbar-panel">
        <label className="admin-field">
          <span>{copy.child}</span>
          <select value={activeChildId} onChange={(event) => onSelectChild(event.target.value)} disabled={children.length === 0}>
            {children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}
          </select>
        </label>
        <form className="diagnostic-search" onSubmit={submitSearch}>
          <Search size={17} />
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={copy.searchPlaceholder} />
          <button className="admin-secondary-button compact-action" type="submit">{copy.search}</button>
        </form>
        <button className="admin-secondary-button compact-action diagnostic-refresh" onClick={() => setRefreshToken((value) => value + 1)} disabled={loading || !activeChildId} type="button">
          <RefreshCw className={loading ? "spin" : ""} size={17} />
          {copy.refresh}
        </button>
      </section>

      <div className="admin-metric-grid diagnostic-metric-grid">
        <article className="admin-metric-card accent"><span>{copy.attempts}</span><strong>{attempts.length}</strong><small>{query || "-"}</small></article>
        <article className="admin-metric-card"><span>{copy.compared}</span><strong>{comparisonCount}</strong><small>{attempts.length ? `${Math.round((comparisonCount / attempts.length) * 100)}%` : "0%"}</small></article>
        <article className="admin-metric-card"><span>{copy.disagreements}</span><strong>{disagreementCount}</strong><small>{comparisonCount ? `${Math.round((disagreementCount / comparisonCount) * 100)}%` : "0%"}</small></article>
        <article className="admin-metric-card"><span>{copy.passed}</span><strong>{passCount}</strong><small>{attempts.length ? `${Math.round((passCount / attempts.length) * 100)}%` : "0%"}</small></article>
      </div>

      {calibrationSummary && (
        <section className="admin-panel diagnostic-calibration-summary">
          <div className="diagnostic-calibration-heading">
            <div><span className="admin-kicker">{copy.calibrationTitle}</span><p>{copy.calibrationHelp}</p></div>
            <dl>
              <div><dt>{copy.reviewed}</dt><dd>{calibrationSummary.reviewed}</dd></div>
              <div><dt>{copy.unreviewed}</dt><dd>{calibrationSummary.unreviewed}</dd></div>
            </dl>
          </div>
          <div className="diagnostic-calibration-provider-grid">
            {(["tencent", "xfyun"] as const).map((provider) => {
              const summary = calibrationSummary.providers[provider];
              return (
                <article key={provider}>
                  <header><strong>{providerLabel(provider, locale)}</strong><span>{copy.misjudgmentRate}</span></header>
                  <b>{summary.errorRate === null ? "-" : `${summary.errorRate}%`}</b>
                  <small>{copy.evaluatedSamples} {summary.evaluated} · {copy.falseAccepts} {summary.falseAccepts} · {copy.falseRejects} {summary.falseRejects}</small>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {error && <p className="error-text diagnostic-load-error">{error}</p>}
      {!activeChildId ? (
        <section className="admin-panel diagnostic-empty"><Smartphone size={30} /><p>{copy.noChildren}</p></section>
      ) : attempts.length === 0 && !loading ? (
        <section className="admin-panel diagnostic-empty"><Waves size={30} /><p>{query ? copy.emptySearch : copy.empty}</p></section>
      ) : (
        <section className="diagnostic-workbench">
          <aside className="admin-panel diagnostic-attempt-list" aria-busy={loading}>
            {attempts.map((attempt) => {
              const comparison = attempt.speechProviderComparison;
              const gap = comparison?.shadow.status === "success"
                ? Math.round(Number(comparison.shadow.suggestedScore || 0) - Number(comparison.primary.suggestedScore || 0))
                : null;
              return (
                <button className={`diagnostic-attempt-row ${attempt.id === selectedAttempt?.id ? "selected" : ""}`} key={attempt.id} onClick={() => setSelectedAttemptId(attempt.id)} type="button">
                  <span className={`diagnostic-attempt-score ${attempt.passed ? "passed" : "failed"}`}>{attempt.diagnosticStatus === "rejected" && attempt.speechProvider === "not-assessed" ? "×" : Math.round(attempt.result.SuggestedScore || 0)}</span>
                  <span className="diagnostic-attempt-copy">
                    <strong>{attempt.referenceText}</strong>
                    <small>{attempt.sourceType === "storybook" ? copy.storybook : copy.lesson} · {attempt.contentTitle || attempt.contentId || "-"}</small>
                    <small className={attempt.calibration ? "diagnostic-review-tag reviewed" : "diagnostic-review-tag"}>{attempt.calibration ? copy.labels[attempt.calibration.label] : copy.reviewRequired}</small>
                    <code>{attempt.id}</code>
                  </span>
                  <span className="diagnostic-attempt-meta">
                    <time dateTime={attempt.createdAt}>{formatter.format(new Date(attempt.createdAt))}</time>
                    <em className={attempt.passed ? "passed" : "failed"}>{attempt.diagnosticStatus === "rejected" ? copy.rejectedBeforeScoring : attempt.passed ? copy.passedLabel : copy.failedLabel}</em>
                    <small>{gap === null ? copy.noComparison : `Δ ${gap > 0 ? "+" : ""}${gap}`}</small>
                  </span>
                </button>
              );
            })}
            {hasMore && <p className="diagnostic-result-limit">{copy.more.replace("{limit}", String(resultLimit))}</p>}
          </aside>

          <article className="admin-panel diagnostic-detail">
            {!selectedAttempt ? (
              <div className="diagnostic-empty"><Clipboard size={28} /><p>{copy.selectAttempt}</p></div>
            ) : (
              <>
                <header className="diagnostic-detail-header">
                  <div>
                    <span className={selectedAttempt.passed ? "passed" : "failed"}>{selectedAttempt.passed ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}{selectedAttempt.diagnosticStatus === "rejected" ? copy.rejectedBeforeScoring : selectedAttempt.passed ? copy.passedLabel : copy.failedLabel}</span>
                    <h2>{selectedAttempt.referenceText}</h2>
                    <code>{selectedAttempt.id}</code>
                  </div>
                  <div className="diagnostic-copy-actions">
                    <button className="admin-secondary-button compact-action" onClick={() => void copyAttempt("id")} type="button"><Copy size={16} />{copyStatus === "id" ? copy.copiedId : copy.copyId}</button>
                    <button className="admin-primary-button compact-action" onClick={() => void copyAttempt("all")} type="button"><Clipboard size={16} />{copyStatus === "all" ? copy.copiedAll : copy.copyAll}</button>
                  </div>
                </header>
                {copyStatus === "error" && <p className="error-text">{copy.copyFailed}</p>}

                <dl className="diagnostic-context-grid">
                  <div><dt>{copy.attemptId}</dt><dd><code>{selectedAttempt.id}</code></dd></div>
                  <div><dt>{copy.createdAt}</dt><dd>{formatter.format(new Date(selectedAttempt.createdAt))}</dd></div>
                  <div><dt>{copy.child}</dt><dd>{selectedAttempt.childName || children.find((child) => child.id === selectedAttempt.childId)?.name || "-"}</dd></div>
                  <div><dt>{copy.content}</dt><dd>{selectedAttempt.sourceType === "storybook" ? copy.storybook : copy.lesson} · {selectedAttempt.contentTitle || selectedAttempt.contentId || "-"}</dd></div>
                  {selectedAttempt.diagnosticStatus === "rejected" && <div><dt>{copy.rejectionReason}</dt><dd><code>{selectedAttempt.rejectionCode || selectedAttempt.rejectedReason || "-"}</code></dd></div>}
                </dl>

                <section className="diagnostic-section">
                  <div className="diagnostic-section-title"><Headphones size={19} /><h3>{copy.recordings}</h3></div>
                  {selectedAttempt.audioAvailable ? (
                    <div className="diagnostic-audio-grid">
                      <label><span>{copy.enhancedAudio}</span><audio controls preload="none" src={getAttemptDiagnosticAudioUrl(selectedAttempt.id, selectedAttempt.childId || activeChildId)} /></label>
                      {selectedAttempt.rawAudioAvailable && <label><span>{copy.rawAudio}</span><audio controls preload="none" src={getAttemptDiagnosticAudioUrl(selectedAttempt.id, selectedAttempt.childId || activeChildId, "raw")} /></label>}
                    </div>
                  ) : <p className="admin-muted">{copy.noAudio}</p>}
                </section>

                {processingTimings && (
                  <section className="diagnostic-section">
                    <div className="diagnostic-section-title"><Timer size={19} /><h3>{copy.processingTimeline}</h3></div>
                    <div className="diagnostic-quality-grid">
                      <div><span>{copy.enhancementStage}</span><strong>{formatMilliseconds(processingTimings.enhancementMs)}</strong></div>
                      <div><span>{copy.primaryStage}</span><strong>{formatMilliseconds(processingTimings.primaryAssessmentMs)}</strong></div>
                      <div><span>{copy.rawStage}</span><strong>{formatMilliseconds(processingTimings.rawComparisonMs)}</strong></div>
                      <div><span>{copy.decisionStage}</span><strong>{formatMilliseconds(processingTimings.decisionReadyMs)}</strong></div>
                      <div><span>{copy.shadowStage}</span><strong>{
                        processingTimings.shadowState === "completed"
                          ? formatMilliseconds(processingTimings.shadowAssessmentMs)
                          : processingTimings.shadowState === "queued"
                            ? copy.shadowQueued
                            : processingTimings.shadowState === "dropped"
                              ? copy.shadowDropped
                              : copy.shadowDisabled
                      }</strong></div>
                    </div>
                  </section>
                )}

                <section className="diagnostic-section diagnostic-review-section">
                  <div className="diagnostic-section-title"><CheckCircle2 size={19} /><h3>{copy.humanReview}</h3></div>
                  <p className="admin-muted">{copy.humanReviewHelp}</p>
                  <div className="diagnostic-review-labels">
                    {(Object.keys(copy.labels) as CalibrationLabel[]).map((label) => (
                      <button className={reviewLabel === label ? "selected" : ""} key={label} onClick={() => setReviewLabel(label)} type="button">{copy.labels[label]}</button>
                    ))}
                  </div>
                  <label className="admin-field diagnostic-review-note">
                    <span>{copy.reviewNote}</span>
                    <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder={copy.reviewNotePlaceholder} maxLength={500} />
                  </label>
                  <div className="diagnostic-review-actions">
                    <button className="admin-primary-button compact-action" onClick={() => void saveReview()} disabled={!reviewLabel || reviewStatus === "saving"} type="button">
                      {reviewStatus === "saving" ? copy.savingReview : reviewStatus === "saved" ? copy.savedReview : copy.saveReview}
                    </button>
                    {selectedAttempt.calibration && <button className="admin-secondary-button compact-action" onClick={() => void saveReview("")} disabled={reviewStatus === "saving"} type="button">{copy.clearReview}</button>}
                  </div>
                </section>

                <section className="diagnostic-section">
                  <div className="diagnostic-section-heading">
                    <div className="diagnostic-section-title"><Waves size={19} /><h3>{copy.providerComparison}</h3></div>
                    {primaryProvider && shadowProvider?.status === "success" && (
                      <strong className={`diagnostic-delta ${Math.abs(Number(shadowProvider.suggestedScore || 0) - Number(primaryProvider.suggestedScore || 0)) >= 15 ? "warn" : ""}`}>
                        {copy.scoreDelta}: {Number(shadowProvider.suggestedScore || 0) - Number(primaryProvider.suggestedScore || 0) > 0 ? "+" : ""}{Math.round(Number(shadowProvider.suggestedScore || 0) - Number(primaryProvider.suggestedScore || 0))}
                      </strong>
                    )}
                  </div>
                  {primaryProvider ? (
                    <div className="diagnostic-provider-grid">
                      <ProviderCard provider={primaryProvider} role={copy.primary} locale={locale} copy={copy} />
                      {shadowProvider ? <ProviderCard provider={shadowProvider} role={copy.shadow} locale={locale} copy={copy} /> : <div className="diagnostic-provider-placeholder">{copy.noShadow}</div>}
                    </div>
                  ) : <div className="diagnostic-provider-placeholder">{copy.providerNotAssessed}</div>}
                </section>

                <section className="diagnostic-section">
                  <div className="diagnostic-section-title"><Clipboard size={19} /><h3>{copy.wordComparison}</h3></div>
                  {wordRowCount === 0 ? <p className="admin-muted">{copy.noWords}</p> : (
                    <div className="diagnostic-word-table-wrap">
                      <table className="diagnostic-word-table">
                        <thead><tr><th>#</th><th>{copy.word}</th><th>{primaryProvider ? providerLabel(primaryProvider.provider, locale) : copy.primary} · {copy.primary}</th><th>{shadowProvider ? providerLabel(shadowProvider.provider, locale) : copy.shadow}</th></tr></thead>
                        <tbody>
                          {Array.from({ length: wordRowCount }, (_, index) => {
                            const primaryWord = primaryWords[index];
                            const shadowWord = shadowWords[index];
                            return <tr key={`${primaryWord?.ReferenceWord || shadowWord?.ReferenceWord || "word"}-${index}`}><td>{index + 1}</td><td><strong>{primaryWord?.ReferenceWord || shadowWord?.ReferenceWord || getAssessmentWordText(primaryWord || shadowWord!) || "-"}</strong></td><td><WordResultCell word={primaryWord} locale={locale} copy={copy} /></td><td><WordResultCell word={shadowWord} locale={locale} copy={copy} /></td></tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="diagnostic-section">
                  <div className="diagnostic-section-heading">
                    <div className="diagnostic-section-title"><Waves size={19} /><h3>{copy.recordingQuality}</h3></div>
                    <span className={`diagnostic-quality-state ${qualityTone}`}>
                      {qualityTone === "good" ? copy.qualityGood : qualityTone === "weak" ? copy.qualityWeak : qualityTone === "interrupted" ? copy.qualityInterrupted : copy.qualityMissing}
                    </span>
                  </div>
                  <div className="diagnostic-quality-grid">
                    <div><span>{copy.processedDuration}</span><strong>{formatMilliseconds(quality?.processedDurationMs)}</strong></div>
                    <div><span>{copy.voiceDuration}</span><strong>{formatMilliseconds(quality?.voiceDurationMs)}</strong></div>
                    <div><span>{copy.rms}</span><strong>{formatMetric(quality?.rms, 4)}</strong></div>
                    <div><span>{copy.peak}</span><strong>{formatMetric(quality?.peak, 4)}</strong></div>
                    <div><span>{copy.captureGap}</span><strong>{formatMilliseconds(quality?.captureGapMs)}</strong></div>
                    <div><span>{copy.outputSnr}</span><strong>{Number.isFinite(noiseGate?.outputSnrDb) ? `${formatMetric(noiseGate?.outputSnrDb, 1)} dB` : "-"}</strong></div>
                  </div>
                </section>

                <section className="diagnostic-section">
                  <div className="diagnostic-section-title"><Smartphone size={19} /><h3>{copy.device}</h3></div>
                  {!selectedAttempt.clientDevice ? <p className="admin-muted">{copy.deviceMissing}</p> : (
                    <>
                      <strong className="diagnostic-device-name">{deviceDescription || selectedAttempt.clientDevice.platform || copy.unknown}</strong>
                      <dl className="diagnostic-device-grid">
                        <div><dt>{copy.viewport}</dt><dd>{selectedAttempt.clientDevice.viewport?.width || "-"} × {selectedAttempt.clientDevice.viewport?.height || "-"}</dd></div>
                        <div><dt>{copy.screen}</dt><dd>{selectedAttempt.clientDevice.screen?.width || "-"} × {selectedAttempt.clientDevice.screen?.height || "-"} @ {selectedAttempt.clientDevice.devicePixelRatio || 1}x</dd></div>
                        <div><dt>{copy.touchPoints}</dt><dd>{selectedAttempt.clientDevice.maxTouchPoints ?? "-"}</dd></div>
                        <div><dt>{copy.network}</dt><dd>{selectedAttempt.clientDevice.connection?.effectiveType || "-"}{selectedAttempt.clientDevice.connection?.rtt ? ` · ${selectedAttempt.clientDevice.connection.rtt} ms` : ""}</dd></div>
                      </dl>
                      <code className="diagnostic-user-agent">{selectedAttempt.clientDevice.userAgent || "-"}</code>
                    </>
                  )}
                  <h4>{copy.microphone}</h4>
                  <dl className="diagnostic-device-grid microphone-grid">
                    <div><dt>{copy.echoCancellation}</dt><dd>{booleanLabel(quality?.audioInput?.applied.echoCancellation, copy)}</dd></div>
                    <div><dt>{copy.noiseSuppression}</dt><dd>{booleanLabel(quality?.audioInput?.applied.noiseSuppression, copy)}</dd></div>
                    <div><dt>{copy.autoGain}</dt><dd>{booleanLabel(quality?.audioInput?.applied.autoGainControl, copy)}</dd></div>
                    <div><dt>{copy.sampleRate}</dt><dd>{quality?.audioInput?.applied.sampleRate || quality?.inputSampleRate || "-"} Hz</dd></div>
                    <div><dt>{copy.channels}</dt><dd>{quality?.audioInput?.applied.channelCount || "-"}</dd></div>
                  </dl>
                </section>

                <details className="diagnostic-technical-details">
                  <summary>{copy.candidateDetails}</summary>
                  <pre>{JSON.stringify({ candidateSelection: selectedAttempt.candidateSelection, speechEnhancement: selectedAttempt.speechEnhancement }, null, 2)}</pre>
                </details>
                <details className="diagnostic-technical-details">
                  <summary>{copy.technicalData}</summary>
                  <pre>{JSON.stringify(diagnosticPayload(selectedAttempt), null, 2)}</pre>
                </details>
              </>
            )}
          </article>
        </section>
      )}
    </section>
  );
}
